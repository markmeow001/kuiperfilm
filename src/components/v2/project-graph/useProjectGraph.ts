"use client";

import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type {
  ProjectGraphEdge,
  ProjectGraphEdgeRelation,
  ProjectGraphNode,
  ProjectGraphProjection,
  ProjectGraphSourceRelation,
  ProjectGraphWarning,
  ProjectGraphWarningCode,
  ProjectGraphWarningField,
} from "@/lib/project-graph/types";

const DEFAULT_PAGE_LIMIT = 8;

type JsonRecord = Record<string, unknown>;

export class ProjectGraphRequestError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "ProjectGraphRequestError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(record: JsonRecord, key: string): boolean {
  return typeof record[key] === "string";
}

function hasNonEmptyString(record: JsonRecord, key: string): boolean {
  return typeof record[key] === "string" && record[key].trim().length > 0;
}

function hasNullableString(record: JsonRecord, key: string): boolean {
  return record[key] === null || typeof record[key] === "string";
}

function hasNonNegativeInteger(record: JsonRecord, key: string): boolean {
  return Number.isInteger(record[key]) && Number(record[key]) >= 0;
}

function hasIsoTimestamp(record: JsonRecord, key: string): boolean {
  if (typeof record[key] !== "string") return false;
  const timestamp = new Date(record[key]);
  return (
    Number.isFinite(timestamp.getTime()) &&
    timestamp.toISOString() === record[key]
  );
}

const EDGE_CONTRACT: Record<
  ProjectGraphEdgeRelation,
  {
    sourceRelation: ProjectGraphSourceRelation;
    fromKind: ProjectGraphNode["kind"];
    toKind: ProjectGraphNode["kind"];
  }
> = {
  project_has_episode: {
    sourceRelation:
      "NovelPromotionProject.projectId + NovelPromotionEpisode.novelPromotionProjectId",
    fromKind: "project",
    toKind: "episode",
  },
  episode_has_scene: {
    sourceRelation: "NovelPromotionClip.episodeId",
    fromKind: "episode",
    toKind: "scene",
  },
  scene_has_storyboard: {
    sourceRelation: "NovelPromotionStoryboard.clipId",
    fromKind: "scene",
    toKind: "storyboard",
  },
  storyboard_has_shot: {
    sourceRelation: "NovelPromotionPanel.storyboardId",
    fromKind: "storyboard",
    toKind: "shot",
  },
};

const WARNING_CONTRACT: Record<
  ProjectGraphWarningCode,
  {
    sourceType: ProjectGraphWarning["sourceType"];
    fields: readonly ProjectGraphWarningField[];
  }
> = {
  MISSING_MEDIA_OBJECT_POINTER: {
    sourceType: "NovelPromotionPanel",
    fields: ["imageMediaId", "videoMediaId"],
  },
  STORYBOARD_EPISODE_MISMATCH: {
    sourceType: "NovelPromotionStoryboard",
    fields: ["episodeId"],
  },
  UNRESOLVED_TEXT_REFERENCE: {
    sourceType: "NovelPromotionPanel",
    fields: ["characters", "location"],
  },
};

function isProjectGraphNode(value: unknown): value is ProjectGraphNode {
  if (!isRecord(value)) return false;
  if (
    !hasNonEmptyString(value, "id") ||
    !hasNonEmptyString(value, "sourceId") ||
    !hasString(value, "sourceType") ||
    !hasNonEmptyString(value, "label") ||
    !hasIsoTimestamp(value, "updatedAt")
  ) {
    return false;
  }

  switch (value.kind) {
    case "project":
      return value.sourceType === "Project";
    case "episode":
      return (
        value.sourceType === "NovelPromotionEpisode" &&
        hasNonNegativeInteger(value, "episodeNumber")
      );
    case "scene":
      return (
        value.sourceType === "NovelPromotionClip" && hasString(value, "summary")
      );
    case "storyboard":
      return (
        value.sourceType === "NovelPromotionStoryboard" &&
        hasNonNegativeInteger(value, "panelCount")
      );
    case "shot":
      return (
        value.sourceType === "NovelPromotionPanel" &&
        hasNonNegativeInteger(value, "panelIndex") &&
        (value.panelNumber === null ||
          (Number.isInteger(value.panelNumber) &&
            Number(value.panelNumber) >= 0)) &&
        hasNullableString(value, "shotType") &&
        hasNullableString(value, "imageMediaId") &&
        hasNullableString(value, "videoMediaId")
      );
    default:
      return false;
  }
}

