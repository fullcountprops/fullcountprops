import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'FullCountProps — Monte Carlo MLB Prop Analytics'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ fontSize: 72, marginBottom: 8, display: 'flex' }}>⚾</div>
        <div
          style={{
            fontSize: 64,
            fontWeight: 800,
            color: 'white',
            letterSpacing: '-0.02em',
            marginBottom: 16,
            display: 'flex',
          }}
        >
          FullCountProps
        </div>
        <div
          style={{
            fontSize: 28,
            color: '#94a3b8',
            maxWidth: 700,
            textAlign: 'center',
            lineHeight: 1.4,
            display: 'flex',
          }}
        >
          Monte Carlo MLB Prop Analytics
        </div>
        <div
          style={{
            display: 'flex',
            gap: 40,
            marginTop: 48,
            color: '#22c55e',
            fontSize: 22,
            fontWeight: 600,
          }}
        >
          <span style={{ display: 'flex' }}>5,000 Simulations</span>
          <span style={{ display: 'flex', color: '#475569' }}>|</span>
          <span style={{ display: 'flex' }}>24 Statcast Features</span>
          <span style={{ display: 'flex', color: '#475569' }}>|</span>
          <span style={{ display: 'flex' }}>+8.7% ROI</span>
        </div>
      </div>
    ),
    { ...size }
  )
}
