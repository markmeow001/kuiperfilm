"use client";

import { UiStatePanel } from "@/components/v2/UiStatePanel";
import type {
  ProjectGraphEdgeRelation,
  ProjectGraphNode,
  ProjectGraphNodeKind,
  ProjectGraphProjection,
} from "@/lib/project-graph/types";
import {
  isProjectGraphPermissionError,
  useProjectGraph,
} from "./useProjectGraph";
import styles from "./ProjectGraphPanel.module.css";

interface ProjectGraphPanelProps {
  projectId: string;
  locale: string;
  kicker: string;
}

interface GraphCopy {
  title: string;
  description: string;
  loadingTitle: string;
  loadingDescription: string;
  permissionTitle: string;
  permissionDescription: string;
  errorTitle: string;
  errorDescription: string;
  contractTitle: string;
  contractDescription: string;
  retry: string;
  emptyTitle: string;
  emptyDescription: string;
  project: string;
  episodes: string;
  scenes: string;
  storyboards: string;
  shots: string;
  warnings: string;
  episode: string;
  scene: string;
  storyboard: string;
  shot: string;
  noStoryboard: string;
  noShots: string;
  mediaReady: string;
  mediaMissing: string;
  warningTitle: string;
  warningDescription: string;
  loadMore: string;
  loadingMore: string;
  loadMoreError: string;
  retryLoadMore: string;
  loadedMetric: (label: string) => string;
  atLeast: (value: number) => string;
  loadedScope: (loaded: number, total: number) => string;
  loadedSummary: (loaded: number, total: number) => string;
  warningOrdinal: (index: number) => string;
  unknownNode: string;
}

const COPY: Record<"zh" | "en", GraphCopy> = {
  zh: {
    title: "製作關聯圖",
    description:
      "依照已保存的集數、場景、分鏡與鏡頭關聯，檢查素材從哪裡來、還缺哪一段。",
    loadingTitle: "正在讀取製作關聯",
    loadingDescription: "只讀取已保存資料，不會建立任務或產生費用。",
    permissionTitle: "無法查看製作關聯",
    permissionDescription: "你目前沒有這個專案的讀取權限。內容沒有被修改。",
    errorTitle: "製作關聯載入失敗",
    errorDescription: "既有專案資料仍然保留。請重新載入這個只讀檢視。",
    contractTitle: "製作關聯資料格式不完整",
    contractDescription:
      "只讀資料缺少唯一的專案根節點，因此沒有顯示可能錯誤的關聯。請重新載入。",
    retry: "重新載入",
    emptyTitle: "還沒有可連接的集數",
    emptyDescription:
      "建立並保存第一集後，場景、分鏡與鏡頭會依照真實關聯顯示在這裡。",
    project: "專案",
    episodes: "集數",
    scenes: "場景",
    storyboards: "分鏡板",
    shots: "鏡頭",
    warnings: "待整理",
    episode: "集",
    scene: "場景",
    storyboard: "分鏡",
    shot: "鏡頭",
    noStoryboard: "這個場景尚未建立分鏡板",
    noShots: "這張分鏡板尚未保存鏡頭",
    mediaReady: "素材已連接",
    mediaMissing: "尚無素材",
    warningTitle: "資料關聯待整理",
    warningDescription:
      "這些鏡頭仍使用舊素材位置或文字名稱；目前只標示，不會自動改寫。",
    loadMore: "載入更多集數",
    loadingMore: "正在載入…",
    loadMoreError: "下一頁載入失敗，已顯示的內容仍然保留。",
    retryLoadMore: "重試載入更多",
    loadedMetric: (label) => `${label}（目前已載入）`,
    atLeast: (value) => `≥${value}`,
    loadedScope: (loaded, total) => `目前載入範圍 · ${loaded} / ${total} 集`,
    loadedSummary: (loaded, total) => `已顯示 ${loaded} / ${total} 集`,
    warningOrdinal: (index) => `問題 ${String(index).padStart(2, "0")}`,
    unknownNode: "未識別節點",
  },
  en: {
    title: "Production lineage",
    description:
      "Trace saved episodes, scenes, storyboards, and shots to see what is connected and what still needs attention.",
    loadingTitle: "Loading production lineage",
    loadingDescription:
      "This reads saved data only. It does not create jobs or incur cost.",
    permissionTitle: "Production lineage is unavailable",
    permissionDescription:
      "You do not have read access to this project. Nothing was changed.",
    errorTitle: "Production lineage could not load",
    errorDescription:
      "Existing project data remains safe. Reload this read-only view.",
    contractTitle: "Production lineage data is incomplete",
    contractDescription:
      "The read-only response does not contain exactly one project root, so potentially incorrect relationships are hidden. Reload this view.",
    retry: "Reload",
    emptyTitle: "No connected episodes yet",
    emptyDescription:
      "After the first episode is saved, its scenes, storyboards, and shots will appear here from their real relationships.",
    project: "Project",
    episodes: "Episodes",
    scenes: "Scenes",
    storyboards: "Storyboards",
    shots: "Shots",
    warnings: "Needs attention",
    episode: "Episode",
    scene: "Scene",
    storyboard: "Storyboard",
    shot: "Shot",
    noStoryboard: "This scene does not have a saved storyboard yet",
    noShots: "This storyboard does not have saved shots yet",
    mediaReady: "Media connected",
    mediaMissing: "No media",
    warningTitle: "Relationships need attention",
    warningDescription:
      "These shots still use legacy media locations or text names. This view only flags them and never rewrites data.",
    loadMore: "Load more episodes",
    loadingMore: "Loading…",
    loadMoreError:
      "The next page could not load. Existing results are still shown.",
    retryLoadMore: "Retry loading more",
    loadedMetric: (label) => `${label} (loaded scope)`,
    atLeast: (value) => `≥${value}`,
    loadedScope: (loaded, total) =>
      `Loaded scope · ${loaded} of ${total} episodes`,
    loadedSummary: (loaded, total) => `${loaded} of ${total} episodes shown`,
    warningOrdinal: (index) => `Issue ${String(index).padStart(2, "0")}`,
    unknownNode: "Unknown node",
  },
};

