export default function Loading() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-border bg-card p-5 space-y-2"
          >
            <div className="h-3 w-16 bg-muted rounded animate-pulse" />
            <div className="h-6 w-24 bg-muted rounded animate-pulse" />
            <div className="h-2 w-20 bg-muted rounded animate-pulse" />
          </div>
        ))}
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-5 h-72 animate-pulse" />
        <div className="rounded-xl border border-border bg-card p-5 h-72 animate-pulse" />
      </div>
      <div className="rounded-xl border border-border bg-card p-5 space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-12 bg-muted/40 rounded animate-pulse" />
        ))}
      </div>
    </div>
  );
}
