import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ProjectGraphPageInfo, ProjectGraphSource } from "./types";

export type ProjectGraphQueryResult =
  | {
      status: "ok";
      source: ProjectGraphSource;
      pageInfo: ProjectGraphPageInfo;
    }
  | { status: "project_not_found" }
  | { status: "episode_not_found" }
  | { status: "cursor_not_found" }
  | {
      status: "graph_too_large";
      sceneCount: number;
      shotCount: number;
      maxScenes: number;
      maxShots: number;
    };

export interface QueryProjectGraphInput {
  projectId: string;
  episodeId?: string;
  cursor?: string;
  limit: number;
}

export const PROJECT_GRAPH_MAX_SCENES = 500;
export const PROJECT_GRAPH_MAX_SHOTS = 2_500;

const EPISODE_PAGE_SELECT = {
  id: true,
  episodeNumber: true,
  name: true,
  updatedAt: true,
} satisfies Prisma.NovelPromotionEpisodeSelect;

const CLIP_GRAPH_SELECT = {
  id: true,
  episodeId: true,
  summary: true,
  start: true,
  updatedAt: true,
} satisfies Prisma.NovelPromotionClipSelect;

const STORYBOARD_GRAPH_SELECT = {
  id: true,
  clipId: true,
  episodeId: true,
  panelCount: true,
  updatedAt: true,
} satisfies Prisma.NovelPromotionStoryboardSelect;

const PANEL_GRAPH_SELECT = {
  id: true,
  storyboardId: true,
  panelIndex: true,
  panelNumber: true,
  shotType: true,
  imageMediaId: true,
  videoMediaId: true,
  imageUrl: true,
  videoUrl: true,
  characters: true,
  location: true,
  updatedAt: true,
} satisfies Prisma.NovelPromotionPanelSelect;

type EpisodePageRow = Prisma.NovelPromotionEpisodeGetPayload<{
  select: typeof EPISODE_PAGE_SELECT;
}>;

type GraphChildrenResult =
  | { status: "ok"; episodes: ProjectGraphSource["episodes"] }
  | Extract<ProjectGraphQueryResult, { status: "graph_too_large" }>;

async function loadGraphChildren(
  episodeRows: readonly EpisodePageRow[],
): Promise<GraphChildrenResult> {
  const episodeIds = episodeRows.map((episode) => episode.id);
  if (episodeIds.length === 0) return { status: "ok", episodes: [] };

  const clips = await prisma.novelPromotionClip.findMany({
    where: { episodeId: { in: episodeIds } },
    orderBy: [{ episodeId: "asc" }, { start: "asc" }, { id: "asc" }],
    take: PROJECT_GRAPH_MAX_SCENES + 1,
    select: CLIP_GRAPH_SELECT,
  });
  if (clips.length > PROJECT_GRAPH_MAX_SCENES) {
    return {
      status: "graph_too_large",
      sceneCount: clips.length,
      shotCount: 0,
      maxScenes: PROJECT_GRAPH_MAX_SCENES,
      maxShots: PROJECT_GRAPH_MAX_SHOTS,
    };
  }

  const clipIds = clips.map((clip) => clip.id);
  const storyboards =
    clipIds.length > 0
      ? await prisma.novelPromotionStoryboard.findMany({
          where: { clipId: { in: clipIds } },
          orderBy: [{ clipId: "asc" }, { id: "asc" }],
          take: PROJECT_GRAPH_MAX_SCENES + 1,
          select: STORYBOARD_GRAPH_SELECT,
        })
      : [];
  const episodeIdByClip = new Map(
    clips.map((clip) => [clip.id, clip.episodeId]),
  );
  const storyboardIds = storyboards
    .filter(
      (storyboard) =>
        episodeIdByClip.get(storyboard.clipId) === storyboard.episodeId,
    )
    .map((storyboard) => storyboard.id);
  const panels =
    storyboardIds.length > 0
      ? await prisma.novelPromotionPanel.findMany({
          where: { storyboardId: { in: storyboardIds } },
          orderBy: [
            { storyboardId: "asc" },
            { panelIndex: "asc" },
            { id: "asc" },
          ],
          take: PROJECT_GRAPH_MAX_SHOTS + 1,
          select: PANEL_GRAPH_SELECT,
        })
      : [];

  if (panels.length > PROJECT_GRAPH_MAX_SHOTS) {
    return {
      status: "graph_too_large",
      sceneCount: clips.length,
      shotCount: panels.length,
      maxScenes: PROJECT_GRAPH_MAX_SCENES,
      maxShots: PROJECT_GRAPH_MAX_SHOTS,
    };
  }

  const panelsByStoryboard = new Map<string, typeof panels>();
  for (const panel of panels) {
    const items = panelsByStoryboard.get(panel.storyboardId) ?? [];
    items.push(panel);
    panelsByStoryboard.set(panel.storyboardId, items);
  }
  const storyboardByClip = new Map(
    storyboards.map((storyboard) => [storyboard.clipId, storyboard]),
  );
  const clipsByEpisode = new Map<string, typeof clips>();
  for (const clip of clips) {
    const items = clipsByEpisode.get(clip.episodeId) ?? [];
    items.push(clip);
    clipsByEpisode.set(clip.episodeId, items);
  }

  return {
    status: "ok",
    episodes: episodeRows.map((episode) => ({
      ...episode,
      clips: (clipsByEpisode.get(episode.id) ?? []).map((clip) => {
        const storyboard = storyboardByClip.get(clip.id);
        return {
          id: clip.id,
          summary: clip.summary,
          start: clip.start,
          updatedAt: clip.updatedAt,
          storyboard: storyboard
            ? {
                id: storyboard.id,
                episodeId: storyboard.episodeId,
                panelCount: storyboard.panelCount,
                updatedAt: storyboard.updatedAt,
                panels: panelsByStoryboard.get(storyboard.id) ?? [],
              }
            : null,
        };
      }),
    })),
  };
}

