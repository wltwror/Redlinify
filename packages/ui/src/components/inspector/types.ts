import type {
  DesignEdge,
  DesignNode,
  DesignThread,
  DesignView,
  EdgeRoute,
  SemanticDiff,
  ThreadKind,
  ThreadTargetType,
} from "@redlinify/shared/browser";
import type {
  PendingFeedbackResult,
  WorkspaceStatusResult,
} from "../../api/client";

export type DrawerMode = "none" | "node" | "edge" | "workspace";
export type ElementDrawerTab = "spec" | "threads" | "links";
export type WorkspaceDrawerTab = "questions" | "pending" | "adrs";

export interface CreateThreadInput {
  target_type: ThreadTargetType;
  view_id?: string;
  target_id?: string;
  entity_ref?: string;
  kind: ThreadKind;
  body: string;
}

export interface ReplyThreadInput {
  body: string;
  resolve?: boolean;
  reopen?: boolean;
  resolution_summary?: string;
}

export interface InspectorDrawerProps {
  mode: DrawerMode;
  elementTab: ElementDrawerTab;
  workspaceTab: WorkspaceDrawerTab;
  onChangeElementTab: (tab: ElementDrawerTab) => void;
  onChangeWorkspaceTab: (tab: WorkspaceDrawerTab) => void;
  onClose: () => void;
  activeView: DesignView | null;
  selectedNode: DesignNode | null;
  selectedEdge: DesignEdge | null;
  edgeRoute?: EdgeRoute;
  allThreads: DesignThread[];
  viewDiff: SemanticDiff | null;
  pendingFeedback: PendingFeedbackResult;
  status: WorkspaceStatusResult | null;
  onSaveNode: (updated: DesignNode) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onSaveEdge: (updated: DesignEdge) => Promise<void>;
  onDeleteEdge: (edgeId: string) => Promise<void>;
  onUpdateEdgeRoute: (edgeId: string, patch: Partial<EdgeRoute> | null) => void;
  onFlipEdge: (edgeId: string) => void;
  onCreateThread: (input: CreateThreadInput) => Promise<void>;
  onReplyThread: (threadId: string, input: ReplyThreadInput) => Promise<void>;
  onOpenTab: (viewId: string) => void;
  onJumpToTarget: (
    viewId: string | undefined,
    targetType: ThreadTargetType,
    targetId?: string,
    preferredTab?: ElementDrawerTab,
  ) => void;
  onNotify: (message: string, tone?: "info" | "warning" | "error") => void;
}
