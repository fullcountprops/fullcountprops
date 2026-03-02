export function ProjectionSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-gray-800 border border-gray-700 rounded-lg p-4 animate-pulse">
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              <div className="h-4 bg-gray-700 rounded w-32 mb-2" />
              <div className="h-3 bg-gray-700 rounded w-48" />
            </div>
            <div className="h-6 bg-gray-700 rounded w-12" />
          </div>
          <div className="flex items-center justify-center gap-6 mt-3">
            <div className="text-center">
              <div className="h-8 bg-gray-700 rounded w-16 mx-auto mb-1" />
              <div className="h-3 bg-gray-700 rounded w-12 mx-auto" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function PropsSkeleton() {
  return (
    <div className="space-y-8">
      {Array.from({ length: 2 }).map((_, i) => (
        <section key={i}>
          <div className="h-6 bg-gray-700 rounded w-40 mb-3 animate-pulse" />
          <div className="overflow-x-auto rounded-lg border border-gray-700">
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-800">
                  {['Player', 'Market', 'Line', 'Over', 'Under', 'Edge'].map((h) => (
                    <th key={h} className="py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 5 }).map((_, j) => (
                  <tr key={j} className="border-b border-gray-700 animate-pulse">
                    <td className="py-3 px-4"><div className="h-4 bg-gray-700 rounded w-28" /></td>
                    <td className="py-3 px-4"><div className="h-4 bg-gray-700 rounded w-20" /></td>
                    <td className="py-3 px-4"><div className="h-4 bg-gray-700 rounded w-10 mx-auto" /></td>
                    <td className="py-3 px-4"><div className="h-4 bg-gray-700 rounded w-12 mx-auto" /></td>
                    <td className="py-3 px-4"><div className="h-4 bg-gray-700 rounded w-12 mx-auto" /></td>
                    <td className="py-3 px-4"><div className="h-4 bg-gray-700 rounded w-14 mx-auto" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}

export function AccuracySkeleton() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="h-8 bg-gray-700 rounded w-48 mb-2 animate-pulse" />
      <div className="h-4 bg-gray-700 rounded w-72 mb-8 animate-pulse" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4 animate-pulse">
            <div className="h-3 bg-gray-700 rounded w-20 mb-2" />
            <div className="h-8 bg-gray-700 rounded w-24 mb-1" />
            <div className="h-3 bg-gray-700 rounded w-32" />
          </div>
        ))}
      </div>
    </div>
  )
}
