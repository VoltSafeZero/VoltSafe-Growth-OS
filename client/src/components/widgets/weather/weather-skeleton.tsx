import { Skeleton } from "@/components/ui/skeleton";

// Skeleton dimensions match the loaded widget layout to avoid CLS when data arrives.
export function WeatherSkeleton({ compact }: { compact?: boolean }) {
  return (
    <div className="space-y-3" data-testid="weather-skeleton">
      {/* Current block: matches WeatherCurrent height ≈ 96px */}
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-12 w-28" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="h-14 w-14 rounded-full" />
      </div>

      {/* Stat row: 4 chips */}
      <div className="grid grid-cols-4 gap-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>

      {/* Hourly strip (hidden in compact) */}
      {!compact && (
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-12 flex-shrink-0" />
          ))}
        </div>
      )}

      {/* 7-day list */}
      <div className="space-y-1.5">
        {Array.from({ length: compact ? 3 : 7 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
