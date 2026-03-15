import type { Project } from '@/types/project'
import type { ProjectAssetsData } from '../hooks/useProjectAssets'

export interface DeleteProjectLocationContext {
    previousAssets: ProjectAssetsData | undefined
    previousProject: Project | undefined
}

export function removeLocationFromAssets(
    previous: ProjectAssetsData | undefined,
    locationId: string,
): ProjectAssetsData | undefined {
    if (!previous) return previous
    return {
        ...previous,
        locations: (previous.locations || []).filter((location) => location.id !== locationId),
    }
}

export function removeLocationFromProject(
    previous: Project | undefined,
    locationId: string,
): Project | undefined {
    if (!previous?.novelPromotionData) return previous
    const currentLocations = previous.novelPromotionData.locations || []
    return {
        ...previous,
        novelPromotionData: {
            ...previous.novelPromotionData,
            locations: currentLocations.filter((location) => location.id !== locationId),
        },
    }
}
