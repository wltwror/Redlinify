import type {
  DesignThread,
  DesignView,
  DiagramType,
  SemanticDiff,
  ThreadKind,
  ThreadTargetType,
  UserPreferences,
  ViewDirection,
  ViewLayout,
  ViewRequest,
  WorkspaceFile,
  WorkspaceTab,
} from "@redlinify/shared/browser";

export interface TabStatusSummary extends WorkspaceTab {
  view_hash: string | null;
  missing_view_file?: boolean;
  waiting_on_agent: number;
  waiting_on_human: number;
  drifted_count: number;
  has_human_edits: boolean;
  diff_counts: {
    nodes_added: number;
    nodes_removed: number;
    nodes_modified: number;
    edges_added: number;
    edges_removed: number;
    edges_modified: number;
  };
}

export interface WorkspaceStatusResult {
  initialized: boolean;
  project_name: string;
  tabs: TabStatusSummary[];
  workspace_threads_waiting_on_agent: number;
  workspace_threads_waiting_on_human: number;
  view_requests: ViewRequest[];
  entity_refs: Record<string, string[]>;
}

export interface PendingFeedbackResult {
  view_hashes: Record<string, string>;
  view_diffs: Array<{
    view_id: string;
    view_hash: string;
    diff: SemanticDiff;
  }>;
  pending_threads: DesignThread[];
  view_requests: ViewRequest[];
}

export interface WorkspaceSnapshot {
  workspace: WorkspaceFile;
  status: WorkspaceStatusResult;
  pending_feedback: PendingFeedbackResult;
  root_dir?: string;
}

export interface ViewDetailResponse {
  view: DesignView;
  view_hash: string;
  layout: ViewLayout;
  diff: SemanticDiff;
  baseline: DesignView | null;
  threads: DesignThread[];
}

export interface CrossLinkOccurrence {
  view_id: string;
  view_title: string;
  node_id: string;
  node_title: string;
  kind: string;
  status: string;
}

export type WsEvent =
  | { type: "workspace_updated"; origin: "ui" | "external" }
  | { type: "view_updated"; view_id: string; origin: "ui" | "external" }
  | { type: "threads_updated"; origin: "ui" | "external" };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let parsed: unknown = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text };
    }
  }
  if (!res.ok) {
    const errObj = parsed as {
      error?: string;
      message?: string;
      details?: unknown;
    };
    throw new ApiError(
      res.status,
      errObj.error ?? `HTTP_${res.status}`,
      errObj.message ?? `Request failed (${res.status})`,
      errObj.details,
    );
  }
  return parsed as T;
}

export function fetchWorkspace(): Promise<WorkspaceSnapshot> {
  return requestJson<WorkspaceSnapshot>("/api/workspace");
}

export function reorderWorkspaceTabs(
  tabs: WorkspaceTab[],
): Promise<{ workspace: WorkspaceFile }> {
  return requestJson("/api/workspace/tabs", {
    method: "PUT",
    body: JSON.stringify({ tabs }),
  });
}

