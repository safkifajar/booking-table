import { cn } from "@/lib/utils";

/** Badge hobi/minat (pill abu-abu). max=batas tampil, sisanya "+N". */
export function HobbyBadges({
  hobbies,
  max = 4,
  className,
}: {
  hobbies: string[];
  max?: number;
  className?: string;
}) {
  if (!hobbies || hobbies.length === 0) return null;
  const shown = hobbies.slice(0, max);
  const rest = hobbies.length - shown.length;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {shown.map((h) => (
        <span
          key={h}
          className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/50"
        >
          {h}
        </span>
      ))}
      {rest > 0 && (
        <span className="text-[10px] text-muted-foreground/60 px-1 self-center">
          +{rest}
        </span>
      )}
    </div>
  );
}
