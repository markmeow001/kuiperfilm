'use client'

import { useEffect, useRef, useState } from 'react'

export function useAudioPreview() {
  const [playingKey, setPlayingKey] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
    }
  }, [])

  function toggle(key: string, url: string | null) {
    if (!url) return
    audioRef.current?.pause()
    audioRef.current = null
    setErrorKey(null)

    if (playingKey === key) {
      setPlayingKey(null)
      return
    }

    const audio = new Audio(url)
    audio.onended = () => {
      setPlayingKey((current) => (current === key ? null : current))
      if (audioRef.current === audio) audioRef.current = null
    }
    audio.onerror = () => {
      setPlayingKey((current) => (current === key ? null : current))
      setErrorKey(key)
      if (audioRef.current === audio) audioRef.current = null
    }
    audioRef.current = audio
    setPlayingKey(key)
    void audio.play().catch(() => {
      setPlayingKey((current) => (current === key ? null : current))
      setErrorKey(key)
      if (audioRef.current === audio) audioRef.current = null
    })
  }

  return { playingKey, errorKey, toggle }
}