/**
 * Reads the existing production hierarchy without inventing new domain rows.
 *
 * The endpoint intentionally pages at the episode boundary. That keeps every
 * returned episode internally complete (scene/storyboard/shot descendants are
 * not split across pages) and avoids loading an entire large project graph.
 */
export async function queryProjectGraph(
  input: QueryProjectGraphInput,
): Promise<ProjectGraphQueryResult> {
  const project = await prisma.project.findFirst({
    where: {
      id: input.projectId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      updatedAt: true,
      novelPromotionData: {
        select: { id: true },
      },
    },
  });

  if (!project) return { status: "project_not_found" };

  const novelPromotionProjectId = project.novelPromotionData?.id;
  if (!novelPromotionProjectId) {
    if (input.episodeId) return { status: "episode_not_found" };
    if (input.cursor) return { status: "cursor_not_found" };
    return {
      status: "ok",
      source: {
        project: {
          id: project.id,
          name: project.name,
          updatedAt: project.updatedAt,
        },
        episodes: [],
      },
      pageInfo: {
        limit: input.limit,
        totalEpisodes: 0,
        endCursor: null,
        hasNextPage: false,
      },
    };
  }

  if (input.episodeId) {
    const episode = await prisma.novelPromotionEpisode.findFirst({
      where: {
        id: input.episodeId,
        novelPromotionProjectId,
      },
      select: EPISODE_PAGE_SELECT,
    });

    if (!episode) return { status: "episode_not_found" };
    const graphChildren = await loadGraphChildren([episode]);
    if (graphChildren.status !== "ok") return graphChildren;

    return {
      status: "ok",
      source: {
        project: {
          id: project.id,
          name: project.name,
          updatedAt: project.updatedAt,
        },
        episodes: graphChildren.episodes,
      },
      pageInfo: {
        limit: 1,
        totalEpisodes: 1,
        endCursor: episode.id,
        hasNextPage: false,
      },
    };
  }

  if (input.cursor) {
    const cursorEpisode = await prisma.novelPromotionEpisode.findFirst({
      where: {
        id: input.cursor,
        novelPromotionProjectId,
      },
      select: { id: true },
    });
    if (!cursorEpisode) return { status: "cursor_not_found" };
  }

  const [totalEpisodes, episodeRows] = await Promise.all([
    prisma.novelPromotionEpisode.count({
      where: { novelPromotionProjectId },
    }),
    prisma.novelPromotionEpisode.findMany({
      where: { novelPromotionProjectId },
      orderBy: [{ episodeNumber: "asc" }, { id: "asc" }],
      take: input.limit + 1,
      ...(input.cursor
        ? {
            cursor: { id: input.cursor },
            skip: 1,
          }
        : {}),
      select: EPISODE_PAGE_SELECT,
    }),
  ]);
  const hasNextPage = episodeRows.length > input.limit;
  const episodePage = hasNextPage
    ? episodeRows.slice(0, input.limit)
    : episodeRows;
  const graphChildren = await loadGraphChildren(episodePage);
  if (graphChildren.status !== "ok") return graphChildren;

  return {
    status: "ok",
    source: {
      project: {
        id: project.id,
        name: project.name,
        updatedAt: project.updatedAt,
      },
      episodes: graphChildren.episodes,
    },
    pageInfo: {
      limit: input.limit,
      totalEpisodes,
      endCursor: episodePage.at(-1)?.id ?? null,
      hasNextPage,
    },
  };
}