export function createViewRequest(input: {
  title: string;
  prompt: string;
}): Promise<{ request: ViewRequest }> {
  return requestJson("/api/workspace/view-requests", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteViewRequest(requestId: string): Promise<{ deleted: true }> {
  return requestJson(`/api/workspace/view-requests/${encodeURIComponent(requestId)}`, {
    method: "DELETE",
  });
}

export function createBlankView(input: {
  id?: string;
  title: string;
  diagram_type?: DiagramType;
  direction?: ViewDirection;
}): Promise<{ view: DesignView; view_hash: string; created: boolean }> {
  return requestJson("/api/views", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteView(
  viewId: string,
): Promise<{ deleted: true; view_id: string }> {
  return requestJson(`/api/views/${encodeURIComponent(viewId)}`, {
    method: "DELETE",
  });
}

export function fetchAllViews(): Promise<{ views: DesignView[] }> {
  return requestJson<{ views: DesignView[] }>("/api/views");
}

export function fetchView(viewId: string): Promise<ViewDetailResponse> {
  return requestJson<ViewDetailResponse>(
    `/api/views/${encodeURIComponent(viewId)}`,
  );
}

export function saveView(
  view: DesignView,
  baseHash?: string,
): Promise<{
  view: DesignView;
  view_hash: string;
  diff: SemanticDiff;
  baseline?: DesignView | null;
}> {
  return requestJson(`/api/views/${encodeURIComponent(view.id)}`, {
    method: "PUT",
    body: JSON.stringify({ view, base_hash: baseHash }),
  });
}

export function saveLayout(
  viewId: string,
  layout: ViewLayout,
): Promise<{ layout: ViewLayout }> {
  return requestJson(`/api/layout/${encodeURIComponent(viewId)}`, {
    method: "PUT",
    body: JSON.stringify(layout),
  });
}

export function clearLayout(viewId: string): Promise<{ cleared: true }> {
  return requestJson(`/api/layout/${encodeURIComponent(viewId)}`, {
    method: "DELETE",
  });
}

export function fetchThreads(params?: {
  view_id?: string;
  target_type?: ThreadTargetType;
  target_id?: string;
  entity_ref?: string;
  status?: "open" | "resolved";
  query?: string;
}): Promise<{ threads: DesignThread[] }> {
  const qs = new URLSearchParams();
  if (params?.view_id) qs.set("view_id", params.view_id);
  if (params?.target_type) qs.set("target_type", params.target_type);
  if (params?.target_id) qs.set("target_id", params.target_id);
  if (params?.entity_ref) qs.set("entity_ref", params.entity_ref);
  if (params?.status) qs.set("status", params.status);
  if (params?.query) qs.set("query", params.query);
  const query = qs.toString();
  return requestJson<{ threads: DesignThread[] }>(
    `/api/threads${query ? `?${query}` : ""}`,
  );
}

export function createThread(input: {
  target_type: ThreadTargetType;
  view_id?: string;
  target_id?: string;
  entity_ref?: string;
  kind: ThreadKind;
  body: string;
}): Promise<{ thread: DesignThread }> {
  return requestJson("/api/threads", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function postThreadReply(
  threadId: string,
  input: {
    body: string;
    resolve?: boolean;
    reopen?: boolean;
    resolution_summary?: string;
  },
): Promise<{ thread: DesignThread }> {
  return requestJson(`/api/threads/${encodeURIComponent(threadId)}/messages`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchCrossLinks(
  entityRef: string,
): Promise<{ entity_ref: string; occurrences: CrossLinkOccurrence[] }> {
  return requestJson(
    `/api/cross-links/${encodeURIComponent(entityRef)}`,
  );
}

export async function fetchPreferences(): Promise<UserPreferences> {
  const res = await requestJson<{ preferences: UserPreferences }>(
    "/api/preferences",
  );
  return res.preferences;
}

export async function savePreferences(
  patch: UserPreferences,
): Promise<UserPreferences> {
  const res = await requestJson<{ preferences: UserPreferences }>(
    "/api/preferences",
    {
      method: "PUT",
      body: JSON.stringify(patch),
    },
  );
  return res.preferences;
}

export function connectWebSocket(
  onEvent: (event: WsEvent) => void,
  onStatus: (connected: boolean) => void,
): () => void {
  let closed = false;
  let socket: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  const connect = () => {
    if (closed) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      attempt = 0;
      onStatus(true);
    };

    socket.onmessage = (msg) => {
      try {
        const event = JSON.parse(String(msg.data)) as WsEvent;
        onEvent(event);
      } catch {
        // Ignore malformed frame
      }
    };

    socket.onclose = () => {
      onStatus(false);
      if (closed) return;
      const delay = Math.min(8000, 400 * Math.pow(1.6, attempt));
      attempt += 1;
      retryTimer = setTimeout(connect, delay);
    };

    socket.onerror = () => {
      socket?.close();
    };
  };

  connect();

  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    socket?.close();
  };
}
