import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectGraphProjection } from "@/lib/project-graph/types";
import { ProjectGraphRequestError } from "@/components/v2/project-graph/useProjectGraph";
import { ProjectGraphPanel } from "@/components/v2/project-graph/ProjectGraphPanel";

const mocks = vi.hoisted(() => ({
  useProjectGraph: vi.fn(),
}));

vi.mock(
  "@/components/v2/project-graph/useProjectGraph",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/components/v2/project-graph/useProjectGraph")
      >();
    return {
      ...actual,
      useProjectGraph: mocks.useProjectGraph,
    };
  },
);

const graph: ProjectGraphProjection = {
  schemaVersion: "1",
  projectId: "project-1",
  nodes: [
    {
      id: "project:project-1",
      kind: "project",
      sourceType: "Project",
      sourceId: "project-1",
      label: "海岸線",
      updatedAt: "2026-08-08T00:00:00.000Z",
    },
    {
      id: "episode:episode-1",
      kind: "episode",
      sourceType: "NovelPromotionEpisode",
      sourceId: "episode-1",
      label: "第一集",
      episodeNumber: 1,
      updatedAt: "2026-08-08T00:00:00.000Z",
    },
    {
      id: "scene:scene-1",
      kind: "scene",
      sourceType: "NovelPromotionClip",
      sourceId: "scene-1",
      label: "碼頭重逢",
      summary: "碼頭重逢",
      updatedAt: "2026-08-08T00:00:00.000Z",
    },
    {
      id: "storyboard:board-1",
      kind: "storyboard",
      sourceType: "NovelPromotionStoryboard",
      sourceId: "board-1",
      label: "Storyboard board-1",
      panelCount: 1,
      updatedAt: "2026-08-08T00:00:00.000Z",
    },
    {
      id: "shot:shot-1",
      kind: "shot",
      sourceType: "NovelPromotionPanel",
      sourceId: "shot-1",
      label: "Shot 1",
      panelIndex: 0,
      panelNumber: 1,
      shotType: "Medium",
      imageMediaId: "media-1",
      videoMediaId: null,
      updatedAt: "2026-08-08T00:00:00.000Z",
    },
  ],
  edges: [
    {
      id: "edge-project-episode",
      from: "project:project-1",
      to: "episode:episode-1",
      relation: "project_has_episode",
      sourceRelation:
        "NovelPromotionProject.projectId + NovelPromotionEpisode.novelPromotionProjectId",
    },
    {
      id: "edge-episode-scene",
      from: "episode:episode-1",
      to: "scene:scene-1",
      relation: "episode_has_scene",
      sourceRelation: "NovelPromotionClip.episodeId",
    },
    {
      id: "edge-scene-board",
      from: "scene:scene-1",
      to: "storyboard:board-1",
      relation: "scene_has_storyboard",
      sourceRelation: "NovelPromotionStoryboard.clipId",
    },
    {
      id: "edge-board-shot",
      from: "storyboard:board-1",
      to: "shot:shot-1",
      relation: "storyboard_has_shot",
      sourceRelation: "NovelPromotionPanel.storyboardId",
    },
  ],
  warnings: [
    {
      id: "warning-1",
      code: "UNRESOLVED_TEXT_REFERENCE",
      nodeId: "shot:shot-1",
      sourceType: "NovelPromotionPanel",
      sourceId: "shot-1",
      field: "characters",
      message: "Characters are still stored as text.",
    },
  ],
  pageInfo: {
    limit: 8,
    totalEpisodes: 2,
    endCursor: "episode-1",
    hasNextPage: true,
  },
};

function baseQuery(overrides: Record<string, unknown> = {}) {
  return {
    isPending: false,
    isError: false,
    error: null,
    graph,
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(),
    ...overrides,
  };
}

function renderPanel(locale: "zh" | "en" = "zh") {
  return render(
    <ProjectGraphPanel
      projectId="project-1"
      locale={locale}
      kicker={
        locale === "en"
          ? "Production lineage · read only"
          : "製作血緣 · 唯讀"
      }
    />,
  );
}