function localeCopy(locale: string): GraphCopy {
  return locale.toLowerCase().startsWith("en") ? COPY.en : COPY.zh;
}

function nodesOfKind<Kind extends ProjectGraphNodeKind>(
  graph: ProjectGraphProjection,
  kind: Kind,
): Extract<ProjectGraphNode, { kind: Kind }>[] {
  return graph.nodes.filter(
    (node): node is Extract<ProjectGraphNode, { kind: Kind }> =>
      node.kind === kind,
  );
}

function childNodes<Kind extends ProjectGraphNodeKind>(
  graph: ProjectGraphProjection,
  parentId: string,
  relation: ProjectGraphEdgeRelation,
  kind: Kind,
): Extract<ProjectGraphNode, { kind: Kind }>[] {
  const childIds = new Set(
    graph.edges
      .filter((edge) => edge.from === parentId && edge.relation === relation)
      .map((edge) => edge.to),
  );
  return nodesOfKind(graph, kind).filter((node) => childIds.has(node.id));
}

function nodeCounts(graph: ProjectGraphProjection) {
  return {
    episode: nodesOfKind(graph, "episode").length,
    scene: nodesOfKind(graph, "scene").length,
    storyboard: nodesOfKind(graph, "storyboard").length,
    shot: nodesOfKind(graph, "shot").length,
  };
}

function nodeKindLabel(copy: GraphCopy, kind: ProjectGraphNodeKind): string {
  switch (kind) {
    case "project":
      return copy.project;
    case "episode":
      return copy.episode;
    case "scene":
      return copy.scene;
    case "storyboard":
      return copy.storyboard;
    case "shot":
      return copy.shot;
  }
}

