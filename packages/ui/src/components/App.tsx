import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Layers } from "lucide-react";
import {
  isThreadWaitingOnHuman,
  type Cardinality,
  type DesignEdge,
  type DesignNode,
  type DesignThread,
  type DesignView,
  type EdgeRoute,
  type EntityField,
  type HandleSide,
  type RelationKind,
  type SemanticDiff,
  type ThreadTargetType,
  type ViewDirection,
} from "@redlinify/shared/browser";
import {
  ApiError,
  clearLayout,
  connectWebSocket,
  createBlankView,
  createThread,
  createViewRequest,
  deleteView,
  deleteViewRequest,
  fetchThreads,
  fetchView,
  fetchWorkspace,
  postThreadReply,
  reorderWorkspaceTabs,
  saveLayout,
  saveView,
  type TabStatusSummary,
  type WorkspaceSnapshot,
} from "../api/client";
import { computeAutoLayout } from "../layout/elk";
import { computeSmartEdgeRouting, type Point } from "../layout/routing";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { EdgeCreateModal } from "./EdgeCreateModal";
import {
  InspectorDrawer,
  type DrawerMode,
  type ElementDrawerTab,
  type WorkspaceDrawerTab,
} from "./InspectorDrawer";
import { StepEdge, type StepFlowEdge } from "./StepEdge";
import { StructuredNode, type StructuredFlowNode } from "./StructuredNode";
import { TabBar } from "./TabBar";
import { TriageBar, type TriageFilter } from "./TriageBar";

const nodeTypes = { structured: StructuredNode };
const edgeTypes = { step: StepEdge };

interface ToastState {
  id: number;
  message: string;
  tone: "info" | "warning" | "error";
}

type ContextMenuState =
  | { kind: "pane"; x: number; y: number; flowPos: Point }
  | { kind: "node"; x: number; y: number; nodeId: string }
  | { kind: "edge"; x: number; y: number; edgeId: string; flowPos: Point };

function getModifiedNodeIds(diff: SemanticDiff | null): Set<string> {
  const set = new Set<string>();
  if (!diff) return set;
  for (const n of diff.nodes_added) set.add(n.id);
  for (const n of diff.nodes_modified) set.add(n.id);
  return set;
}

function isEditableFocus(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    (el as HTMLElement).isContentEditable
  );
}

