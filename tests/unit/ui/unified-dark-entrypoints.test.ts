import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const signInSource = readFileSync(
  'src/app/[locale]/auth/signin/page.tsx',
  'utf8',
)
const signUpSource = readFileSync(
  'src/app/[locale]/auth/signup/page.tsx',
  'utf8',
)
const previewSource = readFileSync(
  'src/app/[locale]/preview/page.tsx',
  'utf8',
)

describe('unified dark public entry points', () => {
  it('signin uses the night-blue surface stack with blue action and cyan focus', () => {
    expect(signInSource).toContain('bg-[#070B0F]')
    expect(signInSource).toContain('bg-[#0D141B]')
    expect(signInSource).toContain('bg-[#111B24]/95')
    expect(signInSource).toContain('bg-[#3E73B9]')
    expect(signInSource).toContain('focus:border-[#55AFC0]')
    expect(signInSource).toContain('[--primary-400:#55AFC0]')
    expect(signInSource).not.toMatch(/(?:amber|orange|fuchsia|magenta)-/)
  })

  it('signup matches signin with cyan focus, blue CTA, and semantic form feedback', () => {
    expect(signUpSource).toContain('bg-[#070B0F]')
    expect(signUpSource).toContain('bg-[#0D141B]')
    expect(signUpSource).toContain('bg-[#111B24]/95')
    expect(signUpSource).toContain('bg-[#3E73B9]')
    expect(signUpSource).toContain('[--primary-400:#55AFC0]')
    expect(signUpSource).toContain('autoComplete="username"')
    expect(signUpSource.match(/autoComplete="new-password"/g)).toHaveLength(2)
    expect(signUpSource).toContain('role="alert"')
    expect(signUpSource).toContain('role="status"')
    expect(signUpSource).not.toMatch(/(?:amber|orange|fuchsia|magenta|rose|stone)-/)
  })

  it('preview replaces the fixed mobile rail with a bounded top step switcher', () => {
    expect(previewSource).toContain(
      'grid grid-cols-3 gap-2 px-3 py-3 sm:grid-cols-6 md:block',
    )
    expect(previewSource).toContain('md:h-screen md:w-64')
    expect(previewSource).not.toContain('<aside className="w-64')
    expect(previewSource).toContain('overflow-x-hidden bg-[#070B0F]')
    expect(previewSource).toContain('min-height: 44px')
  })

  it('preview keeps tool states cyan, primary actions blue, and delivery gold', () => {
    expect(previewSource).toContain('focus-visible:ring-[#55AFC0]')
    expect(previewSource).toContain('bg-[#3E73B9]')
    expect(previewSource).toContain('bg-[#C89432]')
    expect(previewSource).not.toMatch(/(?:amber|orange|fuchsia|magenta|rose|stone)-/)
  })

  it('preview keeps muted copy and process metadata above the audited contrast floor', () => {
    expect(previewSource).toContain('text-[#7F9099]')
    expect(previewSource).toContain('text-[#79C7D4]')
    expect(previewSource).not.toMatch(/#(?:2E6976|6D7E89|3D8797)(?:\/[0-9]+)?/)
  })
})
