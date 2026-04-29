'use client'

type StepStatus = 'empty' | 'active' | 'processing' | 'ready'

interface NavItemData {
    id: string
    icon: string
    label: string
    status: StepStatus
    href?: string  // 可选的链接地址
    disabled?: boolean  // 是否禁用（开发中）
    disabledLabel?: string  // 禁用时显示的提示文字
}

interface CapsuleNavProps {
    items: NavItemData[]
    activeId: string
    onItemClick: (id: string) => void
    projectId?: string  // 用于构建链接
    episodeId?: string  // 用于构建链接
}

/**
 * NavItem - 胶囊导航单项
 * 支持左键点击切换、中键/Ctrl+点击在新标签页打开
 */
function NavItem({
    active,
    onClick,
    label,
    status,
    href,
    disabled,
    disabledLabel
}: {
    active: boolean
    onClick: () => void
    label: string
    status: StepStatus
    href?: string
    disabled?: boolean
    disabledLabel?: string
}) {
    const handleClick = (e: React.MouseEvent) => {
        if (disabled) return
        if (e.button === 1 || e.ctrlKey || e.metaKey) {
            if (href) {
                window.open(href, '_blank')
            }
            return
        }
        onClick()
    }

    const handleAuxClick = (e: React.MouseEvent) => {
        if (disabled) return
        if (e.button === 1 && href) {
            e.preventDefault()
            window.open(href, '_blank')
        }
    }

    return (
        <div className="relative group">
            <button
                onClick={handleClick}
                onAuxClick={handleAuxClick}
                disabled={disabled}
                className={`
                    relative flex min-h-[52px] items-center gap-1 px-6 pt-3.5 pb-4 transition-all duration-300 ease-out
                    ${disabled
                        ? 'cursor-not-allowed'
                        : active
                            ? 'text-[var(--glass-tone-info-fg)]'
                            : 'text-[var(--glass-text-tertiary)] hover:text-[var(--glass-text-primary)]'}
                    ${!disabled && 'active:scale-[0.98]'}
                `}
            >
                {disabled ? (
                    <span className="text-base font-medium text-[var(--glass-text-tertiary)] opacity-80">
                        {label}
                    </span>
                ) : (
                    <span className="text-base font-semibold">{label}</span>
                )}
                {/* 底部指示条 */}
                <span className={`absolute bottom-1.5 left-1/2 -translate-x-1/2 h-[3px] rounded-full transition-all duration-300 ease-out
                    ${active
                        ? 'w-6 bg-gradient-to-r from-[var(--glass-accent-from)] to-[var(--glass-accent-to)] shadow-[0_2px_8px_var(--glass-accent-shadow-soft)]'
                        : 'w-0 bg-transparent'
                    }`}
                />
                {status === 'ready' && !disabled && (
                    <span className={`absolute top-2 right-2 w-1.5 h-1.5 rounded-full transition-colors
                        ${active ? 'bg-[var(--glass-tone-info-fg)]' : 'bg-[var(--glass-tone-success-fg)]'}`}
                    />
                )}
                {status === 'processing' && !disabled && (
                    <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-[var(--glass-accent-from)] animate-pulse" />
                )}
            </button>
            {disabled && disabledLabel && (
                <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-10">
                    <div className="glass-surface-soft text-xs px-3 py-2 whitespace-nowrap text-[var(--glass-text-primary)]">
                        {disabledLabel}
                    </div>
                    <div className="absolute left-1/2 -translate-x-1/2 -top-1 w-2 h-2 bg-[var(--glass-bg-surface-strong)] rotate-45 border-l border-t border-[var(--glass-stroke-base)]" />
                </div>
            )}
        </div>
    )
}


/**
 * CapsuleNav - 胶囊形态悬浮导航
 * 支持中键和Ctrl+点击在新标签页打开
 */
export function CapsuleNav({ items, activeId, onItemClick, projectId, episodeId }: CapsuleNavProps) {
    // 构建每个导航项的链接地址
    const buildHref = (stageId: string): string | undefined => {
        if (!projectId) return undefined
        const params = new URLSearchParams()
        params.set('stage', stageId)
        if (episodeId) {
            params.set('episode', episodeId)
        }
        return `/workspace/${projectId}?${params.toString()}`
    }

    return (
        <nav className="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-fadeInDown">
            <div
                className="flex rounded-full px-2 py-1"
                style={{
                    background: 'rgba(255,255,255,0.55)',
                    backdropFilter: 'blur(24px) saturate(1.6)',
                    WebkitBackdropFilter: 'blur(24px) saturate(1.6)',
                    border: '1px solid rgba(255,255,255,0.45)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.06), 0 1.5px 6px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.7)',
                }}
            >
                {items.map((item) => (
                    <NavItem
                        key={item.id}
                        active={activeId === item.id}
                        onClick={() => onItemClick(item.id)}
                        label={item.label}
                        status={item.status}
                        href={buildHref(item.id)}
                        disabled={item.disabled}
                        disabledLabel={item.disabledLabel}
                    />
                ))}
            </div>
        </nav>
    )
}

export default CapsuleNav
