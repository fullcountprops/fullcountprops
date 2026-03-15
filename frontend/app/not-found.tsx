import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="text-center max-w-lg">
        <div className="text-6xl mb-4">&#9918;</div>
        <h1 className="text-4xl font-bold text-white mb-2">Strike Three!</h1>
        <p className="text-slate-400 text-lg mb-8">
          That page took a called third strike &mdash; it&apos;s not in our lineup.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/edges"
            className="px-6 py-2.5 text-sm font-medium bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors"
          >
            Today&apos;s Edges
          </Link>
          <Link
            href="/pitchers/preview"
            className="px-6 py-2.5 text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition-colors"
          >
            Pitcher Preview
          </Link>
          <Link
            href="/pricing"
            className="px-6 py-2.5 text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition-colors"
          >
            Pricing
          </Link>
        </div>

        <p className="text-slate-600 text-xs mt-10">
          Error 404 &mdash; Page not found
        </p>
      </div>
    </div>
  )
}
