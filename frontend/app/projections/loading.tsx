import { ProjectionSkeleton } from '../components/Skeletons'

export default function Loading() {
  return (
    <div>
      <div className="mb-8">
        <div className="h-8 bg-gray-700 rounded w-56 mb-2 animate-pulse" />
        <div className="h-4 bg-gray-700 rounded w-80 animate-pulse" />
      </div>
      <ProjectionSkeleton />
    </div>
  )
}