export function ProjectGraphPanel({
  projectId,
  locale,
  kicker,
}: ProjectGraphPanelProps) {
  const copy = localeCopy(locale);
  const query = useProjectGraph(projectId);

  if (query.isPending) {
    return (
      <UiStatePanel
        state="loading"
        locale={locale}
        title={copy.loadingTitle}
        description={copy.loadingDescription}
      />
    );
  }

  if (query.isError && isProjectGraphPermissionError(query.error)) {
    return (
      <UiStatePanel
        state="permission"
        locale={locale}
        title={copy.permissionTitle}
        description={copy.permissionDescription}
      />
    );
  }

  if (!query.graph) {
    return (
      <UiStatePanel
        state="error"
        locale={locale}
        title={copy.errorTitle}
        description={copy.errorDescription}
        details={query.error instanceof Error ? query.error.message : undefined}
        primaryAction={
          <button
            type="button"
            className="kuiper-dashboard-primary px-4 text-[14px]"
            onClick={() => void query.refetch()}
          >
            {copy.retry}
          </button>
        }
      />
    );
  }

  const graph = query.graph;
  const projectNodes = nodesOfKind(graph, "project");
  if (projectNodes.length !== 1) {
    return (
      <UiStatePanel
        state="error"
        locale={locale}
        title={copy.contractTitle}
        description={copy.contractDescription}
        primaryAction={
          <button
            type="button"
            className="kuiper-dashboard-primary px-4 text-[14px]"
            onClick={() => void query.refetch()}
          >
            {copy.retry}
          </button>
        }
      />
    );
  }
  const projectNode = projectNodes[0];
  const episodes = nodesOfKind(graph, "episode").sort(
    (left, right) => left.episodeNumber - right.episodeNumber,
  );
  const counts = nodeCounts(graph);
  const isPartialScope = graph.pageInfo.hasNextPage;
  const metricLabel = (label: string) =>
    isPartialScope ? copy.loadedMetric(label) : label;
  const metricValue = (value: number) =>
    isPartialScope ? copy.atLeast(value) : value;

  if (episodes.length === 0) {
    return (
      <UiStatePanel
        state="empty"
        locale={locale}
        title={copy.emptyTitle}
        description={copy.emptyDescription}
      />
    );
  }

  return (
    <section
      className={styles.panel}
      aria-labelledby="project-graph-title"
      aria-busy={query.isFetchingNextPage || undefined}
    >
      <header className={styles.header}>
        <div className={styles.headingBlock}>
          <p className={styles.kicker}>{kicker}</p>
          <h2 id="project-graph-title" className={styles.title}>
            {copy.title}
          </h2>
          <p className={styles.description}>{copy.description}</p>
          {isPartialScope ? (
            <p className={styles.scopeNote}>
              {copy.loadedScope(counts.episode, graph.pageInfo.totalEpisodes)}
            </p>
          ) : null}
        </div>
        <div className={styles.projectIdentity}>
          <span>{copy.project}</span>
          <strong>{projectNode.label}</strong>
        </div>
      </header>

      <dl className={styles.metrics} aria-label={copy.title}>
        <Metric label={metricLabel(copy.episodes)} value={metricValue(counts.episode)} />
        <Metric label={metricLabel(copy.scenes)} value={metricValue(counts.scene)} />
        <Metric
          label={metricLabel(copy.storyboards)}
          value={metricValue(counts.storyboard)}
        />
        <Metric label={metricLabel(copy.shots)} value={metricValue(counts.shot)} />
        <Metric
          label={metricLabel(copy.warnings)}
          value={metricValue(graph.warnings.length)}
          warning={graph.warnings.length > 0}
        />
      </dl>

      <div className={styles.stageLegend} aria-hidden="true">
        <span>{copy.episode}</span>
        <span>{copy.scene}</span>
        <span>{copy.storyboard}</span>
        <span>{copy.shot}</span>
      </div>

      <div className={styles.episodeList}>
        {episodes.map((episode) => (
          <EpisodeBranch
            key={episode.id}
            graph={graph}
            episode={episode}
            copy={copy}
          />
        ))}
      </div>

      {graph.warnings.length > 0 ? (
        <details className={styles.warningWell}>
          <summary>
            <span>{metricLabel(copy.warningTitle)}</span>
            <strong>{metricValue(graph.warnings.length)}</strong>
          </summary>
          <div className={styles.warningBody}>
            <p>{copy.warningDescription}</p>
            <ul>
              {graph.warnings.map((warning, index) => {
                const node = graph.nodes.find(
                  (candidate) => candidate.id === warning.nodeId,
                );
                const nodeLabel = node
                  ? `${nodeKindLabel(copy, node.kind)} · ${node.label}`
                  : copy.unknownNode;
                return (
                <li key={warning.id}>
                  <span>{nodeLabel}</span>
                  <code>{copy.warningOrdinal(index + 1)}</code>
                </li>
                );
              })}
            </ul>
          </div>
        </details>
      ) : null}

      <footer className={styles.footer}>
        <p>
          {copy.loadedSummary(counts.episode, graph.pageInfo.totalEpisodes)}
        </p>
        {query.isFetchNextPageError ? (
          <div className={styles.paginationError} role="alert">
            <span>{copy.loadMoreError}</span>
            <button
              type="button"
              className={styles.loadMore}
              onClick={() => void query.fetchNextPage()}
            >
              {copy.retryLoadMore}
            </button>
          </div>
        ) : query.hasNextPage ? (
          <button
            type="button"
            className={styles.loadMore}
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? copy.loadingMore : copy.loadMore}
          </button>
        ) : null}
      </footer>
    </section>
  );
}

