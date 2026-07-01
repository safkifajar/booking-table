export default function Loading() {
  return (
    <main className="flex-1 pb-32">
      {/* Header skeleton */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-muted animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-32 bg-muted rounded animate-pulse" />
            <div className="h-4 w-48 bg-muted rounded animate-pulse" />
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-2 flex gap-2">
          <div className="h-8 w-28 rounded-full bg-muted animate-pulse" />
          <div className="h-8 w-24 rounded-full bg-muted animate-pulse" />
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {/* Floor map placeholder */}
        <div className="rounded-xl border border-border bg-card aspect-[3/2] flex items-center justify-center">
          <div className="text-sm text-muted-foreground">Loading floor map...</div>
        </div>
      </div>
    </main>
  );
}
