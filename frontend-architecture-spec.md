# FullCountProps — Frontend Architecture Spec

## Last Updated: February 25, 2026

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 14 (App Router) | SSR for SEO, API routes for light backend logic, Vercel-native |
| Hosting | Vercel (free tier) | Auto-deploys from GitHub, edge CDN, zero config |
| Database | Supabase (existing) | Already set up with 8 tables, RLS policies, and service key |
| Supabase Client | @supabase/supabase-js | Direct client queries using anon key (reads public tables) |
| Styling | Tailwind CSS | Fast iteration, dark theme utilities built-in, mobile-first |
| Charts | Recharts or Chart.js | Lightweight, React-native, good for accuracy trend lines |
| Deployment | GitHub → Vercel auto-deploy | Push to main = live in 60 seconds |

---

## Domain Setup

1. In Vercel dashboard: Settings → Domains → Add `fullcountprops.com`
2. In Namecheap DNS: Add Vercel's CNAME/A records
3. Vercel handles SSL automatically
4. Keep GitHub Pages dashboard at `nrlefty5.github.io/fullcountprops/` as separate free site

---

## Site Map & Page Architecture

```
fullcountprops.com/
│
├── /                       ← Today's Slate (homepage)
├── /game/[gamePk]          ← Individual Game Deep Dive
├── /pitcher/[pitcherId]    ← Pitcher Profile & Trends
├── /props                  ← Prop Research Hub
├── /accuracy               ← Public Accuracy Dashboard
├── /about                  ← Methods, data sources, FAQ
└── /api/                   ← Internal API routes (server-side)
    ├── /api/refresh         ← Trigger manual data refresh
    └── /api/projections     ← Serve projections with caching
```

---

## PAGE 1: TODAY'S SLATE (Homepage)

**Route:** `/`
**Data source:** `games` table joined with `props`, `projections`
**Refresh:** ISR (Incremental Static Regeneration) every 5 minutes, or SWR client-side

### Layout

```
┌─────────────────────────────────────────────────────┐
│  FullCountProps                    [date] [refresh ↻] │
│  Your daily MLB research. Every factor. No secrets. │
├─────────────────────────────────────────────────────┤
│                                                     │
│  FILTERS: [All Games] [Day Games] [Night Games]     │
│           [Outdoor Only] [Dome Games]               │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │ 1:10 PM  NYY @ BOS — Fenway Park           │    │
│  │                                              │    │
│  │ Cole (RHP)          vs    Whitlock (RHP)     │    │
│  │ K%: 28.4  Whiff: 32%    K%: 22.1  Whiff: 26%│   │
│  │                                              │    │
│  │ ☀️ 72°F  Wind: 12 mph OUT to RF  Humidity: 45%│  │
│  │ 🏟️ Park K Factor: +3%   Ump: Joe West (+4.2%)│  │
│  │                                              │    │
│  │ ML: NYY -145 / BOS +125   O/U: 8.5          │    │
│  │ Cole K prop: 6.5 (-120)   ★ LEAN: OVER      │    │
│  │                                              │    │
│  │ [Glass Box ▼]  [Full Game →]                 │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │ 4:10 PM  LAD @ COL — Coors Field            │    │
│  │ ...                                          │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Game Card Component — Data Fields

Each game card displays:

**Header row:**
- Game time (ET)
- Away @ Home
- Venue name
- Source: `games` table

**Pitcher matchup row:**
- Both starting pitchers: name, throws (L/R)
- Key Statcast metrics (30-day rolling): K%, Whiff rate, Chase rate, Hard hit% allowed
- Source: `statcast_pitches` table (aggregated) or pre-computed in `projections.features`

**Environment row:**
- Weather: temp, wind speed + direction relative to field, humidity
- Park factor: K factor for this game (from projection features)
- Umpire: name + historical K% deviation from league average
- Catcher framing: net K impact estimate
- Source: `projections.features` JSONB field, `umpire_framing` table

**Odds row:**
- Moneyline (best book), Run total O/U (best book)
- Featured prop: pitcher K prop line + our lean (OVER/UNDER/NO PLAY)
- Source: `props` table, `projections` table

**Expandable Glass Box panel** (click to reveal):
- Full factor breakdown from `projections.features`
- Shows every adjustment: baseline K/9, umpire adj %, catcher adj %, park adj %, opponent K rate adj %
- Final projected Ks with confidence score
- Visual bar showing projected value vs prop line
- Source: `projections` table → `features` JSONB field

### Supabase Query (pseudocode)

```javascript
// Fetch today's slate with all related data
const today = new Date().toISOString().split('T')[0]