function isProjectGraphEdge(value: unknown): value is ProjectGraphEdge {
  if (
    !isRecord(value) ||
    !hasNonEmptyString(value, "id") ||
    !hasNonEmptyString(value, "from") ||
    !hasNonEmptyString(value, "to") ||
    !hasString(value, "relation") ||
    !hasString(value, "sourceRelation")
  ) {
    return false;
  }
  const contract = EDGE_CONTRACT[value.relation as ProjectGraphEdgeRelation];
  return Boolean(contract && contract.sourceRelation === value.sourceRelation);
}

function isProjectGraphWarning(value: unknown): value is ProjectGraphWarning {
  if (
    !isRecord(value) ||
    !hasNonEmptyString(value, "id") ||
    !hasString(value, "code") ||
    !hasNonEmptyString(value, "nodeId") ||
    !hasNonEmptyString(value, "sourceId") ||
    !hasString(value, "field") ||
    !hasNonEmptyString(value, "message")
  ) {
    return false;
  }
  const contract = WARNING_CONTRACT[value.code as ProjectGraphWarningCode];
  return Boolean(
    contract &&
    contract.sourceType === value.sourceType &&
    contract.fields.includes(value.field as ProjectGraphWarningField),
  );
}

export function parseProjectGraphProjection(
  payload: unknown,
): ProjectGraphProjection {
  if (!isRecord(payload) || payload.schemaVersion !== "1") {
    throw new ProjectGraphRequestError(
      "Project graph returned an unsupported schema.",
      502,
    );
  }

  if (
    !hasNonEmptyString(payload, "projectId") ||
    !Array.isArray(payload.nodes) ||
    !payload.nodes.every(isProjectGraphNode) ||
    !Array.isArray(payload.edges) ||
    !payload.edges.every(isProjectGraphEdge) ||
    !Array.isArray(payload.warnings) ||
    !payload.warnings.every(isProjectGraphWarning) ||
    !isRecord(payload.pageInfo) ||
    !hasNonNegativeInteger(payload.pageInfo, "limit") ||
    Number(payload.pageInfo.limit) < 1 ||
    Number(payload.pageInfo.limit) > 100 ||
    !hasNonNegativeInteger(payload.pageInfo, "totalEpisodes") ||
    !hasNullableString(payload.pageInfo, "endCursor") ||
    typeof payload.pageInfo.hasNextPage !== "boolean"
  ) {
    throw new ProjectGraphRequestError(
      "Project graph returned an invalid response.",
      502,
    );
  }

  const nodes = payload.nodes as ProjectGraphNode[];
  const edges = payload.edges as ProjectGraphEdge[];
  const warnings = payload.warnings as ProjectGraphWarning[];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const projectNodes = nodes.filter((node) => node.kind === "project");
  if (
    nodeById.size !== nodes.length ||
    new Set(edges.map((edge) => edge.id)).size !== edges.length ||
    new Set(warnings.map((warning) => warning.id)).size !== warnings.length ||
    projectNodes.length !== 1 ||
    projectNodes[0]?.sourceId !== payload.projectId ||
    (payload.pageInfo.hasNextPage === true &&
      (typeof payload.pageInfo.endCursor !== "string" ||
        payload.pageInfo.endCursor.trim().length === 0))
  ) {
    throw new ProjectGraphRequestError(
      "Project graph returned an invalid response.",
      502,
    );
  }

  for (const edge of edges) {
    const contract = EDGE_CONTRACT[edge.relation];
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (
      !from ||
      !to ||
      from.kind !== contract.fromKind ||
      to.kind !== contract.toKind
    ) {
      throw new ProjectGraphRequestError(
        "Project graph returned an invalid response.",
        502,
      );
    }
  }

  for (const warning of warnings) {
    const node = nodeById.get(warning.nodeId);
    if (
      !node ||
      node.sourceType !== warning.sourceType ||
      node.sourceId !== warning.sourceId
    ) {
      throw new ProjectGraphRequestError(
        "Project graph returned an invalid response.",
        502,
      );
    }
  }

  return payload as unknown as ProjectGraphProjection;
}

