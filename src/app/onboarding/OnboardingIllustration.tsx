/**
 * Ilustrasi layar intro onboarding — kartu profil minimalis (line-art) dgn warna
 * brand SOHO. Inline SVG (pakai var theme), clean & modern.
 */
export function FramedCupIllustration({
  className,
}: {
  className?: string;
}) {
  const P = "var(--primary)";
  const cream = "var(--brand-cream, #f0e6d2)";
  return (
    <svg
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Profile card"
    >
      {/* Blob background */}
      <path
        d="M100 22c30 0 60 12 68 40s-6 60-28 78-58 24-84 6S22 92 34 66 60 22 100 22Z"
        fill={P}
        opacity="0.1"
      />

      {/* Kartu profil */}
      <rect
        x="52"
        y="46"
        width="96"
        height="108"
        rx="14"
        fill="var(--card)"
        stroke={P}
        strokeWidth="3"
      />

      {/* Avatar */}
      <circle cx="100" cy="82" r="20" fill={P} opacity="0.12" />
      <circle cx="100" cy="76" r="8" fill={P} />
      <path
        d="M84 98a16 16 0 0 1 32 0"
        stroke={P}
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />

      {/* Garis teks (nama + detail) */}
      <rect x="72" y="116" width="56" height="6" rx="3" fill={P} opacity="0.85" />
      <rect x="80" y="130" width="40" height="5" rx="2.5" fill={P} opacity="0.35" />

      {/* Tag pill (aksen brand) */}
      <rect x="76" y="140" width="20" height="8" rx="4" fill={P} opacity="0.2" />
      <rect x="100" y="140" width="24" height="8" rx="4" fill={P} opacity="0.2" />

      {/* Badge hati (logo vibe) di pojok kartu */}
      <circle cx="140" cy="52" r="13" fill={P} />
      <path
        d="M140 48c-1.6-2-5-2-6.2.3-.9 1.8.3 3.8 1.8 5.1l4.4 3.8 4.4-3.8c1.5-1.3 2.7-3.3 1.8-5.1-1.2-2.3-4.6-2.3-6.2-.3Z"
        fill={cream}
      />

      {/* Sparkle aksen */}
      <path
        d="M150 118l1.8 4.4 4.4 1.8-4.4 1.8-1.8 4.4-1.8-4.4-4.4-1.8 4.4-1.8 1.8-4.4Z"
        fill={P}
        opacity="0.7"
      />
      <circle cx="56" cy="120" r="2.5" fill={P} opacity="0.5" />
    </svg>
  );
}
