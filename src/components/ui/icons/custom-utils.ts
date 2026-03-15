import type { ForwardRefExoticComponent, RefAttributes } from 'react'
import { createLucideIcon as createLucideIconBase, type IconNode, type LucideProps } from 'lucide-react'

export type CustomIconComponent = ForwardRefExoticComponent<Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>>

export function createLucideIcon(name: string, iconNode: IconNode) {
  const keyedIconNode: IconNode = iconNode.map(([tag, attrs], index) => [
    tag,
    {
      ...attrs,
      key: `${name}-${index}`,
    },
  ])
  return createLucideIconBase(name, keyedIconNode)
}

export type { IconNode, LucideProps }
