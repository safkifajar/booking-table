export default function Loading() {
  return (
    <main className="flex-1 pb-32">
      {/* Header skeleton */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-muted animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-40 bg-muted rounded animate-pulse" />
            <div className="h-4 w-32 bg-muted rounded animate-pulse" />
          </div>
        </div>
      </header>

      <div className="sticky top-[57px] z-20 bg-background/85 backdrop-blur-md border-b border-border">
        <div className="max-w-3xl mx-auto px-2 flex gap-2 py-3 justify-center">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-6 w-16 bg-muted rounded animate-pulse" />
          ))}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-3">
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-32 bg-muted rounded animate-pulse" />
                <div className="h-2 w-20 bg-muted rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