describe("ProjectGraphPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useProjectGraph.mockReturnValue(baseQuery());
  });

  it("讀取中 -> 明確說明不會建立任務或產生費用", () => {
    mocks.useProjectGraph.mockReturnValue(
      baseQuery({
        isPending: true,
        graph: null,
      }),
    );

    renderPanel();

    expect(screen.getByText("正在讀取製作關聯")).toBeInTheDocument();
    expect(
      screen.getByText("只讀取已保存資料，不會建立任務或產生費用。"),
    ).toBeInTheDocument();
  });

  it("403 -> 顯示 permission，不把它誤報成一般錯誤", () => {
    mocks.useProjectGraph.mockReturnValue(
      baseQuery({
        isError: true,
        graph: null,
        error: new ProjectGraphRequestError("HTTP 403", 403, "FORBIDDEN"),
      }),
    );

    renderPanel();

    expect(screen.getByText("無法查看製作關聯")).toBeInTheDocument();
    expect(screen.queryByText("製作關聯載入失敗")).not.toBeInTheDocument();
  });

  it("transport error -> 顯示原始錯誤並可重新載入", () => {
    const refetch = vi.fn();
    mocks.useProjectGraph.mockReturnValue(
      baseQuery({
        isError: true,
        graph: null,
        error: new ProjectGraphRequestError(
          "Project graph request failed: HTTP 503",
          503,
        ),
        refetch,
      }),
    );

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "重新載入" }));

    expect(
      screen.getByText("Project graph request failed: HTTP 503"),
    ).toBeInTheDocument();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("沒有 episode -> 提示先建立並保存第一集", () => {
    mocks.useProjectGraph.mockReturnValue(
      baseQuery({
        graph: {
          ...graph,
          nodes: graph.nodes.filter((node) => node.kind === "project"),
          edges: [],
          warnings: [],
          pageInfo: { ...graph.pageInfo, totalEpisodes: 0, hasNextPage: false },
        },
      }),
    );

    renderPanel();

    expect(screen.getByText("還沒有可連接的集數")).toBeInTheDocument();
  });

  it("有真實關聯 -> 依 Episode → Scene → Storyboard → Shot 顯示並標記素材", () => {
    mocks.useProjectGraph.mockReturnValue(baseQuery());

    renderPanel();

    expect(
      screen.getByRole("heading", { name: "製作關聯圖" }),
    ).toBeInTheDocument();
    expect(screen.getByText("第一集")).toBeInTheDocument();
    expect(screen.getByText("碼頭重逢")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("素材已連接")).toBeInTheDocument();
    expect(screen.getByText("已顯示 1 / 2 集")).toBeInTheDocument();
    expect(screen.getByText("待整理（目前已載入）")).toBeInTheDocument();
    expect(screen.getAllByText("≥1").length).toBeGreaterThanOrEqual(4);
  });

  it("尚有下一頁且目前 0 warnings -> 明示已載入範圍而非全專案零", () => {
    mocks.useProjectGraph.mockReturnValue(
      baseQuery({
        graph: {
          ...graph,
          warnings: [],
          pageInfo: {
            ...graph.pageInfo,
            totalEpisodes: 20,
            hasNextPage: true,
          },
        },
        hasNextPage: true,
      }),
    );

    renderPanel();

    expect(screen.getByText("目前載入範圍 · 1 / 20 集")).toBeInTheDocument();
    const warningMetric = screen
      .getByText("待整理（目前已載入）")
      .closest("div");
    expect(warningMetric).not.toBeNull();
    expect(within(warningMetric!).getByText("≥0")).toBeInTheDocument();
  });

  it("所有頁面已載完 -> metrics 使用精確數字且不顯示局部範圍", () => {
    mocks.useProjectGraph.mockReturnValue(
      baseQuery({
        graph: {
          ...graph,
          pageInfo: {
            ...graph.pageInfo,
            totalEpisodes: 1,
            hasNextPage: false,
          },
        },
      }),
    );

    renderPanel();

    expect(screen.queryByText(/目前載入範圍/)).not.toBeInTheDocument();
    const warningMetric = screen.getByText("待整理").closest("div");
    expect(warningMetric).not.toBeNull();
    expect(within(warningMetric!).getByText("1")).toBeInTheDocument();
  });

  it("還有 cursor page -> 44px 載入更多 control 觸發 fetchNextPage", () => {
    const fetchNextPage = vi.fn();
    mocks.useProjectGraph.mockReturnValue(
      baseQuery({
        hasNextPage: true,
        fetchNextPage,
      }),
    );

    renderPanel();
    const button = screen.getByRole("button", { name: "載入更多集數" });
    button.focus();
    fireEvent.click(button);

    expect(button).toHaveFocus();
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("下一頁失敗 -> 保留既有 graph 並只重試下一頁", () => {
    const fetchNextPage = vi.fn();
    mocks.useProjectGraph.mockReturnValue(
      baseQuery({
        isError: true,
        isFetchNextPageError: true,
        error: new ProjectGraphRequestError("HTTP 503", 503),
        hasNextPage: true,
        fetchNextPage,
      }),
    );

    renderPanel();

    expect(screen.getByText("第一集")).toBeInTheDocument();
    expect(screen.queryByText("製作關聯載入失敗")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重試載入更多" }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("已有 graph 後權限被撤銷 -> 立即隱藏快取內容並顯示 permission", () => {
    mocks.useProjectGraph.mockReturnValue(
      baseQuery({
        isError: true,
        isFetchNextPageError: true,
        error: new ProjectGraphRequestError("HTTP 403", 403, "FORBIDDEN"),
        hasNextPage: true,
      }),
    );

    renderPanel();

    expect(screen.getByText("無法查看製作關聯")).toBeInTheDocument();
    expect(screen.queryByText("第一集")).not.toBeInTheDocument();
    expect(screen.queryByText("重試載入更多")).not.toBeInTheDocument();
  });

  it("English locale -> 內建小型 copy 使用英文，kicker 由 messages 傳入", () => {
    renderPanel("en");

    expect(
      screen.getByRole("heading", { name: "Production lineage" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Production lineage · read only"),
    ).toBeInTheDocument();
    expect(screen.getByText("Media connected")).toBeInTheDocument();
  });

  it("warning 與專案識別 -> 全頁不顯示 raw database IDs", () => {
    const rawProjectId = "45be9960-16d4-46bd-b7f1-ae311ab3070e";
    const rawShotId = "ca4d84b0-eea0-4d10-8b4e-c63dbc819b9c";
    const safeGraph: ProjectGraphProjection = {
      ...graph,
      projectId: rawProjectId,
      nodes: graph.nodes.map((node) => {
        if (node.kind === "project") {
          return {
            ...node,
            id: `project:${rawProjectId}`,
            sourceId: rawProjectId,
          };
        }
        if (node.kind === "shot") {
          return {
            ...node,
            id: `shot:${rawShotId}`,
            sourceId: rawShotId,
          };
        }
        return node;
      }),
      edges: graph.edges.map((edge) => ({
        ...edge,
        from:
          edge.from === "project:project-1"
            ? `project:${rawProjectId}`
            : edge.from,
        to:
          edge.to === "shot:shot-1" ? `shot:${rawShotId}` : edge.to,
      })),
      warnings: graph.warnings.map((warning) => ({
        ...warning,
        nodeId: `shot:${rawShotId}`,
        sourceId: rawShotId,
      })),
    };
    mocks.useProjectGraph.mockReturnValue(baseQuery({ graph: safeGraph }));

    const { container } = renderPanel();
    fireEvent.click(screen.getByText(/資料關聯待整理/));

    expect(container).not.toHaveTextContent(rawProjectId);
    expect(container).not.toHaveTextContent(rawShotId);
    expect(screen.getByText("鏡頭 · Shot 1")).toBeInTheDocument();
    expect(screen.getByText("問題 01")).toBeInTheDocument();
  });

  it("storyboard episode mismatch -> 使用安全人類標籤，不顯示 storyboard UUID", () => {
    const rawStoryboardId = "c0e8b188-76b1-4935-88c8-68d643b05213";
    const mismatchGraph: ProjectGraphProjection = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.kind === "storyboard"
          ? {
              ...node,
              id: `storyboard:${rawStoryboardId}`,
              sourceId: rawStoryboardId,
              label: "碼頭重逢分鏡",
            }
          : node,
      ),
      edges: graph.edges.map((edge) => ({
        ...edge,
        from:
          edge.from === "storyboard:board-1"
            ? `storyboard:${rawStoryboardId}`
            : edge.from,
        to:
          edge.to === "storyboard:board-1"
            ? `storyboard:${rawStoryboardId}`
            : edge.to,
      })),
      warnings: [
        {
          id: "warning-mismatch",
          code: "STORYBOARD_EPISODE_MISMATCH",
          nodeId: `storyboard:${rawStoryboardId}`,
          sourceType: "NovelPromotionStoryboard",
          sourceId: rawStoryboardId,
          field: "episodeId",
          message: "Storyboard episode mismatch.",
        },
      ],
    };
    mocks.useProjectGraph.mockReturnValue(baseQuery({ graph: mismatchGraph }));

    const { container } = renderPanel();
    fireEvent.click(screen.getByText(/資料關聯待整理/));

    expect(screen.getByText("分鏡 · 碼頭重逢分鏡")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(rawStoryboardId);
  });

  it("graph 缺少唯一 project node -> 顯示契約錯誤且不回退顯示 projectId", () => {
    const rawProjectId = "33ca90b2-e82e-4f55-a292-a1104851e00a";
    mocks.useProjectGraph.mockReturnValue(
      baseQuery({
        graph: {
          ...graph,
          projectId: rawProjectId,
          nodes: graph.nodes.filter((node) => node.kind !== "project"),
          edges: graph.edges.filter(
            (edge) => edge.relation !== "project_has_episode",
          ),
        },
      }),
    );

    const { container } = renderPanel();

    expect(screen.getByText("製作關聯資料格式不完整")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(rawProjectId);
  });
});
