"use client";

import * as React from "react";

const COLORS = ["#c9a961", "#e6c478", "#a8893f", "#f5f5f0", "#10b981"];
const PIECES = 80;

interface Piece {
  id: number;
  left: number;
  delay: number;
  duration: number;
  color: string;
  size: number;
  rotation: number;
}

function generatePieces(): Piece[] {
  return Array.from({ length: PIECES }).map((_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.4,
    duration: 2.2 + Math.random() * 1.5,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    size: 6 + Math.random() * 8,
    rotation: Math.random() * 360,
  }));
}

/**
 * Burst confetti effect — auto-fires when `trigger` becomes true, then resets.
 * Pure CSS, no library. Renders briefly (~3s) then unmounts.
 */
export function PaymentConfetti({ trigger }: { trigger: boolean }) {
  const [active, setActive] = React.useState(false);
  const [pieces, setPieces] = React.useState<Piece[]>([]);
  const fired = React.useRef(false);

  React.useEffect(() => {
    if (trigger && !fired.current) {
      fired.current = true;
      setPieces(generatePieces());
      setActive(true);
      const t = setTimeout(() => setActive(false), 4000);
      return () => clearTimeout(t);
    }
    if (!trigger) {
      // Reset so next trigger fires again
      fired.current = false;
    }
  }, [trigger]);

  if (!active) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 9998,
        overflow: "hidden",
      }}
    >
      {pieces.map((p) => (
        <div
          key={p.id}
          style={{
            position: "absolute",
            top: "-20px",
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.4,
            background: p.color,
            borderRadius: "2px",
            transform: `rotate(${p.rotation}deg)`,
            animation: `confetti-fall ${p.duration}s ${p.delay}s linear forwards`,
            boxShadow: `0 0 4px ${p.color}55`,
          }}
        />
      ))}
    </div>
  );
}
