import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "SOHO Social House — Reserve your night";

export default async function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background:
            "radial-gradient(ellipse at top, rgba(201,169,97,0.20), transparent 60%), radial-gradient(ellipse at bottom right, rgba(201,169,97,0.10), transparent 50%), #0a0a0a",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          fontFamily: "system-ui, sans-serif",
          color: "#f5f5f0",
        }}
      >
        {/* Top — Tagline */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 48,
              height: 1,
              background: "rgba(201,169,97,0.8)",
            }}
          />
          <span
            style={{
              fontSize: 18,
              letterSpacing: 8,
              textTransform: "uppercase",
              color: "#c9a961",
              fontWeight: 500,
            }}
          >
            SOHO Social House · Purwokerto
          </span>
        </div>

        {/* Center — Main heading */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 96,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              color: "#f5f5f0",
              display: "flex",
            }}
          >
            Reserve your night.
          </div>
          <div
            style={{
              fontSize: 96,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              backgroundImage:
                "linear-gradient(135deg, #e6c478 0%, #c9a961 50%, #a8893f 100%)",
              backgroundClip: "text",
              color: "transparent",
              display: "flex",
            }}
          >
            Host the vibe.
          </div>
        </div>

        {/* Bottom — Features strip */}
        <div
          style={{
            display: "flex",
            gap: 56,
            paddingTop: 32,
            borderTop: "1px solid rgba(255,255,255,0.1)",
            color: "rgba(255,255,255,0.7)",
            fontSize: 22,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 36, color: "#c9a961", fontWeight: 700 }}>
              Open
            </span>
            <span>Buka meja</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 36, color: "#c9a961", fontWeight: 700 }}>
              Invite
            </span>
            <span>Ajak teman</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 36, color: "#c9a961", fontWeight: 700 }}>
              Order
            </span>
            <span>Pesan bareng</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 36, color: "#c9a961", fontWeight: 700 }}>
              Split
            </span>
            <span>Bayar patungan</span>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
