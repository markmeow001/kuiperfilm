import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectGraphProjection } from "@/lib/project-graph/types";
import {
  isProjectGraphPermissionError,
  parseProjectGraphProjection,
  ProjectGraphRequestError,
  useProjectGraph,
} from "@/components/v2/project-graph/useProjectGraph";

const fetchMock = vi.fn();

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function response(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function graphPage(
  episodeId: string,
  episodeNumber: number,
  options: { hasNextPage: boolean; totalEpisodes: number },
): ProjectGraphProjection {
  return {
    schemaVersion: "1",
    projectId: "project-1",
    nodes: [
      {
        id: "project:project-1",
        kind: "project",
        sourceType: "Project",
        sourceId: "project-1",
        label: "Feature Film",
        updatedAt: "2026-08-08T00:00:00.000Z",
      },
      {
        id: `episode:${episodeId}`,
        kind: "episode",
        sourceType: "NovelPromotionEpisode",
        sourceId: episodeId,
        label: `Episode ${episodeNumber}`,
        episodeNumber,
        updatedAt: "2026-08-08T00:00:00.000Z",
      },
    ],
    edges: [
      {
        id: `edge:${episodeId}`,
        from: "project:project-1",
        to: `episode:${episodeId}`,
        relation: "project_has_episode",
        sourceRelation:
          "NovelPromotionProject.projectId + NovelPromotionEpisode.novelPromotionProjectId",
      },
    ],
    warnings: [],
    pageInfo: {
      limit: 1,
      totalEpisodes: options.totalEpisodes,
      endCursor: episodeId,
      hasNextPage: options.hasNextPage,
    },
  };
}

describe("useProjectGraph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("載入下一頁 -> 使用 episode cursor 並去除重複 project node", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response(
          graphPage("episode-1", 1, {
            hasNextPage: true,
            totalEpisodes: 2,
          }),
        ),
      )
      .mockResolvedValueOnce(
        response(
          graphPage("episode-2", 2, {
            hasNextPage: false,
            totalEpisodes: 2,
          }),
        ),
      );

    const { result } = renderHook(
      () => useProjectGraph("project / 1", { limit: 1 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.graph).not.toBeNull());
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/projects/project%20%2F%201/graph?limit=1",
    );

    await result.current.fetchNextPage();
    await waitFor(() => {
      expect(
        result.current.graph?.nodes.filter((node) => node.kind === "episode"),
      ).toHaveLength(2);
    });

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/projects/project%20%2F%201/graph?limit=1&cursor=episode-1",
    );
    expect(
      result.current.graph?.nodes.filter((node) => node.kind === "project"),
    ).toHaveLength(1);
    expect(result.current.graph?.pageInfo.hasNextPage).toBe(false);
  });

  it("403 -> 保留 HTTP status 供 UI 顯示 permission", async () => {
    fetchMock.mockResolvedValue(
      response({ error: { code: "FORBIDDEN" } }, 403),
    );

    const { result } = renderHook(() => useProjectGraph("project-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(isProjectGraphPermissionError(result.current.error)).toBe(true);
    expect(result.current.error).toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("200 但 schema 不支援 -> 顯式回報 502 contract error", async () => {
    fetchMock.mockResolvedValue(response({ schemaVersion: "2" }));

    const { result } = renderHook(() => useProjectGraph("project-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true), {
      timeout: 5_000,
    });
    expect(result.current.error).toBeInstanceOf(ProjectGraphRequestError);
    expect(result.current.error).toMatchObject({ status: 502 });
  });

  it("400 超限 -> 保留自訂 code 且不重試昂貴查詢", async () => {
    fetchMock.mockResolvedValue(
      response(
        {
          success: false,
          code: "PROJECT_GRAPH_TOO_LARGE",
          error: {
            code: "INVALID_PARAMS",
            details: { code: "PROJECT_GRAPH_TOO_LARGE" },
          },
        },
        400,
      ),
    );

    const { result } = renderHook(() => useProjectGraph("project-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      status: 400,
      code: "PROJECT_GRAPH_TOO_LARGE",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("未知 relation 或斷線 endpoint -> 拒絕整份 contract", () => {
    const invalid = graphPage("episode-1", 1, {
      hasNextPage: false,
      totalEpisodes: 1,
    });
    invalid.edges[0] = {
      ...invalid.edges[0],
      relation: "unknown_relation",
    } as unknown as ProjectGraphProjection["edges"][number];

    expect(() => parseProjectGraphProjection(invalid)).toThrow(
      "Project graph returned an invalid response.",
    );
  });

  it.each([
    ["缺少 project node", 0],
    ["包含兩個 project node", 2],
  ])("%s -> 拒絕整份 contract", (_label, projectNodeCount) => {
    const invalid = graphPage("episode-1", 1, {
      hasNextPage: false,
      totalEpisodes: 1,
    });
    const projectNode = invalid.nodes.find((node) => node.kind === "project");
    invalid.nodes = [
      ...invalid.nodes.filter((node) => node.kind !== "project"),
      ...Array.from({ length: projectNodeCount }, (_, index) => ({
        ...projectNode!,
        id: index === 0 ? projectNode!.id : `project:duplicate-${index}`,
        sourceId:
          index === 0 ? projectNode!.sourceId : `duplicate-project-${index}`,
      })),
    ];

    expect(() => parseProjectGraphProjection(invalid)).toThrow(
      "Project graph returned an invalid response.",
    );
  });

  it("project node sourceId 與 payload projectId 不一致 -> 拒絕 contract", () => {
    const invalid = graphPage("episode-1", 1, {
      hasNextPage: false,
      totalEpisodes: 1,
    });
    invalid.projectId = "another-project";

    expect(() => parseProjectGraphProjection(invalid)).toThrow(
      "Project graph returned an invalid response.",
    );
  });

  it("空 projectId -> 不發 request", () => {
    const { result } = renderHook(() => useProjectGraph(""), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("頁數超出 API contract -> 在 render 前顯式拒絕", () => {
    expect(() => {
      renderHook(() => useProjectGraph("project-1", { limit: 101 }), {
        wrapper,
      });
    }).toThrow("Project graph page limit must be an integer from 1 to 100");
  });
});
