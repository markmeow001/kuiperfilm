'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AppIcon } from '@/components/ui/icons'

interface VisualDevelopmentImageProps {
  src: string
  alt: string
  className?: string
  buttonClassName?: string
}

export function VisualDevelopmentImage({
  src,
  alt,
  className = 'h-full w-full object-cover',
  buttonClassName = '',
}: VisualDevelopmentImageProps) {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen])

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={`放大圖片：${alt}`}
        className={`group relative block h-full w-full cursor-zoom-in overflow-hidden ${buttonClassName}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className={className} />
        <span className="pointer-events-none absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <AppIcon name="maximize" className="h-3.5 w-3.5" />
        </span>
      </button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`圖片預覽：${alt}`}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setIsOpen(false)
          }}
          className="fixed inset-0 z-[250] flex cursor-zoom-out items-center justify-center bg-black/90 p-4 backdrop-blur-md"
        >
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label="關閉放大圖片"
            className="fixed right-5 top-5 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/70 text-white transition-colors hover:bg-white/15"
          >
            <AppIcon name="close" className="h-5 w-5" />
          </button>
          <figure className="flex max-h-full max-w-full cursor-default flex-col items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              className="max-h-[calc(100vh-5rem)] max-w-[calc(100vw-2rem)] rounded-lg object-contain shadow-2xl shadow-black"
            />
            <figcaption className="max-w-[80vw] truncate font-mono text-[10px] tracking-[0.08em] text-white/65">
              {alt}
            </figcaption>
          </figure>
        </div>,
        document.body,
      )}
    </>
  )
}
