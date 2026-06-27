import { redirect } from 'next/navigation'
import { getAuthSession } from '@/lib/api-auth'
import { CanvasClient } from './CanvasClient'

/**
 * 无限画布（Infinite Canvas）M1 — 独立创作区，与 v2 劇集流分开（仿 /playground 模式）。
 *
 * 节点式 AI 工作台：角色 / 文生图(t2i) / 图生视频(i2v) 节点，自由拖拉连线、串短剧分镜。
 * UI 对标 LibTV 画布。M1 = 自写无限画布壳（平移/缩放/双击生节点/拖拉）；生成接 Task
 * spine、导演台 3D 站位、拼接序列、接 polyfilm 走点数 = M2+。
 *
 * 2026-06-27 启动。设计/实作参考见 memory project_kuiperai_canvas_feature。
 */
interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function CanvasPage({ params }: PageProps) {
  const { locale } = await params

  const session = await getAuthSession()
  if (!session?.user?.id) {
    redirect(`/${locale}/auth/signin?callbackUrl=${encodeURIComponent(`/${locale}/canvas`)}`)
  }

  return <CanvasClient locale={locale} />
}
