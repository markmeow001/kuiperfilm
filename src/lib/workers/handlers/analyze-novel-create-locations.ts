import { prisma } from '@/lib/prisma'
import { removeLocationPromptSuffix } from '@/lib/constants'
import { readText, nameMatchesWithAlias } from './analyze-novel-utils'

const INVALID_NAME_KEYWORDS = ['幻想', '抽象', '无明确', '空间锚点', '未说明', '不明确']

export async function processNewLocations(params: {
  parsedLocations: Array<Record<string, unknown>>
  existingLocations: Array<{ name: string }>
  novelPromotionProjectId: string
}): Promise<Array<{ id: string }>> {
  const { parsedLocations, existingLocations, novelPromotionProjectId } = params
  const created: Array<{ id: string }> = []

  for (const item of parsedLocations) {
    const name = readText(item.name).trim()
    if (!name) continue

    const descriptionsRaw = Array.isArray(item.descriptions)
      ? (item.descriptions as unknown[])
      : (readText(item.description) ? [readText(item.description)] : [])
    const descriptions = descriptionsRaw
      .map((value) => readText(value))
      .filter(Boolean)
    const firstDescription = descriptions[0] || ''
    const isInvalid = INVALID_NAME_KEYWORDS.some(
      (keyword) => name.includes(keyword) || firstDescription.includes(keyword),
    )
    if (isInvalid) continue

    const existsInLibrary = existingLocations.some(
      (location) => nameMatchesWithAlias(location.name, name),
    )
    if (existsInLibrary) continue

    const location = await prisma.novelPromotionLocation.create({
      data: {
        novelPromotionProjectId,
        name,
        summary: readText(item.summary) || null,
      },
      select: { id: true },
    })

    const cleanDescriptions = descriptions.map((value) => removeLocationPromptSuffix(value || ''))
    for (let i = 0; i < cleanDescriptions.length; i += 1) {
      await prisma.locationImage.create({
        data: {
          locationId: location.id,
          imageIndex: i,
          description: cleanDescriptions[i],
        },
      })
    }

    created.push(location)
  }

  return created
}
