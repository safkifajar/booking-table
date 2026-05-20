export default function Loading() {
  return (
    <main className="flex-1 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="space-y-2">
          <div className="h-3 w-24 bg-muted rounded animate-pulse" />
          <div className="h-6 w-48 bg-muted rounded animate-pulse" />
          <div className="h-3 w-32 bg-muted rounded animate-pulse" />
        </div>
        <div className="h-11 w-full bg-muted rounded animate-pulse" />
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-muted rounded animate-pulse" />
          ))}
        </div>
        <div className="h-11 w-full bg-muted rounded animate-pulse" />
      </div>
    </main>
  );
}
