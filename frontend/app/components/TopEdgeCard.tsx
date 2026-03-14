// ==============================================================
// TopEdgeCard.tsx
// ==============================================================
// Place at: frontend/app/components/TopEdgeCard.tsx
//
// Async server component that fetches the day's highest-edge
// pick from simulation_results and renders it.
//
// IMPORTANT: Adjust the Supabase client import and the column
// names to match your actual schema.
// ==============================================================

import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

async function getTopEdge() {
  const today = new Date().toISOString().split('T')[0];

  // TODO: Adjust column names to match your simulation_results schema.
  // Common alternatives for the date column:
  //   simulation_date, game_date, created_at::date
  const { data, error } = await supabase
    .from('simulation_results')
    .select('*')
    .eq('simulation_date', today)
    .not('edge_pct', 'is', null)
    .gt('edge_pct', 0)
    .order('edge_pct', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return data;
}

const PROP_LABELS: Record<string, string> = {
  K: 'Ks',
  H: 'Hits',
  TB: 'Total Bases',
  HR: 'Home Runs',
  R: 'Runs',
  RBI: 'RBIs',
  BB: 'Walks',
};

const TIER_STYLES: Record<string, { label: string; className: string }> = {
  A: { label: 'HIGH', className: 'text-green-400 border-green-400/30 bg-green-400/10' },
  B: { label: 'MED', className: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10' },
  C: { label: 'LOW', className: 'text-slate-400 border-slate-400/30 bg-slate-400/10' },
  D: { label: 'LOW', className: 'text-red-400 border-red-400/30 bg-red-400/10' },
};

export async function TopEdgeCard() {
  const edge = await getTopEdge();

  if (!edge) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-center">
        <p className="text-lg font-medium text-white">
          Today&apos;s top edges drop when games are scheduled
        </p>
        <p className="mt-2 text-sm text-slate-400">
          Edges are calculated by comparing simulation probabilities to live
          sportsbook lines. Check back on game days.
        </p>
        <Link
          href="/edges"
          className="mt-4 inline-block rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
        >
          View Edges Page
        </Link>
      </div>
    );
  }

  const propLabel = PROP_LABELS[edge.prop_type] ?? edge.prop_type;
  const tier = TIER_STYLES[edge.confidence_tier] ?? TIER_STYLES.C;

  // Determine if p_over is stored as decimal (0.607) or percentage (60.7)
  const pOverDisplay = edge.p_over
    ? edge.p_over > 1
      ? edge.p_over.toFixed(1)       // already a percentage
      : (edge.p_over * 100).toFixed(1) // convert from decimal
    : '--';

  return (
    <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tier.className}`}>
          {tier.label}
        </span>
        <span className="text-sm font-bold text-green-400">
          +{edge.edge_pct?.toFixed(1)}% edge
        </span>
      </div>

      {/* Player + team */}
      <div className="mt-3">
        <Link
          href={`/players/${edge.player_id}`}
          className="text-lg font-semibold text-white hover:text-blue-400"
        >
          {edge.player_name}
        </Link>
        <p className="mt-0.5 text-sm text-slate-500">
          {edge.team}
        </p>
      </div>

      {/* Prop line */}
      <div className="mt-4">
        <span className="text-xl font-bold text-white">
          O {edge.sportsbook_line} {propLabel}
        </span>
      </div>

      {/* Stats row */}
      <div className="mt-4 grid grid-cols-3 gap-4 border-t border-slate-800 pt-4">
        <div>
          <p className="text-xs text-slate-500">Sim mean</p>
          <p className="text-sm font-semibold text-white">
            {edge.simulated_mean?.toFixed(1)} {propLabel}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">P(Over)</p>
          <p className="text-sm font-semibold text-white">
            {pOverDisplay}%
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Kelly</p>
          <p className="text-sm font-semibold text-white">
            {edge.kelly_stake?.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Live badge */}
      <p className="mt-4 text-xs text-slate-600">
        Live pick · Updated at last pipeline run
      </p>
    </div>
  );
}