const { data: games } = await supabase
  .from('games')
  .select('*')
  .eq('game_date', today)
  .order('game_time', { ascending: true })

const { data: projections } = await supabase
  .from('projections')
  .select('*')
  .eq('game_date', today)

const { data: props } = await supabase
  .from('props')
  .select('*')
  .eq('game_date', today)

// Client-side: merge games + projections + props by game_pk and pitcher_id
```

---

## PAGE 2: INDIVIDUAL GAME DEEP DIVE

**Route:** `/game/[gamePk]`
**Data source:** All tables joined by `game_pk`

### Sections

**1. Game Header**
- Teams, time, venue, weather summary
- Moneyline + total with multi-book odds comparison

**2. Starting Pitcher Comparison Cards** (side by side)
For each pitcher:
- Profile: name, team, throws, season record
- Statcast Dashboard (30-day rolling):
  - K% | BB% | K-BB%
  - Whiff Rate | Chase Rate
  - Hard Hit% | Barrel%
  - Avg Exit Velo allowed
  - Stuff+ scores by pitch type (if available in data)
- Trend sparklines: K% over last 10 starts
- Today's projection with glass-box breakdown

**3. Environment Analysis Card**
- Weather detail: temp, wind (with directional arrow graphic relative to field), humidity, precipitation %
- Park factor breakdown: HR factor, K factor, Runs factor
- Umpire card: name, photo placeholder, career K%, zone size tendency (larger/smaller), historical splits vs LHB/RHB
- Catcher framing: shadow zone conversion rate, net K impact

**4. Prop Market Overview**
- Table of all available props for this game from `props` table
- Columns: Player | Prop Type | Line | Over Odds | Under Odds | Best Book | Our Lean | Confidence
- Color-coded: green highlight on leans with confidence > 75

**5. Lineup & Matchup Grid**
- Once lineups are confirmed: each batter's K%, handedness, and matchup grade vs the opposing pitcher
- Aggregate lineup K% vs pitcher handedness
- Source: `players` table + Statcast data

---

## PAGE 3: PITCHER PROFILE

**Route:** `/pitcher/[pitcherId]`
**Data source:** `players`, `statcast_pitches`, `projections`, `picks`

### Sections

**1. Pitcher Header**
- Name, team, throws, age, season stats
- Overall Statcast grades: K%, Whiff, Chase, Hard Hit%

**2. Rolling Trends** (charts)
- 10-game rolling: K/9, Whiff rate, Chase rate, Hard Hit% allowed
- Show each metric as a line chart with the league average as a reference line
- Library: Recharts `<LineChart>` component

**3. Pitch Arsenal Breakdown**
- Table: pitch type, usage %, avg velocity, whiff rate, put-away rate
- Source: Statcast pitch-level data aggregated from `statcast_pitches`

**4. Matchup History**
- How this pitcher performs in today's park (if applicable)
- Historical results vs today's opponent (team-level K%, HR% allowed)

**5. Prop History**
- Last 10-15 games: prop line offered vs actual result
- Chart: actual Ks vs prop line over time (visual over/under tracker)
- Running record: X/Y overs, X/Y unders
- Source: `picks` table filtered by pitcher_id

**6. Our Track Record on This Pitcher**
- FullCountProps's projection accuracy for this specific pitcher
- Hit rate, avg CLV, avg projection error
- Source: `picks` table aggregated by pitcher_id

---

## PAGE 4: PROP RESEARCH HUB

**Route:** `/props`
**Data source:** `props`, `projections`, `players`

### Layout

**Filters:**
- Prop type: [All] [Pitcher Ks] [Hits] [Total Bases] [HRs] [Walks] [Pitcher Hits Allowed]
- Confidence: [All] [High (75+)] [Medium (50-74)] [Low (<50)]
- Time: [All Games] [Early Slate] [Main Slate] [Night]

**Main Table:**
| Player | Team | Prop | Line | Over | Under | Best Book | Proj Value | Lean | Confidence | Factors |
|--------|------|------|------|------|-------|-----------|-----------|------|------------|---------|

- Sortable by any column (click header)
- "Factors" column shows a mini glass-box: hover/click reveals the top 3 adjustment factors
- Rows highlighted green when confidence > 75 and lean is strong
- Rows highlighted yellow when projection is within 0.5 of line (push zone)

**Secondary view: "Best Bets Today"**
- Filtered to confidence > 70 and lean ≠ push_zone
- Sorted by absolute CLV potential (projected value distance from line)
- Shows maximum 5-8 plays — quality over quantity

---

## PAGE 5: PUBLIC ACCURACY DASHBOARD

**Route:** `/accuracy`
**Data source:** `accuracy_summary`, `picks`
**Note:** This mirrors and extends the GitHub Pages dashboard with richer interactivity

### Sections

**1. Headline Stats**
- Overall hit rate (big number, prominently displayed)
- Total picks graded
- Average CLV
- Current streak (consecutive hits)
- Display period: All Time | Last 30 Days | Last 7 Days

**2. Accuracy by Prop Type** (table)
| Prop Type | Picks | Hit Rate | Avg CLV | Avg Error |
|-----------|-------|----------|---------|-----------|
| Pitcher Ks | 142 | 58.4% | +0.31 | 1.2 |
| Batter Hits | 89 | 54.2% | +0.18 | 0.8 |
| Total Bases | 67 | 52.3% | +0.12 | 1.1 |
| ... | | | | |

**3. Cumulative Performance Chart**
- Line chart: cumulative units won/lost over time
- Assumes flat 1-unit bets at posted odds
- Separate lines for each prop type
- Library: Recharts `<LineChart>` with multiple `<Line>` elements

**4. Calibration Chart**
- X-axis: confidence bucket (50-59, 60-69, 70-79, 80-89, 90-100)
- Y-axis: actual hit rate in that bucket
- Perfect calibration = diagonal line
- Shows whether confidence scores are meaningful

**5. Recent Picks Feed**
- Last 20 graded picks
- Columns: Date | Pitcher | Prop | Line | Lean | Projected | Actual | Result | CLV
- Color: green rows = hit, red = miss, gray = push
- Click any row → expands to show full glass-box factor breakdown

**6. Transparency Statement**
- Static text block explaining: data sources, methodology, grading rules
- "Every projection FullCountProps has ever made is logged and graded. We don't hide misses."
- Link to raw data export (CSV download of all picks)

---

## PAGE 6: ABOUT / METHODS

**Route:** `/about`
**Static content page**

### Sections
- What is FullCountProps
- Data sources (with links): Baseball Savant, MLB Stats API, The Odds API, OpenWeatherMap
- How projections work (glass-box methodology explanation)
- What we track: every factor, every adjustment, every result
- FAQ
- Contact: @fullcountprops on Twitter

---

## GLOBAL COMPONENTS

### Navigation Bar
```
[⚾ FullCountProps]  [Today's Slate]  [Props]  [Accuracy]  [About]
```
- Fixed top, dark background (#0a0a0f or similar)
- Mobile: hamburger menu
- Active page highlighted

### Color Palette (Dark Theme)
| Element | Color | Hex |
|---------|-------|-----|
| Background | Near-black | #0a0a0f |
| Card background | Dark gray | #141418 |
| Card border | Subtle gray | #2a2a30 |
| Primary text | Off-white | #e4e4e7 |
| Secondary text | Medium gray | #8b8b94 |
| Accent / brand | Baseball blue | #3b82f6 |
| Positive / OVER | Green | #22c55e |
| Negative / UNDER | Red | #ef4444 |
| Neutral / push | Amber | #eab308 |
| High confidence | Bright green bg | #22c55e20 (with transparency) |

### Typography
- Headings: Inter or Geist (Next.js default)
- Data/numbers: JetBrains Mono or IBM Plex Mono (monospace for stats)
- Body: Inter

### Mobile Responsiveness
- Game cards stack vertically on mobile (no horizontal scroll)
- Pitcher comparison goes from side-by-side to stacked on screens < 768px
- Tables become horizontally scrollable cards on mobile
- Glass-box panels are collapsible accordions
- Touch-friendly tap targets (minimum 44px)

---

## SUPABASE CLIENT SETUP

### Environment Variables (in Vercel)
```
NEXT_PUBLIC_SUPABASE_URL=https://kjhglcfwuxfkpxbbtlrs.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
```

### Client initialization (`lib/supabase.ts`)
```typescript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
```

### Key queries the frontend needs:

```typescript
// Today's games with all context
async function getTodaysSlate(date: string) {
  const { data: games } = await supabase
    .from('games')
    .select('*')
    .eq('game_date', date)
    .order('game_time')

  const { data: projections } = await supabase
    .from('projections')
    .select('*')
    .eq('game_date', date)

  const { data: props } = await supabase
    .from('props')
    .select('*')
    .eq('game_date', date)

  const { data: umpires } = await supabase
    .from('umpire_framing')
    .select('*')
    .eq('game_date', date)

  return mergeGameData(games, projections, props, umpires)
}

// Accuracy summary for dashboard
async function getAccuracySummary() {
  const { data } = await supabase
    .from('accuracy_summary')
    .select('*')
    .order('updated_at', { ascending: false })
  return data
}

// Recent graded picks
async function getRecentPicks(limit: number = 20) {
  const { data } = await supabase
    .from('picks')
    .select('*')
    .eq('published', true)
    .in('result', ['hit', 'miss', 'push'])
    .order('game_date', { ascending: false })
    .limit(limit)
  return data
}

// Pitcher profile data
async function getPitcherProfile(pitcherId: number) {
  const { data: picks } = await supabase
    .from('picks')
    .select('*')
    .eq('pitcher_id', pitcherId)
    .order('game_date', { ascending: false })
    .limit(30)
  return picks
}
```

---

## BUILD ORDER (sequential, each builds on the last)

### Sprint 1: Skeleton + Today's Slate (Week 1)
- [ ] Initialize Next.js project with Tailwind CSS
- [ ] Set up Supabase client
- [ ] Deploy to Vercel, connect fullcountprops.com domain
- [ ] Build navigation bar and dark theme layout
- [ ] Build homepage: fetch and display game cards (basic — just teams, time, pitchers)
- **Milestone:** fullcountprops.com shows today's MLB schedule with pitcher names

### Sprint 2: Statcast + Environment Layer (Week 2)
- [ ] Add Statcast metrics to pitcher display on game cards
- [ ] Add weather data row to game cards
- [ ] Add umpire + framing composite score display
- [ ] Add odds row (moneyline, total, K prop)
- **Milestone:** Game cards show full analytical context

### Sprint 3: Glass Box + Props Page (Week 3)
- [ ] Build expandable glass-box panel on game cards
- [ ] Build /props page with sortable, filterable prop table
- [ ] Add "Best Bets Today" filtered view
- [ ] Add confidence color-coding and lean indicators
- **Milestone:** Props page is a usable daily research tool

### Sprint 4: Accuracy Dashboard (Week 4)
- [ ] Build /accuracy page with headline stats
- [ ] Add accuracy by prop type table
- [ ] Add cumulative performance chart (Recharts)
- [ ] Add calibration chart
- [ ] Add recent picks feed with expandable glass-box
- **Milestone:** Public accuracy dashboard is live and auto-updating

### Sprint 5: Game + Pitcher Deep Dives (Week 5-6)
- [ ] Build /game/[gamePk] page with all sections
- [ ] Build /pitcher/[pitcherId] profile page
- [ ] Add rolling trend charts
- [ ] Add prop history charts per pitcher
- [ ] Add matchup grid (lineup data)
- **Milestone:** Full drill-down experience from slate → game → pitcher

### Sprint 6: Polish + Mobile + Pre-Launch (Week 7-8)
- [ ] Mobile responsive pass on all pages
- [ ] Loading states and error handling
- [ ] SEO: meta tags, Open Graph images for social sharing
- [ ] Performance: image optimization, query caching
- [ ] About/methods page
- [ ] Final QA pass
- **Milestone:** Production-ready for July 4th launch

---

## DEPLOYMENT CHECKLIST

- [ ] Vercel project created, linked to GitHub repo
- [ ] Custom domain fullcountprops.com pointed to Vercel
- [ ] SSL certificate active (Vercel auto-provisions)
- [ ] Environment variables set in Vercel dashboard
- [ ] Supabase RLS policies verified (anon key can only read public tables)
- [ ] GitHub Actions still running pipelines on schedule
- [ ] Accuracy dashboard on GitHub Pages still live as separate free site
- [ ] Open Graph / Twitter Card meta tags working (test with Twitter Card Validator)
- [ ] Google Analytics or Plausible analytics installed
- [ ] Error monitoring (Vercel built-in or Sentry free tier)

---

## MONETIZATION (Post-Launch)

### Free Tier (always free)
- Today's slate with basic game info (teams, time, pitchers, weather)
- Public accuracy dashboard (full transparency)
- About/methods page

### Pro Tier ($15/month or $99/season)
- Full Statcast metrics on pitcher cards
- Glass-box projection breakdowns
- Prop research hub with sortable table
- Best Bets Today filtered view
- Pitcher profile pages with trend charts
- Prop history and our track record per pitcher
- Daily email digest (future feature)

### Implementation
- Supabase Auth for user accounts
- Stripe for payments (or Whop, which BallparkPal uses)
- Middleware in Next.js: check auth status, gate Pro pages
- Free pages render fully; Pro pages show a preview with paywall overlay

---

## FILE STRUCTURE

```
fullcountprops-web/
├── app/
│   ├── layout.tsx              ← Root layout, dark theme, nav
│   ├── page.tsx                ← Homepage (Today's Slate)
│   ├── game/
│   │   └── [gamePk]/
│   │       └── page.tsx        ← Game deep dive
│   ├── pitcher/
│   │   └── [pitcherId]/
│   │       └── page.tsx        ← Pitcher profile
│   ├── props/
│   │   └── page.tsx            ← Prop research hub
│   ├── accuracy/
│   │   └── page.tsx            ← Accuracy dashboard
│   ├── about/
│   │   └── page.tsx            ← Methods & FAQ
│   └── api/
│       └── refresh/
│           └── route.ts        ← Manual refresh endpoint
├── components/
│   ├── GameCard.tsx             ← Individual game card
│   ├── GlassBox.tsx             ← Expandable factor breakdown
│   ├── PitcherStatCard.tsx      ← Pitcher Statcast display
│   ├── EnvironmentRow.tsx       ← Weather + umpire + park
│   ├── OddsRow.tsx              ← Odds display with best book
│   ├── PropTable.tsx            ← Sortable prop research table
│   ├── AccuracyChart.tsx        ← Recharts cumulative chart
│   ├── CalibrationChart.tsx     ← Confidence calibration
│   ├── PicksFeed.tsx            ← Recent picks list
│   └── Navigation.tsx           ← Top nav bar
├── lib/
│   ├── supabase.ts              ← Supabase client init
│   ├── queries.ts               ← All Supabase query functions
│   └── utils.ts                 ← Formatting, color coding, helpers
├── public/
│   └── og-image.png             ← Social share image
├── tailwind.config.ts
├── next.config.ts
├── package.json
└── .env.local                   ← Supabase keys (not committed)
```
