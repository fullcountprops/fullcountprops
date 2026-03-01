/**
 * stats.js — BaselineMLB Public Accuracy Dashboard
 *
 * Fetches live accuracy and CLV metrics from Supabase using the anon key.
 * Falls back to static backtest JSON when no live season data exists.
 * Populates stat cards, market table, and bookmaker table.
 * Displays today's projections with player handedness.
 * Handles pre-season state gracefully when no data exists.
 */

// ---------------------------------------------------------------------------
// Configuration — replace these with your actual Supabase project values
// ---------------------------------------------------------------------------
const SUPABASE_URL = 'https://kjhglcfwuxfkpxbbtlrs.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_SDzRfHJE43rpuAB5Ge4aaA_TLDZEcGT';

// ---------------------------------------------------------------------------
// Supabase REST helper (no SDK required — plain fetch)
// ---------------------------------------------------------------------------
async function sbGet(table, params = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
  const res = await fetch(url.toString(), {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status} ${res.statusText}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Static JSON fallbacks
// ---------------------------------------------------------------------------
async function loadFromStaticJSON() {
  try {
    const res = await fetch('./data/accuracy_summary.json');
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function loadBacktestSummary() {
  try {
    const res = await fetch('./data/backtest_summary_2025.json');
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function updateLastUpdated(data) {
  const el = document.getElementById('last-updated');
  if (!el) return;
  if (data && data.updated_at) {
    const d = new Date(data.updated_at);
    el.textContent = 'Last updated: ' + d.toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET';
  } else if (data && data.generated_at) {
    const d = new Date(data.generated_at);
    el.textContent = 'Last updated: ' + d.toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET';
  } else {
    el.textContent = 'Data updates nightly at 2 AM ET';
  }
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
async function fetchDashboardStats() {
  try {
    // 1. Overall hit rate from accuracy_summary
    const overallRows = await sbGet('accuracy_summary', {
      select: 'total_picks,hits,hit_rate,season',
      order: 'season.desc',
      limit: 1,
    });
    const overall = overallRows && overallRows.length > 0 ? overallRows[0] : null;

    // 2. All CLV data for average calculation
    const clvRows = await sbGet('clv_tracking', {
      select: 'clv_percent,market',
    });

    // 3. Graded picks for market + bookmaker breakdown
    const picksRows = await sbGet('picks', {
      select: 'market,bookmaker,result',
      'result': 'not.is.null',
    });

    // Compute average CLV
    const avgCLV = clvRows && clvRows.length > 0
      ? (clvRows.reduce((sum, r) => sum + (r.clv_percent || 0), 0) / clvRows.length).toFixed(2)
      : null;

    // Aggregate by market
    const byMarket = aggregateByField(picksRows || [], 'market');

    // Aggregate by bookmaker
    const byBookmaker = aggregateByField(picksRows || [], 'bookmaker');

    // CLV by market (from clv_tracking)
    const clvByMarket = {};
    (clvRows || []).forEach(r => {
      if (!r.market) return;
      if (!clvByMarket[r.market]) clvByMarket[r.market] = [];
      clvByMarket[r.market].push(r.clv_percent || 0);
    });

    return {
      totalPicks: overall ? overall.total_picks : 0,
      hits: overall ? overall.hits : 0,
      hitRate: overall ? overall.hit_rate : null,
      avgCLV,
      byMarket,
      byBookmaker,
      clvByMarket,
      source: 'live',
    };
  } catch (err) {
    console.error('Failed to fetch dashboard stats:', err);
    return null;
  }
}

// Fetch today's projections with player info (including handedness)
async function fetchTodaysProjections() {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Get today's projections
    const projections = await sbGet('projections', {
      select: 'mlbam_id,player_name,stat_type,projection,confidence',
      'game_date': `eq.${today}`,
      order: 'confidence.desc',
      limit: 20,
    });

    if (!projections || projections.length === 0) return [];

    // Get player details (including handedness) for all projected players
    const playerIds = [...new Set(projections.map(p => p.mlbam_id))];
    const players = await sbGet('players', {
      select: 'mlbam_id,full_name,team,position,bats,throws',
      'mlbam_id': `in.(${playerIds.join(',')})`,
    });

    // Create lookup map
    const playerMap = {};
    players.forEach(p => {
      playerMap[p.mlbam_id] = p;
    });

    // Merge projections with player data
    return projections.map(proj => ({
      ...proj,
      playerInfo: playerMap[proj.mlbam_id] || {}
    }));
  } catch (err) {
    console.error('Failed to fetch today\'s projections:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function aggregateByField(rows, field) {
  const acc = {};
  rows.forEach(row => {
    const key = row[field] || 'Unknown';
    if (!acc[key]) acc[key] = { total: 0, wins: 0 };
    acc[key].total += 1;
    if (row.result === 'win' || row.result === 'W' || row.result === true || row.result === 1) {
      acc[key].wins += 1;
    }
  });
  return Object.entries(acc)
    .map(([name, data]) => ({
      name,
      total: data.total,
      wins: data.wins,
      hitRate: data.total > 0 ? ((data.wins / data.total) * 100).toFixed(1) : '—',
    }))
    .sort((a, b) => b.total - a.total);
}

function formatHitRate(rate) {
  if (rate === null || rate === undefined || rate === '') return '—';
  const num = parseFloat(rate);
  if (isNaN(num)) return '—';
  // Handle both 0-1 range and 0-100 range
  return num <= 1 ? `${(num * 100).toFixed(1)}%` : `${num.toFixed(1)}%`;
}

function formatCLV(clv) {
  if (clv === null || clv === undefined) return '—';
  const num = parseFloat(clv);
  if (isNaN(num)) return '—';
  return num >= 0 ? `+${num}%` : `${num}%`;
}

function formatHandedness(bats, throws) {
  const b = bats || '?';
  const t = throws || '?';
  return `${b}/${t}`;
}

// ---------------------------------------------------------------------------
// DOM population
// ---------------------------------------------------------------------------
function showPrelaunchState() {
  const banner = document.getElementById('prelaunch-banner');
  if (banner) {
    banner.style.display = 'block';
    banner.textContent = 'No data yet — tracking begins Opening Day 2026';
  }

  // Keep stat values as dashes
  ['stat-total-picks', 'stat-hit-rate', 'stat-season-hit-rate', 'stat-avg-clv', 'stat-high-conf'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  });

  renderEmptyTable('market-table-body', 4);
  renderEmptyTable('bookmaker-table-body', 4);
  
  // Hide projections section if no data
  const projectionsSection = document.getElementById('projections-section');
  if (projectionsSection) projectionsSection.style.display = 'none';
}

function showBacktestState(backtest) {
  // Show the banner with backtest labeling
  const banner = document.getElementById('prelaunch-banner');
  if (banner) {
    banner.style.display = 'block';
    banner.innerHTML = '<strong>Model Validation: 2025 Season Backtest</strong> · ' +
      '4,804 projections · April–September 2025 · ' +
      '<span style="opacity: 0.8;">Live tracking begins Opening Day 2026</span>';
    banner.style.background = 'linear-gradient(135deg, #1a365d, #2a4a7f)';
    banner.style.color = '#e2e8f0';
    banner.style.padding = '12px 20px';
    banner.style.borderRadius = '8px';
    banner.style.marginBottom = '20px';
    banner.style.textAlign = 'center';
    banner.style.fontSize = '0.95rem';
  }

  const acc = backtest.projection_accuracy || {};

  // Populate stat cards with backtest data
  const totalPicksEl = document.getElementById('stat-total-picks');
  if (totalPicksEl) totalPicksEl.textContent = (backtest.total_picks || 0).toLocaleString();

  // Hit rate not available (no prop lines in backtest) — show MAE instead
  const hitRateEl = document.getElementById('stat-hit-rate');
  if (hitRateEl) {
    hitRateEl.textContent = acc.mean_absolute_error ? `${acc.mean_absolute_error} K` : '—';
    // Update the label if possible
    const hitRateLabel = hitRateEl.closest('.stat-card')?.querySelector('.stat-label, h3, .card-title, small');
    if (hitRateLabel) hitRateLabel.textContent = 'Mean Abs. Error';
  }

  const seasonHitRateEl = document.getElementById('stat-season-hit-rate');
  if (seasonHitRateEl) {
    seasonHitRateEl.textContent = acc.within_1k_pct ? `${acc.within_1k_pct}%` : '—';
    const seasonLabel = seasonHitRateEl.closest('.stat-card')?.querySelector('.stat-label, h3, .card-title, small');
    if (seasonLabel) seasonLabel.textContent = 'Within 1K';
  }

  const avgClvEl = document.getElementById('stat-avg-clv');
  if (avgClvEl) {
    avgClvEl.textContent = acc.within_2k_pct ? `${acc.within_2k_pct}%` : '—';
    const clvLabel = avgClvEl.closest('.stat-card')?.querySelector('.stat-label, h3, .card-title, small');
    if (clvLabel) clvLabel.textContent = 'Within 2K';
  }

  const highConfEl = document.getElementById('stat-high-conf');
  if (highConfEl) {
    highConfEl.textContent = acc.within_3k_pct ? `${acc.within_3k_pct}%` : '—';
    const highConfLabel = highConfEl.closest('.stat-card')?.querySelector('.stat-label, h3, .card-title, small');
    if (highConfLabel) highConfLabel.textContent = 'Within 3K';
  }

  // Render backtest info in market table area
  const marketTbody = document.getElementById('market-table-body');
  if (marketTbody) {
    marketTbody.innerHTML = `
      <tr>
        <td>Pitcher Strikeouts</td>
        <td>${(backtest.total_picks || 0).toLocaleString()}</td>
        <td>${acc.mean_absolute_error || '—'} K</td>
        <td>${acc.median_error || '—'} K</td>
      </tr>
    `;
    // Update table headers if possible
    const marketTable = marketTbody.closest('table');
    if (marketTable) {
      const headers = marketTable.querySelectorAll('thead th');
      if (headers.length >= 4) {
        headers[0].textContent = 'Prop Type';
        headers[1].textContent = 'Projections';
        headers[2].textContent = 'MAE';
        headers[3].textContent = 'Median Error';
      }
    }
  }

  // Render accuracy breakdown in bookmaker table area
  const bookTbody = document.getElementById('bookmaker-table-body');
  if (bookTbody) {
    bookTbody.innerHTML = `
      <tr>
        <td>Within 1 Strikeout</td>
        <td>${acc.within_1k_pct || '—'}%</td>
        <td>${Math.round((acc.within_1k_pct / 100) * backtest.total_picks) || '—'}</td>
        <td>—</td>
      </tr>
      <tr>
        <td>Within 2 Strikeouts</td>
        <td>${acc.within_2k_pct || '—'}%</td>
        <td>${Math.round((acc.within_2k_pct / 100) * backtest.total_picks) || '—'}</td>
        <td>—</td>
      </tr>
      <tr>
        <td>Within 3 Strikeouts</td>
        <td>${acc.within_3k_pct || '—'}%</td>
        <td>${Math.round((acc.within_3k_pct / 100) * backtest.total_picks) || '—'}</td>
        <td>—</td>
      </tr>
    `;
    // Update table headers
    const bookTable = bookTbody.closest('table');
    if (bookTable) {
      const headers = bookTable.querySelectorAll('thead th');
      if (headers.length >= 4) {
        headers[0].textContent = 'Accuracy Tier';
        headers[1].textContent = 'Rate';
        headers[2].textContent = 'Count';
        headers[3].textContent = 'CLV';
      }
    }
  }

  // Hide projections section during backtest display
  const projectionsSection = document.getElementById('projections-section');
  if (projectionsSection) projectionsSection.style.display = 'none';
}

function renderEmptyTable(tbodyId, colspan) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = `<tr class="empty-row"><td colspan="${colspan}">No data yet — tracking begins Opening Day 2026</td></tr>`;
}

function populateDashboard(stats) {
  if (!stats || stats.totalPicks === 0) {
    showPrelaunchState();
    return;
  }

  // Hide pre-launch banner when real data exists
  const banner = document.getElementById('prelaunch-banner');
  if (banner) banner.style.display = 'none';

  // Populate stat cards
  const totalPicksEl = document.getElementById('stat-total-picks');
  if (totalPicksEl) totalPicksEl.textContent = stats.totalPicks.toLocaleString();

  const hitRateEl = document.getElementById('stat-hit-rate');
  if (hitRateEl) hitRateEl.textContent = formatHitRate(stats.hitRate);

  const seasonHitRateEl = document.getElementById('stat-season-hit-rate');
  if (seasonHitRateEl) seasonHitRateEl.textContent = formatHitRate(stats.hitRate);

  const avgClvEl = document.getElementById('stat-avg-clv');
  if (avgClvEl) avgClvEl.textContent = formatCLV(stats.avgCLV);

  const highConfEl = document.getElementById('stat-high-conf');
  if (highConfEl) {
    const highConfRate = stats.byMarket.length > 0 ? formatHitRate(stats.byMarket[0].hitRate) : '—';
    highConfEl.textContent = highConfRate;
  }

  // Render market table
  renderMarketTable(stats.byMarket, stats.clvByMarket);

  // Render bookmaker table
  renderBookmakerTable(stats.byBookmaker);

  // Update last-updated timestamp
  const updatedEl = document.getElementById('last-updated');
  if (updatedEl) updatedEl.textContent = new Date().toLocaleString();
}

function renderMarketTable(byMarket, clvByMarket) {
  const tbody = document.getElementById('market-table-body');
  if (!tbody) return;

  if (!byMarket || byMarket.length === 0) {
    renderEmptyTable('market-table-body', 4);
    return;
  }

  tbody.innerHTML = byMarket.map(row => {
    const clvArr = clvByMarket[row.name] || [];
    const avgClv = clvArr.length > 0
      ? formatCLV((clvArr.reduce((s, v) => s + v, 0) / clvArr.length).toFixed(2))
      : '—';
    return `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>${row.hitRate}%</td>
        <td>${row.total}</td>
        <td>${avgClv}</td>
      </tr>
    `;
  }).join('');
}

function renderBookmakerTable(byBookmaker) {
  const tbody = document.getElementById('bookmaker-table-body');
  if (!tbody) return;

  if (!byBookmaker || byBookmaker.length === 0) {
    renderEmptyTable('bookmaker-table-body', 4);
    return;
  }

  tbody.innerHTML = byBookmaker.map(row => `
    <tr>
      <td>${escapeHtml(row.name)}</td>
      <td>${row.hitRate}%</td>
      <td>${row.total}</td>
      <td>—</td>
    </tr>
  `).join('');
}

function renderProjections(projections) {
  const section = document.getElementById('projections-section');
  const tbody = document.getElementById('projections-table-body');
  
  if (!tbody || !section) return;

  if (!projections || projections.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  
  tbody.innerHTML = projections.map(proj => {
    const p = proj.playerInfo || {};
    const handedness = formatHandedness(p.bats, p.throws);
    const conf = proj.confidence ? `${(proj.confidence * 100).toFixed(0)}%` : '—';
    
    return `
      <tr>
        <td>
          <strong>${escapeHtml(proj.player_name || 'Unknown')}</strong>
          <br>
          <span style="font-size: 0.85rem; color: #a0aec0;">
            ${escapeHtml(p.team || '')} · ${escapeHtml(p.position || '')} · ${handedness}
          </span>
        </td>
        <td>${escapeHtml(proj.stat_type || '')}</td>
        <td><strong>${proj.projection ? proj.projection.toFixed(1) : '—'}</strong></td>
        <td>${conf}</td>
      </tr>
    `;
  }).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(String(str)));
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Entry point — cascading data strategy:
//   1. Try Supabase (live 2026 season data)
//   2. If empty, try backtest summary JSON (2025 validation data)
//   3. If nothing, show pre-launch placeholder
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  // Show loading state
  ['stat-total-picks', 'stat-hit-rate', 'stat-season-hit-rate', 'stat-avg-clv', 'stat-high-conf'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '...';
  });

  // Fetch all data in parallel
  const [stats, projections] = await Promise.all([
    fetchDashboardStats(),
    fetchTodaysProjections()
  ]);

  // Strategy 1: Live Supabase data exists — show it
  if (stats && stats.totalPicks > 0) {
    populateDashboard(stats);
    renderProjections(projections);

    const staticData = await loadFromStaticJSON();
    updateLastUpdated(staticData);
    return;
  }

  // Strategy 2: No live data — try backtest summary
  const backtest = await loadBacktestSummary();
  if (backtest && backtest.total_picks > 0) {
    showBacktestState(backtest);
    updateLastUpdated(backtest);
    return;
  }

  // Strategy 3: Nothing available — show pre-launch state
  showPrelaunchState();
  const staticData = await loadFromStaticJSON();
  updateLastUpdated(staticData);
});
