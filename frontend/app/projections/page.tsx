import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

async function getProjections(gameDate?: string) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return []
  }
  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const today = gameDate || new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('projections')
    .select('*')
    .eq('game_date', today)
    .order('confidence_score', { ascending: false })
    .limit(150)

  if (error) {
    console.error('Error fetching projections:', error)
    return []
  }
  return data || []
}

const STAT_LABELS: Record<string, string> = {
  strikeouts: 'Strikeouts',
  hits: 'Hits',
  home_runs: 'Home Runs',
  rbis: 'RBIs',
  walks: 'Walks',
  earned_runs: 'Earned Runs',
  outs_recorded: 'Outs Recorded',
  hits_allowed: 'Hits Allowed',
}

function ConfidenceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color =
    pct >= 70 ? 'bg-green-900 text-green-300 border-green-700' :
    pct >= 55 ? 'bg-blue-900 text-blue-300 border-blue-700' :
    'bg-gray-700 text-slate-400 border-gray-600'

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${color}`}>
      {pct}%
    </span>
  )
}

function ProjectionCard({ proj }: { proj: any }) {
  const statLabel = STAT_LABELS[proj.stat_type] || proj.stat_type
  const diff = proj.projected_value != null && proj.line != null
    ? (proj.projected_value - proj.line).toFixed(2)
    : null
  const overUnder = diff !== null
    ? parseFloat(diff) > 0 ? 'OVER' : parseFloat(diff) < 0 ? 'UNDER' : 'PUSH'
    : null

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-gray-500 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white truncate">{proj.player_name}</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {proj.team_abbr || ''} &bull; {statLabel}
          </div>
        </div>
        {proj.confidence_score != null && (
          <ConfidenceBadge score={proj.confidence_score} />
        )}
      </div>

      <div className="flex items-center justify-between mt-2">
        <div className="text-center">
          <div className="text-2xl font-bold text-white">
            {proj.projected_value?.toFixed(1) ?? '--'}
          </div>
          <div className="text-xs text-slate-500">Projected</div>
        </div>

        <div className="text-center px-3">
          <div className="text-slate-600 text-sm">vs</div>
          <div className="text-xs text-slate-500">Line</div>
        </div>

        <div className="text-center">
          <div className="text-2xl font-bold text-slate-400">
            {proj.line?.toFixed(1) ?? '--'}
          </div>
          <div className="text-xs text-slate-500">Market</div>
        </div>

        {overUnder && diff !== null && (
          <div className="text-center ml-2">
            <div className={`text-sm font-bold ${
              overUnder === 'OVER' ? 'text-green-400' :
              overUnder === 'UNDER' ? 'text-red-400' :
              'text-slate-400'
            }`}>
              {overUnder}
            </div>
            <div className={`text-xs ${
              parseFloat(diff) > 0 ? 'text-green-500' : 'text-red-500'
            }`}>
              {parseFloat(diff) > 0 ? '+' : ''}{diff}
            </div>
          </div>
        )}
      </div>

      {proj.key_factors && (
        <div className="mt-3 pt-3 border-t border-gray-700">
          <p className="text-xs text-slate-400 line-clamp-2">{proj.key_factors}</p>
        </div>
      )}
    </div>
  )
}

export default async function ProjectionsPage() {
  const projections = await getProjections()

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York',
  })

  const highConf = projections.filter((p: any) => p.confidence_score >= 0.7)
  const other = projections.filter((p: any) => !p.confidence_score || p.confidence_score < 0.7)

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Model Projections</h1>
        <p className="text-slate-400">
          {today} &bull; Glass-box K-nearest model &bull; {projections.length} projections
        </p>
      </div>

      {projections.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-4">🤖</div>
          <h2 className="text-xl font-semibold text-slate-300 mb-2">No projections yet</h2>
          <p className="text-slate-500 max-w-md mx-auto">
            {!supabaseUrl
              ? 'Configure Supabase environment variables to load projections.'
              : 'Projections generate automatically starting Opening Day 2026 using our glass-box K-nearest neighbor model.'}
          </p>
          <div className="mt-8 p-4 bg-gray-900 rounded-lg border border-gray-700 max-w-md mx-auto text-sm text-slate-400 text-left">
            <p className="font-medium text-slate-300 mb-2">Model inputs:</p>
            <ul className="space-y-1">
              <li>• Season stats + Statcast exit velocity, launch angle</li>
              <li>• Umpire framing tendencies</li>
              <li>• Park factors (15 stadiums)</li>
              <li>• Pitcher/batter historical matchups</li>
              <li>• Rest days, travel, lineup position</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="space-y-10">
          {highConf.length > 0 && (
            <section>
              <h2 className="text-xl font-semibold text-white mb-4 pb-2 border-b border-green-800">
                High Confidence
                <span className="ml-2 text-sm font-normal text-green-500">≥ 70% ({highConf.length})</span>
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {highConf.map((proj: any, i: number) => (
                  <ProjectionCard key={`${proj.player_name}-${proj.stat_type}-${i}`} proj={proj} />
                ))}
              </div>
            </section>
          )}

          {other.length > 0 && (
            <section>
              <h2 className="text-xl font-semibold text-white mb-4 pb-2 border-b border-gray-700">
                All Projections
                <span className="ml-2 text-sm font-normal text-slate-400">({other.length})</span>
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {other.map((proj: any, i: number) => (
                  <ProjectionCard key={`${proj.player_name}-${proj.stat_type}-${i}`} proj={proj} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