function Metric({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: number | string;
  warning?: boolean;
}) {
  return (
    <div className={warning ? styles.warningMetric : undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function EpisodeBranch({
  graph,
  episode,
  copy,
}: {
  graph: ProjectGraphProjection;
  episode: Extract<ProjectGraphNode, { kind: "episode" }>;
  copy: GraphCopy;
}) {
  const scenes = childNodes(graph, episode.id, "episode_has_scene", "scene");

  return (
    <details className={styles.episode} open>
      <summary>
        <span className={styles.episodeNumber}>
          {String(episode.episodeNumber).padStart(2, "0")}
        </span>
        <span className={styles.episodeName}>{episode.label}</span>
        <span className={styles.episodeCount}>
          {scenes.length} {copy.scene}
        </span>
      </summary>
      <ul className={styles.sceneList}>
        {scenes.map((scene) => (
          <SceneBranch key={scene.id} graph={graph} scene={scene} copy={copy} />
        ))}
      </ul>
    </details>
  );
}

function SceneBranch({
  graph,
  scene,
  copy,
}: {
  graph: ProjectGraphProjection;
  scene: Extract<ProjectGraphNode, { kind: "scene" }>;
  copy: GraphCopy;
}) {
  const storyboards = childNodes(
    graph,
    scene.id,
    "scene_has_storyboard",
    "storyboard",
  );

  return (
    <li className={styles.sceneRow}>
      <div className={styles.sceneNode}>
        <span>{copy.scene}</span>
        <strong>{scene.label}</strong>
      </div>
      <div className={styles.storyboardLane}>
        {storyboards.length === 0 ? (
          <p className={styles.emptyBranch}>{copy.noStoryboard}</p>
        ) : (
          storyboards.map((storyboard) => {
            const shots = childNodes(
              graph,
              storyboard.id,
              "storyboard_has_shot",
              "shot",
            );
            return (
              <div key={storyboard.id} className={styles.storyboardRow}>
                <div className={styles.storyboardNode}>
                  <span>{copy.storyboard}</span>
                  <strong>
                    {storyboard.panelCount} {copy.shots}
                  </strong>
                </div>
                {shots.length === 0 ? (
                  <p className={styles.emptyBranch}>{copy.noShots}</p>
                ) : (
                  <ol className={styles.shotList}>
                    {shots.map((shot) => {
                      const hasMedia = Boolean(
                        shot.imageMediaId || shot.videoMediaId,
                      );
                      return (
                        <li key={shot.id} className={styles.shotNode}>
                          <span className={styles.shotIndex}>
                            {String(
                              shot.panelNumber ?? shot.panelIndex + 1,
                            ).padStart(2, "0")}
                          </span>
                          <span className={styles.shotLabel}>
                            <strong>{shot.shotType || copy.shot}</strong>
                            <small
                              className={
                                hasMedia
                                  ? styles.mediaReady
                                  : styles.mediaMissing
                              }
                            >
                              {hasMedia ? copy.mediaReady : copy.mediaMissing}
                            </small>
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            );
          })
        )}
      </div>
    </li>
  );
}
