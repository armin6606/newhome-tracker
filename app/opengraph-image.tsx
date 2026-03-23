import { ImageResponse } from "next/og"

export const runtime = "edge"
export const alt = "NewKey.us — New Construction Homes in Orange County"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #1e3a5f 0%, #0f2340 100%)",
          fontFamily: "sans-serif",
        }}
      >
        {/* Logo area */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            marginBottom: "32px",
          }}
        >
          <div
            style={{
              width: "80px",
              height: "80px",
              borderRadius: "50%",
              background: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "40px",
            }}
          >
            🏠
          </div>
          <span
            style={{
              fontSize: "64px",
              fontWeight: 800,
              color: "white",
              letterSpacing: "-1px",
            }}
          >
            NewKey.us
          </span>
        </div>

        {/* Tagline */}
        <p
          style={{
            fontSize: "32px",
            color: "#93c5fd",
            margin: 0,
            textAlign: "center",
            maxWidth: "900px",
          }}
        >
          New Construction Homes in Orange County, CA
        </p>

        {/* Sub-tagline */}
        <p
          style={{
            fontSize: "22px",
            color: "#64748b",
            marginTop: "16px",
            textAlign: "center",
          }}
        >
          Track prices · Compare floor plans · Monitor availability
        </p>

        {/* Bottom bar */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "8px",
            background: "linear-gradient(90deg, #f59e0b, #ef4444, #3b82f6)",
          }}
        />
      </div>
    ),
    { ...size }
  )
}
