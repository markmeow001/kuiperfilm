import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  project: { findFirst: vi.fn() },
  novelPromotionEpisode: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  novelPromotionClip: { findMany: vi.fn() },
  novelPromotionStoryboard: { findMany: vi.fn() },
  novelPromotionPanel: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const projectRow = {
  id: "project-1",
  name: "Project One",
  updatedAt: new Date("2026-08-08T00:00:00.000Z"),
  novelPromotionData: { id: "novel-project-1" },
};

function episodeRow(id: string, episodeNumber: number) {
  return {
    id,
    episodeNumber,
    name: `Episode ${episodeNumber}`,
    updatedAt: new Date("2026-08-08T00:00:00.000Z"),
    clips: [],
  };
}

describe("queryProjectGraph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.project.findFirst.mockResolvedValue(projectRow);
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(null);
    prismaMock.novelPromotionEpisode.findMany.mockResolvedValue([]);
    prismaMock.novelPromotionEpisode.count.mockResolvedValue(0);
    prismaMock.novelPromotionClip.findMany.mockResolvedValue([]);
    prismaMock.novelPromotionStoryboard.findMany.mockResolvedValue([]);
    prismaMock.novelPromotionPanel.findMany.mockResolvedValue([]);
  });

  it("soft-deleted or missing project returns a not-found state", async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    const { queryProjectGraph } = await import("@/lib/project-graph/query");

    const result = await queryProjectGraph({
      projectId: "missing",
      limit: 20,
    });

    expect(result).toEqual({ status: "project_not_found" });
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "missing", deletedAt: null },
      }),
    );
  });

  it("project without a novel workspace returns a valid empty graph source", async () => {
    prismaMock.project.findFirst.mockResolvedValue({
      ...projectRow,
      novelPromotionData: null,
    });
    const { queryProjectGraph } = await import("@/lib/project-graph/query");

    const result = await queryProjectGraph({
      projectId: "project-1",
      limit: 20,
    });

    expect(result).toMatchObject({
      status: "ok",
      source: { episodes: [] },
      pageInfo: { totalEpisodes: 0, hasNextPage: false },
    });
    expect(prismaMock.novelPromotionEpisode.findMany).not.toHaveBeenCalled();
  });

  it("episode filter is scoped to the current project", async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(
      episodeRow("episode-1", 1),
    );
    const { queryProjectGraph } = await import("@/lib/project-graph/query");

    const result = await queryProjectGraph({
      projectId: "project-1",
      episodeId: "episode-1",
      limit: 20,
    });

    expect(result.status).toBe("ok");
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "episode-1",
          novelPromotionProjectId: "novel-project-1",
        },
      }),
    );
  });

  it("rejects a cursor from another project before using Prisma cursor pagination", async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(null);
    const { queryProjectGraph } = await import("@/lib/project-graph/query");

    const result = await queryProjectGraph({
      projectId: "project-1",
      cursor: "episode-other-project",
      limit: 20,
    });

    expect(result).toEqual({ status: "cursor_not_found" });
    expect(prismaMock.novelPromotionEpisode.findMany).not.toHaveBeenCalled();
  });

  it("pages complete episode subtrees and exposes only the required Prisma fields", async () => {
    prismaMock.novelPromotionEpisode.count.mockResolvedValue(3);
    prismaMock.novelPromotionEpisode.findMany.mockResolvedValue([
      episodeRow("episode-1", 1),
      episodeRow("episode-2", 2),
      episodeRow("episode-3", 3),
    ]);
    const { queryProjectGraph } = await import("@/lib/project-graph/query");

    const result = await queryProjectGraph({
      projectId: "project-1",
      limit: 2,
    });

    expect(result).toMatchObject({
      status: "ok",
      source: {
        episodes: [{ id: "episode-1" }, { id: "episode-2" }],
      },
      pageInfo: {
        limit: 2,
        totalEpisodes: 3,
        endCursor: "episode-2",
        hasNextPage: true,
      },
    });
    const call = prismaMock.novelPromotionEpisode.findMany.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      where: { novelPromotionProjectId: "novel-project-1" },
      take: 3,
      orderBy: [{ episodeNumber: "asc" }, { id: "asc" }],
    });
    const serializedSelect = JSON.stringify(call?.select);
    expect(serializedSelect).not.toContain("storageKey");
    expect(serializedSelect).not.toContain("imagePrompt");
    expect(serializedSelect).not.toContain("videoPrompt");
    expect(serializedSelect).not.toContain("content");
  });

  it("fails explicitly when a page exceeds the global scene node budget", async () => {
    prismaMock.novelPromotionEpisode.findMany.mockResolvedValue([
      episodeRow("episode-1", 1),
    ]);
    prismaMock.novelPromotionEpisode.count.mockResolvedValue(1);
    prismaMock.novelPromotionClip.findMany.mockResolvedValue(
      Array.from({ length: 501 }, (_, index) => ({
        id: `clip-${index}`,
        episodeId: "episode-1",
        summary: `Scene ${index}`,
        start: index,
        updatedAt: new Date("2026-08-08T00:00:00.000Z"),
      })),
    );
    const { queryProjectGraph } = await import("@/lib/project-graph/query");

    const result = await queryProjectGraph({
      projectId: "project-1",
      limit: 20,
    });

    expect(result).toEqual({
      status: "graph_too_large",
      sceneCount: 501,
      shotCount: 0,
      maxScenes: 500,
      maxShots: 2_500,
    });
    expect(prismaMock.novelPromotionStoryboard.findMany).not.toHaveBeenCalled();
    expect(prismaMock.novelPromotionClip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 501 }),
    );
  });

  it("fails explicitly when a page exceeds the global shot node budget", async () => {
    prismaMock.novelPromotionEpisode.findMany.mockResolvedValue([
      episodeRow("episode-1", 1),
    ]);
    prismaMock.novelPromotionEpisode.count.mockResolvedValue(1);
    prismaMock.novelPromotionClip.findMany.mockResolvedValue([
      {
        id: "clip-1",
        episodeId: "episode-1",
        summary: "Scene",
        start: 0,
        updatedAt: new Date("2026-08-08T00:00:00.000Z"),
      },
    ]);
    prismaMock.novelPromotionStoryboard.findMany.mockResolvedValue([
      {
        id: "storyboard-1",
        clipId: "clip-1",
        episodeId: "episode-1",
        panelCount: 2_501,
        updatedAt: new Date("2026-08-08T00:00:00.000Z"),
      },
    ]);
    prismaMock.novelPromotionPanel.findMany.mockResolvedValue(
      Array.from({ length: 2_501 }, (_, index) => ({
        id: `panel-${index}`,
        storyboardId: "storyboard-1",
        panelIndex: index,
        panelNumber: index + 1,
        shotType: null,
        imageMediaId: null,
        videoMediaId: null,
        imageUrl: null,
        videoUrl: null,
        characters: null,
        location: null,
        updatedAt: new Date("2026-08-08T00:00:00.000Z"),
      })),
    );
    const { queryProjectGraph } = await import("@/lib/project-graph/query");

    const result = await queryProjectGraph({
      projectId: "project-1",
      limit: 20,
    });

    expect(result).toMatchObject({
      status: "graph_too_large",
      sceneCount: 1,
      shotCount: 2_501,
      maxShots: 2_500,
    });
    expect(prismaMock.novelPromotionPanel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 2_501 }),
    );
  });

  it("does not load or count panels from a storyboard linked to the wrong episode", async () => {
    prismaMock.novelPromotionEpisode.findMany.mockResolvedValue([
      episodeRow("episode-1", 1),
    ]);
    prismaMock.novelPromotionEpisode.count.mockResolvedValue(1);
    prismaMock.novelPromotionClip.findMany.mockResolvedValue([
      {
        id: "clip-1",
        episodeId: "episode-1",
        summary: "Scene",
        start: 0,
        updatedAt: new Date("2026-08-08T00:00:00.000Z"),
      },
    ]);
    prismaMock.novelPromotionStoryboard.findMany.mockResolvedValue([
      {
        id: "storyboard-mismatch",
        clipId: "clip-1",
        episodeId: "episode-other",
        panelCount: 99_999,
        updatedAt: new Date("2026-08-08T00:00:00.000Z"),
      },
    ]);
    const { queryProjectGraph } = await import("@/lib/project-graph/query");

    const result = await queryProjectGraph({
      projectId: "project-1",
      limit: 20,
    });

    expect(result).toMatchObject({
      status: "ok",
      source: {
        episodes: [
          {
            clips: [
              {
                storyboard: {
                  id: "storyboard-mismatch",
                  episodeId: "episode-other",
                  panels: [],
                },
              },
            ],
          },
        ],
      },
    });
    expect(prismaMock.novelPromotionPanel.findMany).not.toHaveBeenCalled();
  });
});
