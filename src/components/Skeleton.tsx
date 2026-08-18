interface SkeletonProps {
  className?: string
}

/** A pulsing placeholder block, used while real content is loading. */
export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div className={`animate-pulse bg-slate-200 rounded-md ${className}`} />
  )
}

/** Skeleton for a row in an attendance/employee table. */
export function TableRowSkeleton({ columns = 6 }: { columns?: number }) {
  return (
    <tr className="border-b border-slate-100 last:border-0">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="py-2.5">
          <Skeleton className="h-4 w-full max-w-[100px]" />
        </td>
      ))}
    </tr>
  )
}

/** Skeleton for the 5 admin summary cards. */
export function SummaryCardSkeleton() {
  return (
    <div className="rounded-xl bg-white border border-slate-200 p-4">
      <Skeleton className="h-3 w-20 mb-2" />
      <Skeleton className="h-7 w-12" />
    </div>
  )
}
