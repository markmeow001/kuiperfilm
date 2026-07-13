import React from 'react'
import { AbsoluteFill } from 'remotion'

export interface StoryboardStillItem {
  title: string
  imageUrl?: string | null
}

export interface StoryboardStillProps {
  items: StoryboardStillItem[]
  columns: 2 | 3 | 4
  showShotNumber: boolean
}

export function StoryboardStill({ items, columns, showShotNumber }: StoryboardStillProps) {
  const gap = 32
  return <AbsoluteFill style={{ background: '#101012', padding: 64, fontFamily: 'Arial, sans-serif', color: '#f2f2f4' }}>
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap, height: '100%' }}>
      {items.map((item, index) => <div key={`${index}-${item.title}`} style={{ minHeight: 0, display: 'flex', flexDirection: 'column', borderRadius: 18, overflow: 'hidden', background: '#1b1b1f', border: '2px solid rgba(255,255,255,0.1)' }}>
        <div style={{ position: 'relative', flex: 1, minHeight: 0, background: `hsl(${(index * 47) % 360} 30% 22%)` }}>
          {/* Remotion renders this in headless Chromium; next/image is not available in the composition bundle. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {item.imageUrl ? <img src={item.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
          {showShotNumber ? <div style={{ position: 'absolute', left: 18, top: 18, borderRadius: 10, padding: '8px 14px', fontSize: 28, fontWeight: 700, background: 'rgba(0,0,0,0.72)' }}>{String(index + 1).padStart(2, '0')}</div> : null}
        </div>
        <div style={{ padding: '14px 18px', fontSize: 24, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
      </div>)}
    </div>
  </AbsoluteFill>
}