function readApiErrorCode(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const error = isRecord(payload.error) ? payload.error : null;
  const details = error && isRecord(error.details) ? error.details : null;
  if (details && typeof details.code === "string") return details.code;
  if (typeof payload.code === "string") return payload.code;
  return error && typeof error.code === "string" ? error.code : null;
}

async function fetchProjectGraphPage(
  projectId: string,
  limit: number,
  cursor: string | null,
): Promise<ProjectGraphProjection> {
  const search = new URLSearchParams({ limit: String(limit) });
  if (cursor) search.set("cursor", cursor);

  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/graph?${search.toString()}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    throw new ProjectGraphRequestError(
      `Project graph request failed: HTTP ${response.status}`,
      response.status,
      readApiErrorCode(payload),
    );
  }

  return parseProjectGraphProjection(await response.json());
}

export function isProjectGraphPermissionError(error: unknown): boolean {
  return (
    error instanceof ProjectGraphRequestError &&
    (error.status === 401 || error.status === 403)
  );
}

function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

export function mergeProjectGraphPages(
  pages: readonly ProjectGraphProjection[] | undefined,
): ProjectGraphProjection | null {
  if (!pages || pages.length === 0) return null;

  const [firstPage] = pages;
  for (const page of pages) {
    if (
      page.schemaVersion !== firstPage.schemaVersion ||
      page.projectId !== firstPage.projectId
    ) {
      throw new ProjectGraphRequestError(
        "Project graph pages do not describe the same project.",
        502,
      );
    }
  }

  const lastPage = pages.at(-1);
  if (!lastPage) return null;

  return {
    schemaVersion: firstPage.schemaVersion,
    projectId: firstPage.projectId,
    nodes: uniqueById(pages.flatMap((page) => page.nodes)),
    edges: uniqueById(pages.flatMap((page) => page.edges)),
    warnings: uniqueById(pages.flatMap((page) => page.warnings)),
    pageInfo: lastPage.pageInfo,
  };
}

export interface UseProjectGraphOptions {
  limit?: number;
  enabled?: boolean;
}

export function useProjectGraph(
  projectId: string,
  options: UseProjectGraphOptions = {},
) {
  const limit = options.limit ?? DEFAULT_PAGE_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new RangeError(
      "Project graph page limit must be an integer from 1 to 100",
    );
  }

  const query = useInfiniteQuery({
    queryKey: ["project-graph", projectId, limit] as const,
    enabled: (options.enabled ?? true) && projectId.trim().length > 0,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) =>
      await fetchProjectGraphPage(
        projectId,
        limit,
        typeof pageParam === "string" ? pageParam : null,
      ),
    getNextPageParam: (lastPage) => {
      if (!lastPage.pageInfo.hasNextPage) return undefined;
      if (!lastPage.pageInfo.endCursor) {
        throw new ProjectGraphRequestError(
          "Project graph pagination is missing its next cursor.",
          502,
        );
      }
      return lastPage.pageInfo.endCursor;
    },
    retry: (failureCount, error) => {
      if (error instanceof ProjectGraphRequestError) {
        return error.status >= 500 && failureCount < 2;
      }
      return failureCount < 2;
    },
    staleTime: 10_000,
  });

  const graph = useMemo(
    () => mergeProjectGraphPages(query.data?.pages),
    [query.data?.pages],
  );

  return {
    ...query,
    graph,
  };
}
