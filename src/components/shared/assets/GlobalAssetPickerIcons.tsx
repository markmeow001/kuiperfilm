import { AppIcon } from '@/components/ui/icons'

// 内联 SVG 图标组件
export const XMarkIcon = ({ className }: { className?: string }) => (
    <AppIcon name="close" className={className} />
)

export const MagnifyingGlassIcon = ({ className }: { className?: string }) => (
    <AppIcon name="search" className={className} />
)

export const UserIcon = ({ className }: { className?: string }) => (
    <AppIcon name="userAlt" className={className} />
)

export const PhotoIcon = ({ className }: { className?: string }) => (
    <AppIcon name="image" className={className} />
)

export const CheckCircleIcon = ({ className }: { className?: string }) => (
    <AppIcon name="badgeCheck" className={className} />
)

export const MicrophoneIcon = ({ className }: { className?: string }) => (
    <AppIcon name="mic" className={className} />
)
