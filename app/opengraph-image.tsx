import { ImageResponse } from "next/og";

export const alt = "CEOClaw — AI project cockpit, PH ready";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          position: "relative",
          overflow: "hidden",
          background:
            "radial-gradient(circle at top left, rgba(59,130,246,0.35), transparent 32%), linear-gradient(135deg, #020617 0%, #0f172a 54%, #1d4ed8 100%)",
          color: "#fff",
          fontFamily: "Inter, Arial, sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, transparent 35%, rgba(255,255,255,0.02) 100%)",
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            height: "100%",
            padding: 64,
            position: "relative",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 24,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  letterSpacing: "0.24em",
                  textTransform: "uppercase",
                }}
              >
                CEOClaw
              </div>
              <div
                style={{
                  fontSize: 24,
                  color: "rgba(255,255,255,0.82)",
                }}
              >
                AI + EVM + Telegram
              </div>
            </div>
            <div
              style={{
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.12)",
                padding: "14px 20px",
                fontSize: 22,
                fontWeight: 600,
              }}
            >
              PH ready
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 28, maxWidth: 860 }}>
            <div
              style={{
                fontSize: 74,
                fontWeight: 700,
                lineHeight: 0.95,
                letterSpacing: "-0.06em",
              }}
            >
              AI project cockpit
            </div>
            <div
              style={{
                fontSize: 30,
                lineHeight: 1.35,
                color: "rgba(255,255,255,0.86)",
                maxWidth: 760,
              }}
            >
              Facts, budgets, evidence, and short action-ready briefings for project teams.
            </div>
          </div>

          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 22, color: "rgba(255,255,255,0.82)" }}>
            <span
              style={{
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.16)",
                padding: "12px 18px",
                background: "rgba(255,255,255,0.08)",
              }}
            >
              Grounded answers
            </span>
            <span
              style={{
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.16)",
                padding: "12px 18px",
                background: "rgba(255,255,255,0.08)",
              }}
            >
              Finance-aware
            </span>
            <span
              style={{
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.16)",
                padding: "12px 18px",
                background: "rgba(255,255,255,0.08)",
              }}
            >
              Public demo
            </span>
          </div>
        </div>
      </div>
    ),
    size
  );
}
