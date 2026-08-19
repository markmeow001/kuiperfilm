import { render } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import enCollab from '../../../messages/en/collab.json'
import zhCollab from '../../../messages/zh/collab.json'
import { Sidebar } from '@/components/v2/Sidebar'
import { TopBar } from '@/components/v2/TopBar'

const mocks = vi.hoisted(() => ({
  locale: 'en',
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: mocks.locale }),
  usePathname: () => `/${mocks.locale}/v2/workspace/project-1`,
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'user-1' } },
    status: 'authenticated',
  }),
}))

vi.mock('@/lib/query/hooks/useProjectData', () => ({
  useProjectData: () => ({ data: { name: 'Night Train' } }),
}))

vi.mock('@/lib/query/hooks/useProjectAccess', () => ({
  useProjectAccess: () => ({
    isLoading: false,
    allowed: false,
    role: null,
    canEdit: false,
  }),
}))

vi.mock('@/components/v2/UserMenu', () => ({ UserMenu: () => null }))
vi.mock('@/components/v2/NotificationBell', () => ({
  NotificationBell: () => null,
}))
vi.mock('@/components/v2/RequestEditAccessModal', () => ({
  RequestEditAccessModal: () => null,
}))

function renderShell(locale: 'zh' | 'en') {
  mocks.locale = locale
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ collab: locale === 'en' ? enCollab : zhCollab }}
    >
      <div>
        <TopBar
          currentStep="subjects"
          projectName="Night Train"
          locale={locale}
        />
        <Sidebar
          currentStep="subjects"
          locale={locale}
          onSelect={() => undefined}
        />
      </div>
    </NextIntlClientProvider>,
  )
}

describe('V2 workspace locale presentation', () => {
  beforeEach(() => {
    mocks.locale = 'en'
  })

  it('English Project Home shell uses English stage and navigation copy only', () => {
    const { container } = renderShell('en')

    expect(container).toHaveTextContent('Breakdown')
    expect(container).toHaveTextContent('Characters, locations and props')
    expect(container).toHaveTextContent('Production flow')
    expect(container).toHaveTextContent('Back to all projects')
    expect(container).not.toHaveTextContent(/首頁|劇本拆解|分鏡|配音|成片|回到所有專案/)
  })

  it('Traditional Chinese Project Home shell does not leak English stage subtitles', () => {
    const { container } = renderShell('zh')

    expect(container).toHaveTextContent('劇本拆解')
    expect(container).toHaveTextContent('角色、場景與道具')
    expect(container).toHaveTextContent('製作流程')
    expect(container).toHaveTextContent('回到所有專案')
    expect(container).not.toHaveTextContent(/Mode|Script|Breakdown|Final Cut|Production flow/)
  })
})
