export default function Loading() {
  return (
    <main className="flex-1 pb-12">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-muted animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 w-40 bg-muted rounded animate-pulse" />
            <div className="h-4 w-32 bg-muted rounded animate-pulse" />
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-card p-4 space-y-2"
            >
              <div className="flex justify-between">
                <div className="h-4 w-20 bg-muted rounded animate-pulse" />
                <div className="h-3 w-12 bg-muted rounded animate-pulse" />
              </div>
              <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
              <div className="flex justify-between items-center pt-2">
                <div className="h-5 w-20 bg-muted rounded animate-pulse" />
                <div className="h-8 w-24 bg-muted rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