function WorkbenchInner() {
  const { fitView, getViewport, setViewport, setCenter, screenToFlowPosition } =
    useReactFlow();

  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<DesignView | null>(null);
  const [viewHash, setViewHash] = useState<string | undefined>(undefined);
  const [viewDiff, setViewDiff] = useState<SemanticDiff | null>(null);
  const [allThreads, setAllThreads] = useState<DesignThread[]>([]);

  const [rfNodes, setRfNodes, onNodesChange] =
    useNodesState<StructuredFlowNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<StepFlowEdge>([]);

  const [filter, setFilter] = useState<TriageFilter>("all");
  const [drawerMode, setDrawerMode] = useState<DrawerMode>("none");
  const [elementTab, setElementTab] = useState<ElementDrawerTab>("spec");
  const [workspaceTab, setWorkspaceTab] =
    useState<WorkspaceDrawerTab>("questions");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [pulsingNodeId, setPulsingNodeId] = useState<string | null>(null);
  const [pendingConn, setPendingConn] = useState<Connection | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [conflictBanner, setConflictBanner] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [routingTick, setRoutingTick] = useState(0);
  const [historyTick, setHistoryTick] = useState(0);

  const positionsRef = useRef<Record<string, Point>>({});
  const edgeRoutesRef = useRef<Record<string, EdgeRoute>>({});
  const undoMapRef = useRef<Map<string, DesignView[]>>(new Map());
  const redoMapRef = useRef<Map<string, DesignView[]>>(new Map());
  const viewportReadyRef = useRef(false);
  const activeViewIdRef = useRef<string | null>(null);
  const activeViewRef = useRef<DesignView | null>(null);
  const viewHashRef = useRef<string | undefined>(undefined);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  activeViewIdRef.current = activeViewId;
  activeViewRef.current = activeView;
  viewHashRef.current = viewHash;

  const showToast = useCallback(
    (message: string, tone: "info" | "warning" | "error" = "info") => {
      const id = Date.now();
      setToast({ id, message, tone });
      setTimeout(() => {
        setToast((curr) => (curr?.id === id ? null : curr));
      }, 3600);
    },
    [],
  );

  const loadWorkspaceMeta = useCallback(async () => {
    const [wsSnap, thrRes] = await Promise.all([
      fetchWorkspace(),
      fetchThreads(),
    ]);
    setSnapshot(wsSnap);
    setAllThreads(thrRes.threads);
    return wsSnap;
  }, []);

  const persistCurrentLayout = useCallback(async (viewId: string) => {
    await saveLayout(viewId, {
      positions: positionsRef.current,
      edge_routes: edgeRoutesRef.current,
      viewport: getViewport(),
    });
  }, [getViewport]);

  const loadViewDetail = useCallback(
    async (
      viewId: string,
      options?: { preserveViewport?: boolean; forceResetLayout?: boolean },
    ) => {
      const detail = await fetchView(viewId);
      const savedPositions = options?.forceResetLayout
        ? {}
        : detail.layout.positions;
      const mergedPositions = await computeAutoLayout(
        detail.view,
        { positions: savedPositions },
        { forceReset: options?.forceResetLayout },
      );

      positionsRef.current = mergedPositions;
      edgeRoutesRef.current = options?.forceResetLayout
        ? {}
        : (detail.layout.edge_routes ?? {});
      setActiveView(detail.view);
      setViewHash(detail.view_hash);
      setViewDiff(detail.diff);
      setConflictBanner(false);
      setLayoutVersion((v) => v + 1);
      setRoutingTick((t) => t + 1);

      if (!options?.preserveViewport) {
        viewportReadyRef.current = false;
        requestAnimationFrame(() => {
          if (detail.layout.viewport && !options?.forceResetLayout) {
            void setViewport(detail.layout.viewport, { duration: 150 });
          } else {
            void fitView({ padding: 0.16, maxZoom: 1.05, duration: 180 });
          }
          setTimeout(() => {
            viewportReadyRef.current = true;
          }, 250);
        });
      }
    },
    [fitView, setViewport],
  );

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const wsSnap = await loadWorkspaceMeta();
        if (cancelled) return;
        const hashId = window.location.hash.startsWith("#view=")
          ? decodeURIComponent(window.location.hash.slice("#view=".length))
          : null;
        const firstId = wsSnap.status.tabs[0]?.view_id ?? null;
        const initialId =
          hashId && wsSnap.status.tabs.some((t) => t.view_id === hashId)
            ? hashId
            : firstId;

        if (initialId) {
          setActiveViewId(initialId);
          await loadViewDetail(initialId);
        }
      } catch (err) {
        if (!cancelled) {
          showToast(
            err instanceof Error ? err.message : "Failed to load workspace",
            "error",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadWorkspaceMeta, loadViewDetail, showToast]);

  // WebSocket live updates
  useEffect(() => {
    const disconnect = connectWebSocket(
      (event) => {
        void (async () => {
          await loadWorkspaceMeta();
          const currentId = activeViewIdRef.current;

          if (
            event.type === "view_updated" &&
            currentId &&
            event.view_id === currentId &&
            event.origin === "external"
          ) {
            await loadViewDetail(currentId, { preserveViewport: true });
            showToast(`Agent updated view "${currentId}"`, "info");
          } else if (
            event.type === "view_updated" &&
            event.origin === "external"
          ) {
            showToast(`Agent updated "${event.view_id}"`, "info");
          } else if (
            event.type === "threads_updated" &&
            event.origin === "external"
          ) {
            showToast("Agent updated a thread", "info");
          } else if (
            event.type === "workspace_updated" &&
            event.origin === "external"
          ) {
            const ws = await loadWorkspaceMeta();
            if (!currentId && ws.status.tabs[0]?.view_id) {
              const first = ws.status.tabs[0].view_id;
              setActiveViewId(first);
              await loadViewDetail(first);
            }
          }
        })();
      },
      setWsConnected,
    );
    return disconnect;
  }, [loadWorkspaceMeta, loadViewDetail, showToast]);

  const persistView = useCallback(
    async (
      nextView: DesignView,
      options?: { recordHistory?: boolean },
    ) => {
      const recordHistory = options?.recordHistory !== false;
      const currentSnapshot = activeViewRef.current;
      if (
        recordHistory &&
        currentSnapshot &&
        currentSnapshot.id === nextView.id
      ) {
        const undoStack = undoMapRef.current.get(nextView.id) ?? [];
        undoStack.push(structuredClone(currentSnapshot));
        if (undoStack.length > 40) undoStack.shift();
        undoMapRef.current.set(nextView.id, undoStack);
        redoMapRef.current.set(nextView.id, []);
        setHistoryTick((t) => t + 1);
      }

      const run = async () => {
        try {
          const saved = await saveView(nextView, viewHashRef.current);
          setActiveView(saved.view);
          setViewHash(saved.view_hash);
          setViewDiff(saved.diff);
          setConflictBanner(false);
          await loadWorkspaceMeta();
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            setConflictBanner(true);
            showToast(
              "View changed on disk; reload to sync latest version.",
              "warning",
            );
          } else {
            showToast(
              err instanceof Error ? err.message : "Failed to save view",
              "error",
            );
          }
          throw err;
        }
      };

      const queued = saveChainRef.current.then(run, run);
      saveChainRef.current = queued.catch(() => {});
      return queued;
    },
    [loadWorkspaceMeta, showToast],
  );

  const handleUndo = useCallback(async () => {
    const curr = activeViewRef.current;
    if (!curr) return;
    const undoStack = undoMapRef.current.get(curr.id) ?? [];
    const prev = undoStack.pop();
    if (!prev) return;
    const redoStack = redoMapRef.current.get(curr.id) ?? [];
    redoStack.push(structuredClone(curr));
    redoMapRef.current.set(curr.id, redoStack);
    setHistoryTick((t) => t + 1);
    await persistView(prev, { recordHistory: false });
    showToast("Undone");
  }, [persistView, showToast]);

  const handleRedo = useCallback(async () => {
    const curr = activeViewRef.current;
    if (!curr) return;
    const redoStack = redoMapRef.current.get(curr.id) ?? [];
    const next = redoStack.pop();
    if (!next) return;
    const undoStack = undoMapRef.current.get(curr.id) ?? [];
    undoStack.push(structuredClone(curr));
    undoMapRef.current.set(curr.id, undoStack);
    setHistoryTick((t) => t + 1);
    await persistView(next, { recordHistory: false });
    showToast("Redone");
  }, [persistView, showToast]);

  // Global keyboard shortcuts: Ctrl+Z / Cmd+Z (Undo) and Ctrl+Shift+Z / Ctrl+Y (Redo)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableFocus()) return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        void handleUndo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        void handleRedo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleRedo, handleUndo]);

  // Node inline action callbacks
  const handleToggleLock = useCallback(
    (nodeId: string) => {
      const curr = activeViewRef.current;
      if (!curr) return;
      void persistView({
        ...curr,
        nodes: curr.nodes.map((n) =>
          n.id === nodeId ? { ...n, locked: !n.locked } : n,
        ),
      });
    },
    [persistView],
  );

  const handleInlineUpdateTitle = useCallback(
    (nodeId: string, nextTitle: string) => {
      const curr = activeViewRef.current;
      if (!curr) return;
      void persistView({
        ...curr,
        nodes: curr.nodes.map((n) =>
          n.id === nodeId ? { ...n, title: nextTitle } : n,
        ),
      });
    },
    [persistView],
  );

  const handleInlineUpdateItem = useCallback(
    (
      nodeId: string,
      sectionId: string,
      itemIndex: number,
      nextValue: string,
    ) => {
      const curr = activeViewRef.current;
      if (!curr) return;
      void persistView({
        ...curr,
        nodes: curr.nodes.map((n) => {
          if (n.id !== nodeId) return n;
          return {
            ...n,
            sections: n.sections.map((sec) => {
              if (sec.id !== sectionId) return sec;
              const items = [...sec.items];
              if (!nextValue.trim()) {
                items.splice(itemIndex, 1);
              } else {
                items[itemIndex] = nextValue;
              }
              return { ...sec, items };
            }),
          };
        }),
      });
    },
    [persistView],
  );

  const handleInlineAddItem = useCallback(
    (nodeId: string, sectionId: string, item: string) => {
      const curr = activeViewRef.current;
      if (!curr) return;
      void persistView({
        ...curr,
        nodes: curr.nodes.map((n) => {
          if (n.id !== nodeId) return n;
          return {
            ...n,
            sections: n.sections.map((sec) =>
              sec.id === sectionId
                ? { ...sec, items: [...sec.items, item] }
                : sec,
            ),
          };
        }),
      });
    },
    [persistView],
  );

  const handleInlineToggleFieldNullable = useCallback(
    (nodeId: string, fieldId: string) => {
      const curr = activeViewRef.current;
      if (!curr) return;
      void persistView({
        ...curr,
        nodes: curr.nodes.map((n) => {
          if (n.id !== nodeId) return n;
          return {
            ...n,
            fields: (n.fields ?? []).map((f) =>
              f.id === fieldId ? { ...f, nullable: !f.nullable } : f,
            ),
          };
        }),
      });
    },
    [persistView],
  );

  const handleInlineUpdateFieldName = useCallback(
    (nodeId: string, fieldId: string, nextName: string) => {
      const curr = activeViewRef.current;
      if (!curr) return;
      void persistView({
        ...curr,
        nodes: curr.nodes.map((n) => {
          if (n.id !== nodeId) return n;
          return {
            ...n,
            fields: (n.fields ?? []).map((f) =>
              f.id === fieldId ? { ...f, name: nextName } : f,
            ),
          };
        }),
      });
    },
    [persistView],
  );

  const handleInlineAddField = useCallback(
    (nodeId: string, name: string) => {
      const curr = activeViewRef.current;
      if (!curr) return;
      const newField: EntityField = {
        id: `fld_${Date.now().toString(36).slice(-5)}`,
        name,
        type: "varchar",
        nullable: false,
      };
      void persistView({
        ...curr,
        nodes: curr.nodes.map((n) =>
          n.id === nodeId
            ? { ...n, fields: [...(n.fields ?? []), newField] }
            : n,
        ),
      });
    },
    [persistView],
  );

  const handleOpenNodeThreads = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setDrawerMode("node");
    setElementTab("threads");
  }, []);

  const handleCommitWaypoints = useCallback(
    (edgeId: string, waypoints: Point[]) => {
      const viewId = activeViewIdRef.current;
      if (!viewId) return;
      const currentRoute = edgeRoutesRef.current[edgeId] ?? {};
      if (waypoints.length === 0) {
        const nextRoute = { ...currentRoute };
        delete nextRoute.waypoints;
        if (Object.keys(nextRoute).length === 0) {
          delete edgeRoutesRef.current[edgeId];
        } else {
          edgeRoutesRef.current[edgeId] = nextRoute;
        }
      } else {
        edgeRoutesRef.current = {
          ...edgeRoutesRef.current,
          [edgeId]: { ...currentRoute, waypoints },
        };
      }
      setRoutingTick((t) => t + 1);
      void persistCurrentLayout(viewId);
    },
    [persistCurrentLayout],
  );

  const handleUpdateEdgeRoute = useCallback(
    (edgeId: string, patch: Partial<EdgeRoute> | null) => {
      const viewId = activeViewIdRef.current;
      if (!viewId) return;
      if (patch === null) {
        const next = { ...edgeRoutesRef.current };
        delete next[edgeId];
        edgeRoutesRef.current = next;
      } else {
        const prev = edgeRoutesRef.current[edgeId] ?? {};
        const merged: EdgeRoute = { ...prev, ...patch };
        if (!merged.source_handle) delete merged.source_handle;
        if (!merged.target_handle) delete merged.target_handle;
        if (!merged.waypoints || merged.waypoints.length === 0) {
          delete merged.waypoints;
        }
        if (Object.keys(merged).length === 0) {
          const next = { ...edgeRoutesRef.current };
          delete next[edgeId];
          edgeRoutesRef.current = next;
        } else {
          edgeRoutesRef.current = {
            ...edgeRoutesRef.current,
            [edgeId]: merged,
          };
        }
      }
      setRoutingTick((t) => t + 1);
      void persistCurrentLayout(viewId);
    },
    [persistCurrentLayout],
  );

  // Sync DesignView -> React Flow nodes
  const editedNodeIds = useMemo(() => getModifiedNodeIds(viewDiff), [viewDiff]);

  useEffect(() => {
    if (!activeView) {
      setRfNodes([]);
      return;
    }

    const viewThreads = allThreads.filter(
      (t) => t.status === "open" && t.view_id === activeView.id,
    );

    const nextNodes: StructuredFlowNode[] = activeView.nodes.map((node) => {
      const nodeThreads = viewThreads.filter(
        (t) => t.target_type === "node" && t.target_id === node.id,
      );
      const waitingOnHumanCount = nodeThreads.filter(
        isThreadWaitingOnHuman,
      ).length;
      const isEdited = editedNodeIds.has(node.id);

      let matchesFilter = true;
      if (filter === "waiting_on_me") matchesFilter = waitingOnHumanCount > 0;
      else if (filter === "my_edits") matchesFilter = isEdited;
      else if (filter === "locked") matchesFilter = node.locked;
      else if (filter === "drifted") matchesFilter = node.status === "drifted";

      return {
        id: node.id,
        type: "structured",
        position: positionsRef.current[node.id] ?? { x: 40, y: 40 },
        selected: selectedNodeId === node.id,
        data: {
          node,
          diagramType: activeView.diagram_type ?? "general",
          isHumanEdited: isEdited,
          waitingOnHumanCount,
          totalOpenThreads: nodeThreads.length,
          dimmed: !matchesFilter,
          pulsing: pulsingNodeId === node.id,
          onToggleLock: handleToggleLock,
          onInlineUpdateTitle: handleInlineUpdateTitle,
          onInlineUpdateItem: handleInlineUpdateItem,
          onInlineAddItem: handleInlineAddItem,
          onInlineToggleFieldNullable: handleInlineToggleFieldNullable,
          onInlineUpdateFieldName: handleInlineUpdateFieldName,
          onInlineAddField: handleInlineAddField,
          onOpenNodeThreads: handleOpenNodeThreads,
        },
      };
    });

    setRfNodes(nextNodes);
  }, [
    activeView,
    allThreads,
    editedNodeIds,
    filter,
    handleInlineAddField,
    handleInlineAddItem,
    handleInlineToggleFieldNullable,
    handleInlineUpdateFieldName,
    handleInlineUpdateItem,
    handleInlineUpdateTitle,
    handleOpenNodeThreads,
    handleToggleLock,
    layoutVersion,
    pulsingNodeId,
    selectedNodeId,
    setRfNodes,
  ]);

  // Sync DesignView + smart routing -> React Flow edges (runs smoothly on drag too!)
  useEffect(() => {
    if (!activeView) {
      setRfEdges([]);
      return;
    }

    const viewThreads = allThreads.filter(
      (t) => t.status === "open" && t.view_id === activeView.id,
    );
    const dimmedNodeIds = new Set<string>();
    for (const node of activeView.nodes) {
      const nodeThreads = viewThreads.filter(
        (t) => t.target_type === "node" && t.target_id === node.id,
      );
      const waitingCount = nodeThreads.filter(isThreadWaitingOnHuman).length;
      const isEdited = editedNodeIds.has(node.id);
      let matches = true;
      if (filter === "waiting_on_me") matches = waitingCount > 0;
      else if (filter === "my_edits") matches = isEdited;
      else if (filter === "locked") matches = node.locked;
      else if (filter === "drifted") matches = node.status === "drifted";
      if (!matches) dimmedNodeIds.add(node.id);
    }

    const routing = computeSmartEdgeRouting(
      activeView,
      positionsRef.current,
      edgeRoutesRef.current,
    );

    const nextEdges: StepFlowEdge[] = activeView.edges.map((edge) => {
      const route = routing[edge.id];
      const diagramType = activeView.diagram_type ?? "general";
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: route?.sourceHandle ?? "right",
        targetHandle: route?.targetHandle ?? "left",
        type: "step",
        selected: selectedEdgeId === edge.id,
        markerEnd:
          diagramType === "er"
            ? undefined
            : {
                type: MarkerType.ArrowClosed,
                color: selectedEdgeId === edge.id ? "#38bdf8" : "#64748b",
              },
        data: {
          edge,
          diagramType,
          dimmed:
            dimmedNodeIds.has(edge.source) && dimmedNodeIds.has(edge.target),
          manualWaypoints: route?.manualWaypoints ?? [],
          autoWaypoints: route?.autoWaypoints ?? [],
          curveOffset: route?.curveOffset ?? { x: 0, y: 0 },
          onCommitWaypoints: handleCommitWaypoints,
        },
      };
    });

    setRfEdges(nextEdges);
  }, [
    activeView,
    allThreads,
    editedNodeIds,
    filter,
    handleCommitWaypoints,
    layoutVersion,
    routingTick,
    selectedEdgeId,
    setRfEdges,
  ]);

  const handleSelectView = useCallback(
    async (viewId: string) => {
      setActiveViewId(viewId);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setContextMenu(null);
      if (drawerMode === "node" || drawerMode === "edge") {
        setDrawerMode("none");
      }
      window.location.hash = `view=${encodeURIComponent(viewId)}`;
      await loadViewDetail(viewId);
    },
    [drawerMode, loadViewDetail],
  );

  const handleJumpToTarget = useCallback(
    async (
      viewId: string | undefined,
      targetType: ThreadTargetType,
      targetId?: string,
      preferredTab?: ElementDrawerTab,
    ) => {
      if (viewId && viewId !== activeViewIdRef.current) {
        setActiveViewId(viewId);
        window.location.hash = `view=${encodeURIComponent(viewId)}`;
        await loadViewDetail(viewId);
      }

      if (targetType === "node" && targetId) {
        setSelectedNodeId(targetId);
        setSelectedEdgeId(null);
        setDrawerMode("node");
        setElementTab(preferredTab ?? "links");
        setPulsingNodeId(targetId);
        setTimeout(() => {
          setPulsingNodeId((curr) => (curr === targetId ? null : curr));
        }, 2800);
        const pos = positionsRef.current[targetId];
        if (pos) {
          void setCenter(pos.x + 150, pos.y + 90, { zoom: 1, duration: 280 });
        }
      } else if (targetType === "edge" && targetId) {
        setSelectedEdgeId(targetId);
        setSelectedNodeId(null);
        setDrawerMode("edge");
        setElementTab(
          preferredTab === "links" ? "spec" : (preferredTab ?? "threads"),
        );
      } else {
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setDrawerMode("workspace");
        setWorkspaceTab("adrs");
      }
    },
    [loadViewDetail, setCenter],
  );

  const createBoxAtPosition = useCallback(
    async (flowPos?: Point) => {
      if (!activeView) return;
      const suffix = Date.now().toString(36).slice(-4);
      const isEr = activeView.diagram_type === "er";
      const id = isEr ? `entity_${suffix}` : `box_${suffix}`;

      const pos = flowPos
        ? { x: Math.round(flowPos.x - 140), y: Math.round(flowPos.y - 40) }
        : (() => {
            const center = screenToFlowPosition({
              x: window.innerWidth * 0.42,
              y: window.innerHeight * 0.48,
            });
            return {
              x: Math.round(center.x - 140),
              y: Math.round(center.y - 60),
            };
          })();

      positionsRef.current = { ...positionsRef.current, [id]: pos };

      const newNode: DesignNode = isEr
        ? {
            id,
            kind: "Entity",
            title: "NewEntity",
            status: "draft",
            locked: false,
            sections: [],
            fields: [
              {
                id: "id",
                name: "id",
                type: "uuid",
                pk: true,
                nullable: false,
              },
            ],
          }
        : {
            id,
            kind: "Component",
            title: "New Component",
            status: "draft",
            locked: false,
            sections: [
              {
                id: "responsibilities",
                heading: "Responsibilities",
                items: ["describe behavior"],
              },
            ],
          };

      const nextView: DesignView = {
        ...activeView,
        nodes: [...activeView.nodes, newNode],
      };
      await persistCurrentLayout(activeView.id);
      await persistView(nextView);
      setLayoutVersion((v) => v + 1);
      setSelectedNodeId(id);
      setSelectedEdgeId(null);
      setDrawerMode("node");
      setElementTab("spec");
    },
    [activeView, persistCurrentLayout, persistView, screenToFlowPosition],
  );

  const handleAutoLayout = useCallback(async () => {
    if (!activeView) return;
    await clearLayout(activeView.id);
    await loadViewDetail(activeView.id, { forceResetLayout: true });
    showToast("Auto-layout and smart edge routes reset");
  }, [activeView, loadViewDetail, showToast]);

  const handleToggleDirection = useCallback(async () => {
    if (!activeView) return;
    const nextDir: ViewDirection = activeView.direction === "TB" ? "LR" : "TB";
    const nextView: DesignView = { ...activeView, direction: nextDir };
    await persistView(nextView);
    await clearLayout(activeView.id);
    await loadViewDetail(activeView.id, { forceResetLayout: true });
  }, [activeView, loadViewDetail, persistView]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<StructuredFlowNode>[]) => {
      onNodesChange(changes);
      let moved = false;
      for (const ch of changes) {
        if (ch.type === "position" && ch.position) {
          positionsRef.current[ch.id] = {
            x: Math.round(ch.position.x),
            y: Math.round(ch.position.y),
          };
          moved = true;
        }
      }
      if (moved) {
        setRoutingTick((t) => t + 1);
      }
    },
    [onNodesChange],
  );

  const handleNodeDragStop = useCallback(
    (_event: unknown, draggedNode: StructuredFlowNode) => {
      if (!activeView) return;
      positionsRef.current = {
        ...positionsRef.current,
        [draggedNode.id]: {
          x: Math.round(draggedNode.position.x),
          y: Math.round(draggedNode.position.y),
        },
      };
      setRoutingTick((t) => t + 1);
      void persistCurrentLayout(activeView.id);
    },
    [activeView, persistCurrentLayout],
  );

  const handleMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => {
      if (!activeView || !viewportReadyRef.current) return;
      void saveLayout(activeView.id, {
        positions: positionsRef.current,
        edge_routes: edgeRoutesRef.current,
        viewport,
      });
    },
    [activeView],
  );

  const handleReconnect = useCallback(
    async (oldEdge: Edge, newConnection: Connection) => {
      if (!activeView || !newConnection.source || !newConnection.target) return;
      const existing = activeView.edges.find((e) => e.id === oldEdge.id);
      if (!existing) return;
      if (existing.locked) {
        showToast("Unlock edge before reconnecting it.", "warning");
        return;
      }

      const nextRoute: EdgeRoute = {
        ...(edgeRoutesRef.current[oldEdge.id] ?? {}),
        ...(newConnection.sourceHandle
          ? { source_handle: newConnection.sourceHandle as HandleSide }
          : {}),
        ...(newConnection.targetHandle
          ? { target_handle: newConnection.targetHandle as HandleSide }
          : {}),
      };
      edgeRoutesRef.current = {
        ...edgeRoutesRef.current,
        [oldEdge.id]: nextRoute,
      };
      setRoutingTick((t) => t + 1);
      await persistCurrentLayout(activeView.id);

      if (
        existing.source !== newConnection.source ||
        existing.target !== newConnection.target
      ) {
        await persistView({
          ...activeView,
          edges: activeView.edges.map((e) =>
            e.id === oldEdge.id
              ? {
                  ...e,
                  source: newConnection.source!,
                  target: newConnection.target!,
                }
              : e,
          ),
        });
      }
    },
    [activeView, persistCurrentLayout, persistView, showToast],
  );

  const handleBeforeDelete = useCallback(
    async ({
      nodes: nodesToDel,
      edges: edgesToDel,
    }: {
      nodes: StructuredFlowNode[];
      edges: StepFlowEdge[];
    }) => {
      if (!activeView || isEditableFocus()) return false;

      const removeNodeIds = new Set(nodesToDel.map((n) => n.id));
      const removeEdgeIds = new Set(edgesToDel.map((e) => e.id));

      for (const node of activeView.nodes) {
        if (removeNodeIds.has(node.id) && node.locked) {
          showToast(`Unlock "${node.title}" before deleting it.`, "warning");
          return false;
        }
      }
      for (const edge of activeView.edges) {
        const incidentToRemovedNode =
          removeNodeIds.has(edge.source) || removeNodeIds.has(edge.target);
        if (
          (removeEdgeIds.has(edge.id) || incidentToRemovedNode) &&
          edge.locked
        ) {
          showToast("Unlock locked edge before deleting.", "warning");
          return false;
        }
      }

      const nextView: DesignView = {
        ...activeView,
        nodes: activeView.nodes.filter((n) => !removeNodeIds.has(n.id)),
        edges: activeView.edges.filter(
          (e) =>
            !removeEdgeIds.has(e.id) &&
            !removeNodeIds.has(e.source) &&
            !removeNodeIds.has(e.target),
        ),
      };

      if (selectedNodeId && removeNodeIds.has(selectedNodeId)) {
        setSelectedNodeId(null);
        setDrawerMode("none");
      }
      if (selectedEdgeId && removeEdgeIds.has(selectedEdgeId)) {
        setSelectedEdgeId(null);
        setDrawerMode("none");
      }

      await persistView(nextView);
      return true;
    },
    [activeView, persistView, selectedEdgeId, selectedNodeId, showToast],
  );

  const handleConfirmEdge = useCallback(
    async (opts: {
      label?: string;
      step?: number;
      style: "solid" | "dashed";
      source_cardinality?: Cardinality;
      target_cardinality?: Cardinality;
      relation_kind?: RelationKind;
    }) => {
      if (!activeView || !pendingConn?.source || !pendingConn?.target) {
        setPendingConn(null);
        return;
      }
      const edgeId = `e_${Date.now().toString(36)}`;
      const edge: DesignEdge = {
        id: edgeId,
        source: pendingConn.source,
        target: pendingConn.target,
        ...(opts.label ? { label: opts.label } : {}),
        ...(opts.step !== undefined ? { step: opts.step } : {}),
        style: opts.style,
        ...(opts.source_cardinality
          ? { source_cardinality: opts.source_cardinality }
          : {}),
        ...(opts.target_cardinality
          ? { target_cardinality: opts.target_cardinality }
          : {}),
        ...(opts.relation_kind ? { relation_kind: opts.relation_kind } : {}),
      };

      if (pendingConn.sourceHandle || pendingConn.targetHandle) {
        edgeRoutesRef.current = {
          ...edgeRoutesRef.current,
          [edgeId]: {
            ...(pendingConn.sourceHandle
              ? { source_handle: pendingConn.sourceHandle as HandleSide }
              : {}),
            ...(pendingConn.targetHandle
              ? { target_handle: pendingConn.targetHandle as HandleSide }
              : {}),
          },
        };
        await persistCurrentLayout(activeView.id);
      }

      setPendingConn(null);
      await persistView({
        ...activeView,
        edges: [...activeView.edges, edge],
      });
    },
    [activeView, pendingConn, persistCurrentLayout, persistView],
  );

  const handleDeleteView = useCallback(
    async (viewId: string) => {
      await deleteView(viewId);
      undoMapRef.current.delete(viewId);
      redoMapRef.current.delete(viewId);
      const wsSnap = await loadWorkspaceMeta();
      if (activeViewIdRef.current === viewId) {
        const nextTab = wsSnap.status.tabs[0]?.view_id ?? null;
        setActiveViewId(nextTab);
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setDrawerMode("none");
        if (nextTab) {
          window.location.hash = `view=${encodeURIComponent(nextTab)}`;
          await loadViewDetail(nextTab);
        } else {
          window.location.hash = "";
          setActiveView(null);
          setViewDiff(null);
        }
      }
      showToast(`Deleted tab "${viewId}"`);
    },
    [loadViewDetail, loadWorkspaceMeta, showToast],
  );

  // Build context menu items cleanly from current state
  const contextMenuData = useMemo((): {
    header?: string;
    items: ContextMenuItem[];
  } | null => {
    if (!contextMenu || !activeView) return null;
    const isEr = activeView.diagram_type === "er";
    const undoStack = undoMapRef.current.get(activeView.id) ?? [];
    const redoStack = redoMapRef.current.get(activeView.id) ?? [];

    if (contextMenu.kind === "pane") {
      return {
        header: activeView.title,
        items: [
          {
            id: "add_box",
            label: isEr ? "Add Entity Here" : "Add Box Here",
            onSelect: () => void createBoxAtPosition(contextMenu.flowPos),
          },
          {
            id: "auto_layout",
            label: "Auto-Layout & Reset Routes",
            dividerBefore: true,
            onSelect: () => void handleAutoLayout(),
          },
          {
            id: "toggle_dir",
            label: `Switch Direction (${activeView.direction === "TB" ? "LR" : "TB"})`,
            onSelect: () => void handleToggleDirection(),
          },
          {
            id: "undo",
            label: "Undo",
            shortcut: "Ctrl+Z",
            dividerBefore: true,
            disabled: undoStack.length === 0,
            onSelect: () => void handleUndo(),
          },
          {
            id: "redo",
            label: "Redo",
            shortcut: "Ctrl+Shift+Z",
            disabled: redoStack.length === 0,
            onSelect: () => void handleRedo(),
          },
        ],
      };
    }

    if (contextMenu.kind === "node") {
      const node = activeView.nodes.find((n) => n.id === contextMenu.nodeId);
      if (!node) return null;
      const items: ContextMenuItem[] = [
        {
          id: "add_entry",
          label: isEr
            ? "Add Attribute"
            : `Add Entry to ${node.sections[0]?.heading ?? "Details"}`,
          disabled: node.locked,
          onSelect: () => {
            if (isEr) {
              const name = `col_${(node.fields?.length ?? 0) + 1}`;
              handleInlineAddField(node.id, name);
            } else if (node.sections.length > 0) {
              handleInlineAddItem(node.id, node.sections[0]!.id, "new_item");
            } else {
              void persistView({
                ...activeView,
                nodes: activeView.nodes.map((n) =>
                  n.id === node.id
                    ? {
                        ...n,
                        sections: [
                          {
                            id: `sec_${Date.now().toString(36)}`,
                            heading: "Details",
                            items: ["new_item"],
                          },
                        ],
                      }
                    : n,
                ),
              });
            }
          },
        },
        ...(isEr
          ? []
          : [
              {
                id: "add_section",
                label: "Add Section",
                disabled: node.locked,
                onSelect: () => {
                  void persistView({
                    ...activeView,
                    nodes: activeView.nodes.map((n) =>
                      n.id === node.id
                        ? {
                            ...n,
                            sections: [
                              ...n.sections,
                              {
                                id: `sec_${Date.now().toString(36)}`,
                                heading: "New Section",
                                items: ["new_item"],
                              },
                            ],
                          }
                        : n,
                    ),
                  });
                },
              },
            ]),
        {
          id: "duplicate",
          label: isEr ? "Duplicate Entity" : "Duplicate Box",
          onSelect: () => {
            const copyId = `${node.id}_copy_${Date.now().toString(36).slice(-3)}`;
            const origPos = positionsRef.current[node.id] ?? { x: 80, y: 80 };
            positionsRef.current[copyId] = {
              x: origPos.x + 36,
              y: origPos.y + 36,
            };
            const clone: DesignNode = {
              ...structuredClone(node),
              id: copyId,
              title: `${node.title} Copy`,
              locked: false,
              status: "draft",
            };
            delete clone.entity_ref;
            delete clone.code_refs;
            void persistCurrentLayout(activeView.id);
            void persistView({
              ...activeView,
              nodes: [...activeView.nodes, clone],
            });
            setLayoutVersion((v) => v + 1);
          },
        },
        {
          id: "lock",
          label: node.locked ? "Unlock" : "Lock",
          dividerBefore: true,
          onSelect: () => handleToggleLock(node.id),
        },
        {
          id: "spec",
          label: "Edit in Spec Drawer",
          onSelect: () => {
            setSelectedNodeId(node.id);
            setSelectedEdgeId(null);
            setDrawerMode("node");
            setElementTab("spec");
          },
        },
        {
          id: "threads",
          label: "Open Threads",
          onSelect: () => handleOpenNodeThreads(node.id),
        },
        {
          id: "delete",
          label: isEr ? "Delete Entity" : "Delete Box",
          danger: true,
          dividerBefore: true,
          disabled: node.locked,
          onSelect: () => {
            const lockedEdge = activeView.edges.find(
              (e) =>
                (e.source === node.id || e.target === node.id) && e.locked,
            );
            if (lockedEdge) {
              showToast("Unlock incident edge first.", "warning");
              return;
            }
            if (selectedNodeId === node.id) {
              setSelectedNodeId(null);
              setDrawerMode("none");
            }
            void persistView({
              ...activeView,
              nodes: activeView.nodes.filter((n) => n.id !== node.id),
              edges: activeView.edges.filter(
                (e) => e.source !== node.id && e.target !== node.id,
              ),
            });
          },
        },
      ];
      return { header: node.title, items };
    }

    const edge = activeView.edges.find((e) => e.id === contextMenu.edgeId);
    if (!edge) return null;
    const edgeItems: ContextMenuItem[] = [
      {
        id: "add_bend",
        label: "Add Bend Point Here",
        onSelect: () => {
          const existingWps = edgeRoutesRef.current[edge.id]?.waypoints ?? [];
          handleCommitWaypoints(edge.id, [
            ...existingWps,
            {
              x: Math.round(contextMenu.flowPos.x),
              y: Math.round(contextMenu.flowPos.y),
            },
          ]);
        },
      },
      {
        id: "reset_route",
        label: "Reset Line Route",
        onSelect: () => handleUpdateEdgeRoute(edge.id, null),
      },
      {
        id: "flip",
        label: "Flip Direction (A ↔ B)",
        dividerBefore: true,
        disabled: Boolean(edge.locked),
        onSelect: () => {
          void persistView({
            ...activeView,
            edges: activeView.edges.map((e) =>
              e.id === edge.id
                ? {
                    ...e,
                    source: e.target,
                    target: e.source,
                    source_cardinality: e.target_cardinality,
                    target_cardinality: e.source_cardinality,
                  }
                : e,
            ),
          });
        },
      },
      ...(isEr
        ? []
        : [
            {
              id: "toggle_dash",
              label:
                edge.style === "dashed"
                  ? "Make Solid Line"
                  : "Make Dashed Line",
              disabled: Boolean(edge.locked),
              onSelect: () => {
                void persistView({
                  ...activeView,
                  edges: activeView.edges.map((e) =>
                    e.id === edge.id
                      ? {
                          ...e,
                          style: e.style === "dashed" ? "solid" : "dashed",
                        }
                      : e,
                  ),
                });
              },
            },
          ]),
      {
        id: "lock_edge",
        label: edge.locked ? "Unlock Edge" : "Lock Edge",
        dividerBefore: true,
        onSelect: () => {
          void persistView({
            ...activeView,
            edges: activeView.edges.map((e) =>
              e.id === edge.id ? { ...e, locked: !e.locked } : e,
            ),
          });
        },
      },
      {
        id: "delete_edge",
        label: "Delete Edge",
        danger: true,
        dividerBefore: true,
        disabled: Boolean(edge.locked),
        onSelect: () => {
          if (selectedEdgeId === edge.id) {
            setSelectedEdgeId(null);
            setDrawerMode("none");
          }
          void persistView({
            ...activeView,
            edges: activeView.edges.filter((e) => e.id !== edge.id),
          });
        },
      },
    ];
    return { header: `${edge.source} → ${edge.target}`, items: edgeItems };
  }, [
    activeView,
    contextMenu,
    createBoxAtPosition,
    handleAutoLayout,
    handleCommitWaypoints,
    handleInlineAddField,
    handleInlineAddItem,
    handleOpenNodeThreads,
    handleRedo,
    handleToggleDirection,
    handleToggleLock,
    handleUndo,
    handleUpdateEdgeRoute,
    historyTick,
    persistCurrentLayout,
    persistView,
    selectedEdgeId,
    selectedNodeId,
    showToast,
  ]);

  const selectedNode = useMemo(
    () => activeView?.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [activeView, selectedNodeId],
  );

  const selectedEdge = useMemo(
    () => activeView?.edges.find((e) => e.id === selectedEdgeId) ?? null,
    [activeView, selectedEdgeId],
  );

  const tabs = snapshot?.status.tabs ?? [];
  const viewRequests = snapshot?.status.view_requests ?? [];
  const pendingFeedback = snapshot?.pending_feedback ?? {
    view_hashes: {},
    view_diffs: [],
    pending_threads: [],
    view_requests: [],
  };
  const openQuestionsCount = useMemo(
    () => allThreads.filter(isThreadWaitingOnHuman).length,
    [allThreads],
  );
  const pendingAgentCount =
    pendingFeedback.view_diffs.length +
    pendingFeedback.pending_threads.length +
    pendingFeedback.view_requests.length;

  const canUndo = useMemo(() => {
    void historyTick;
    return Boolean(
      activeView && (undoMapRef.current.get(activeView.id)?.length ?? 0) > 0,
    );
  }, [activeView, historyTick]);

  const canRedo = useMemo(() => {
    void historyTick;
    return Boolean(
      activeView && (redoMapRef.current.get(activeView.id)?.length ?? 0) > 0,
    );
  }, [activeView, historyTick]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <TabBar
        projectName={snapshot?.status.project_name ?? "Redlinify"}
        tabs={tabs}
        viewRequests={viewRequests}
        activeViewId={activeViewId}
        onSelectView={(id) => void handleSelectView(id)}
        onReorderTabs={(nextTabs: TabStatusSummary[]) => {
          void reorderWorkspaceTabs(
            nextTabs.map(
              ({ view_id, title, diagram_type, description, order }) => ({
                view_id,
                title,
                ...(diagram_type ? { diagram_type } : {}),
                ...(description ? { description } : {}),
                order,
              }),
            ),
          ).then(() => loadWorkspaceMeta());
        }}
        onDeleteRequest={(id) => {
          void deleteViewRequest(id).then(() => loadWorkspaceMeta());
        }}
        onRequestView={async (input) => {
          await createViewRequest(input);
          await loadWorkspaceMeta();
          showToast(`Queued view request "${input.title}"`);
        }}
        onCreateBlankView={async (input) => {
          const created = await createBlankView(input);
          await loadWorkspaceMeta();
          await handleSelectView(created.view.id);
        }}
        onDeleteView={handleDeleteView}
      />

      <TriageBar
        filter={filter}
        onChangeFilter={setFilter}
        hasActiveView={Boolean(activeView)}
        diagramType={activeView?.diagram_type ?? "general"}
        direction={activeView?.direction ?? "TB"}
        onToggleDirection={() => void handleToggleDirection()}
        onAddBox={() => void createBoxAtPosition()}
        onAutoLayout={() => void handleAutoLayout()}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => void handleUndo()}
        onRedo={() => void handleRedo()}
        openQuestionsCount={openQuestionsCount}
        pendingAgentCount={pendingAgentCount}
        onOpenQuestions={() => {
          setSelectedNodeId(null);
          setSelectedEdgeId(null);
          setDrawerMode("workspace");
          setWorkspaceTab("questions");
        }}
        onOpenPendingReview={() => {
          setSelectedNodeId(null);
          setSelectedEdgeId(null);
          setDrawerMode("workspace");
          setWorkspaceTab("pending");
        }}
        wsConnected={wsConnected}
      />

      {conflictBanner && activeView && (
        <div className="flex items-center justify-between bg-amber-500/15 border-b border-amber-500/40 px-4 py-1.5 text-xs text-amber-200">
          <span>
            This view was updated on disk while you were editing. Reload to sync
            latest changes.
          </span>
          <button
            type="button"
            onClick={() =>
              void loadViewDetail(activeView.id, { preserveViewport: true })
            }
            className="rounded bg-amber-500 px-2.5 py-0.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
          >
            Reload View
          </button>
        </div>
      )}

      <div className="relative flex flex-1 min-h-0">
        <div className="relative flex-1 min-w-0 min-h-0">
          {!activeView ? (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center text-slate-400">
              <div className="mb-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <Layers className="h-8 w-8 text-sky-400" />
              </div>
              <h2 className="text-base font-semibold text-slate-200">
                No diagram view open
              </h2>
              <p className="mt-1 max-w-md text-xs text-slate-400">
                Click <span className="font-semibold text-slate-200">+</span> in
                the top tab bar to create a blank diagram (General or ER) or
                queue a view request for your coding agent.
              </p>
            </div>
          ) : (
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              connectionMode={ConnectionMode.Loose}
              edgesReconnectable
              onNodesChange={handleNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDragStop={handleNodeDragStop}
              onMoveEnd={handleMoveEnd}
              onReconnect={(oldEdge, newConn) =>
                void handleReconnect(oldEdge, newConn)
              }
              onBeforeDelete={handleBeforeDelete}
              onConnect={(conn) => {
                if (conn.source && conn.target) {
                  setPendingConn(conn);
                }
              }}
              onNodeClick={(_e, node) => {
                setContextMenu(null);
                setSelectedNodeId(node.id);
                setSelectedEdgeId(null);
                setDrawerMode("node");
              }}
              onEdgeClick={(_e, edge) => {
                setContextMenu(null);
                setSelectedEdgeId(edge.id);
                setSelectedNodeId(null);
                setDrawerMode("edge");
                if (elementTab === "links") setElementTab("spec");
              }}
              onPaneClick={() => {
                setContextMenu(null);
                setSelectedNodeId(null);
                setSelectedEdgeId(null);
                if (drawerMode === "node" || drawerMode === "edge") {
                  setDrawerMode("none");
                }
              }}
              onPaneContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({
                  kind: "pane",
                  x: e.clientX,
                  y: e.clientY,
                  flowPos: screenToFlowPosition({
                    x: e.clientX,
                    y: e.clientY,
                  }),
                });
              }}
              onNodeContextMenu={(e, node) => {
                e.preventDefault();
                setSelectedNodeId(node.id);
                setSelectedEdgeId(null);
                setContextMenu({
                  kind: "node",
                  x: e.clientX,
                  y: e.clientY,
                  nodeId: node.id,
                });
              }}
              onEdgeContextMenu={(e, edge) => {
                e.preventDefault();
                setSelectedEdgeId(edge.id);
                setSelectedNodeId(null);
                setContextMenu({
                  kind: "edge",
                  x: e.clientX,
                  y: e.clientY,
                  edgeId: edge.id,
                  flowPos: screenToFlowPosition({
                    x: e.clientX,
                    y: e.clientY,
                  }),
                });
              }}
              deleteKeyCode={["Backspace", "Delete"]}
              minZoom={0.2}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={22}
                size={1.2}
                color="#1e293b"
              />
              <Controls showInteractive={false} />
              <MiniMap
                className="hidden sm:block"
                nodeColor={(n) => {
                  const data = n.data as { node?: DesignNode } | undefined;
                  if (data?.node?.status === "drifted") return "#f43f5e";
                  if (data?.node?.locked) return "#f59e0b";
                  return "#38bdf8";
                }}
                maskColor="rgba(2, 6, 23, 0.75)"
              />
            </ReactFlow>
          )}

          {toast && (
            <div
              className={`pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-3.5 py-2 text-xs font-medium shadow-xl ${
                toast.tone === "error"
                  ? "border-rose-500/50 bg-rose-950/90 text-rose-100"
                  : toast.tone === "warning"
                    ? "border-amber-500/50 bg-amber-950/90 text-amber-100"
                    : "border-sky-500/40 bg-slate-900/95 text-slate-100"
              }`}
            >
              {toast.message}
            </div>
          )}
        </div>

        <InspectorDrawer
          mode={drawerMode}
          elementTab={elementTab}
          workspaceTab={workspaceTab}
          onChangeElementTab={setElementTab}
          onChangeWorkspaceTab={setWorkspaceTab}
          onClose={() => setDrawerMode("none")}
          activeView={activeView}
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          edgeRoute={
            selectedEdge ? edgeRoutesRef.current[selectedEdge.id] : undefined
          }
          allThreads={allThreads}
          viewDiff={viewDiff}
          pendingFeedback={pendingFeedback}
          status={snapshot?.status ?? null}
          onSaveNode={async (updated) => {
            if (!activeView) return;
            await persistView({
              ...activeView,
              nodes: activeView.nodes.map((n) =>
                n.id === updated.id ? updated : n,
              ),
            });
          }}
          onDeleteNode={async (nodeId) => {
            if (!activeView) return;
            const lockedEdge = activeView.edges.find(
              (e) =>
                (e.source === nodeId || e.target === nodeId) && e.locked,
            );
            if (lockedEdge) {
              showToast("Unlock incident edge before deleting node", "warning");
              return;
            }
            setSelectedNodeId(null);
            setDrawerMode("none");
            await persistView({
              ...activeView,
              nodes: activeView.nodes.filter((n) => n.id !== nodeId),
              edges: activeView.edges.filter(
                (e) => e.source !== nodeId && e.target !== nodeId,
              ),
            });
          }}
          onSaveEdge={async (updated) => {
            if (!activeView) return;
            await persistView({
              ...activeView,
              edges: activeView.edges.map((e) =>
                e.id === updated.id ? updated : e,
              ),
            });
          }}
          onDeleteEdge={async (edgeId) => {
            if (!activeView) return;
            setSelectedEdgeId(null);
            setDrawerMode("none");
            await persistView({
              ...activeView,
              edges: activeView.edges.filter((e) => e.id !== edgeId),
            });
          }}
          onUpdateEdgeRoute={handleUpdateEdgeRoute}
          onCreateThread={async (input) => {
            await createThread(input);
            await loadWorkspaceMeta();
          }}
          onReplyThread={async (threadId, input) => {
            await postThreadReply(threadId, input);
            await loadWorkspaceMeta();
          }}
          onOpenTab={(viewId) => void handleSelectView(viewId)}
          onJumpToTarget={(viewId, targetType, targetId, preferredTab) => {
            void handleJumpToTarget(viewId, targetType, targetId, preferredTab);
          }}
          onNotify={showToast}
        />
      </div>

      {contextMenu && contextMenuData && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          header={contextMenuData.header}
          items={contextMenuData.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      {pendingConn && activeView && (
        <EdgeCreateModal
          diagramType={activeView.diagram_type ?? "general"}
          sourceTitle={
            activeView.nodes.find((n) => n.id === pendingConn.source)?.title ??
            pendingConn.source ??
            ""
          }
          targetTitle={
            activeView.nodes.find((n) => n.id === pendingConn.target)?.title ??
            pendingConn.target ??
            ""
          }
          onCancel={() => setPendingConn(null)}
          onConfirm={(opts) => void handleConfirmEdge(opts)}
        />
      )}
    </div>
  );
}

export function App() {
  return (
    <ReactFlowProvider>
      <WorkbenchInner />
    </ReactFlowProvider>
  );
}
