import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Layers, RotateCcw } from "lucide-react";
import {
  isThreadWaitingOnHuman,
  type DesignNode,
  type DesignView,
  type EdgeRoute,
  type SemanticDiff,
  type ThreadTargetType,
} from "@redlinify/shared/browser";
import {
  createBlankView,
  createThread,
  createViewRequest,
  deleteView,
  deleteViewRequest,
  postThreadReply,
  reorderWorkspaceTabs,
  type TabStatusSummary,
} from "../api/client";
import type { ElkAutoEdgeRoute } from "../layout/elk";
import { computeSmartEdgeRouting, type Point } from "../layout/routing";
import { useCanvasContextMenu } from "../hooks/useCanvasContextMenu";
import { useCanvasInteractions } from "../hooks/useCanvasInteractions";
import { useCanvasShortcuts } from "../hooks/useCanvasShortcuts";
import { useDiagramExport } from "../hooks/useDiagramExport";
import { useThemePreferences } from "../hooks/useThemePreferences";
import { useToast } from "../hooks/useToast";
import { useViewHistory } from "../hooks/useViewHistory";
import { useViewportNavigation } from "../hooks/useViewportNavigation";
import { useWorkspaceSearch } from "../hooks/useWorkspaceSearch";
import { useWorkspaceSync } from "../hooks/useWorkspaceSync";
import {
  getModifiedEdgeIds,
  revertEdgeToBaseline,
  revertNodeToBaseline,
  summarizeEdgeDiff,
  summarizeNodeDiff,
} from "../utils/diffSummary";
import {
  VIEWPORT_MAX_ZOOM,
  VIEWPORT_MIN_ZOOM,
} from "../utils/viewportNavigation";
import { CanvasDock } from "./CanvasDock";
import { CommandSearchModal } from "./CommandSearchModal";
import { ContextMenu } from "./ContextMenu";
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
const MULTI_SELECTION_KEY_CODE = ["Control", "Meta"];
const DELETE_KEY_CODE = ["Backspace", "Delete"];
const PRO_OPTIONS = { hideAttribution: true };
const DRAWER_TOGGLE_COOLDOWN_MS = 350;

function getModifiedNodeIds(diff: SemanticDiff | null): Set<string> {
  const set = new Set<string>();
  if (!diff) return set;
  for (const n of diff.nodes_added) set.add(n.id);
  for (const n of diff.nodes_modified) set.add(n.id);
  return set;
}

function WorkbenchInner() {
  const {
    fitView,
    getViewport,
    setViewport,
    setCenter,
    screenToFlowPosition,
    zoomIn,
    zoomOut,
    zoomTo,
  } = useReactFlow();

  const {
    theme,
    bgPattern,
    scrollMode,
    setScrollMode,
    toggleTheme,
    toggleBgPattern,
  } = useThemePreferences();
  const { toast, showToast } = useToast();

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
  const [appliedLayoutVersion, setAppliedLayoutVersion] = useState(0);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const lastCursorRef = useRef<{ x: number; y: number } | null>(null);
  const toggleCooldownRef = useRef<Record<string, number>>({});
  const positionsRef = useRef<Record<string, Point>>({});
  const edgeRoutesRef = useRef<Record<string, EdgeRoute>>({});
  const measuredSizesRef = useRef<
    Record<string, { width?: number; height?: number }>
  >({});
  const elkRoutesRef = useRef<Record<string, ElkAutoEdgeRoute>>({});
  const expandedNodeIdsRef = useRef<Record<string, boolean>>({});
  const focusNodeIdRef = useRef<string | null>(null);
  focusNodeIdRef.current = hoveredNodeId ?? selectedNodeId;
  const viewportReadyRef = useRef(false);
  const viewportSyncTokenRef = useRef(0);
  const activeViewIdRef = useRef<string | null>(null);
  const activeViewRef = useRef<DesignView | null>(null);
  const lastSyncedNodesViewIdRef = useRef<string | null>(null);
  const lastSyncedEdgesViewIdRef = useRef<string | null>(null);
  const pendingSelectNodeIdRef = useRef<string | null>(null);
  const pendingSelectEdgeIdRef = useRef<string | null>(null);

  const {
    historyTick,
    undoMapRef,
    redoMapRef,
    pushHistoryEntry,
    undoWith,
    redoWith,
    clearViewHistory,
  } = useViewHistory({
    activeViewRef,
    positionsRef,
    edgeRoutesRef,
    showToast,
  });

  const {
    snapshot,
    tabs,
    activeViewId,
    setActiveViewId,
    activeView,
    setActiveView,
    viewDiff,
    setViewDiff,
    viewBaseline,
    allThreads,
    wsConnected,
    wsEverConnected,
    wsGraceExpired,
    conflictBanner,
    layoutVersion,
    setLayoutVersion,
    pendingViewportSyncRef,
    routingTick,
    setRoutingTick,
    loadWorkspaceMeta,
    persistCurrentLayout,
    loadViewDetail,
    persistView,
    applyHistoryEntry,
  } = useWorkspaceSync({
    activeViewIdRef,
    activeViewRef,
    positionsRef,
    edgeRoutesRef,
    measuredSizesRef,
    elkRoutesRef,
    viewportReadyRef,
    getViewport,
    pushHistoryEntry,
    showToast,
  });

  const handleUndo = useCallback(
    () => undoWith(applyHistoryEntry),
    [applyHistoryEntry, undoWith],
  );

  const handleRedo = useCallback(
    () => redoWith(applyHistoryEntry),
    [applyHistoryEntry, redoWith],
  );

  const selectedNodeIds = useMemo(
    () => rfNodes.filter((n) => n.selected).map((n) => n.id),
    [rfNodes],
  );

  useEffect(() => {
    if (selectedNodeIds.length > 1) {
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setDrawerMode((curr) =>
        curr === "node" || curr === "edge" ? "none" : curr,
      );
    }
  }, [selectedNodeIds.length]);

  const selectSingleNode = useCallback(
    (nodeId: string | null) => {
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
      setRfNodes((prev) => {
        let changed = false;
        const next = prev.map((n) => {
          const shouldSelect = nodeId !== null && n.id === nodeId;
          if (Boolean(n.selected) === shouldSelect) return n;
          changed = true;
          return { ...n, selected: shouldSelect };
        });
        return changed ? next : prev;
      });
      setRfEdges((prev) => {
        let changed = false;
        const next = prev.map((edge) => {
          if (!edge.selected) return edge;
          changed = true;
          return { ...edge, selected: false };
        });
        return changed ? next : prev;
      });
    },
    [setRfEdges, setRfNodes],
  );

  const selectSingleEdge = useCallback(
    (edgeId: string | null) => {
      setSelectedEdgeId(edgeId);
      setSelectedNodeId(null);
      setRfNodes((prev) => {
        let changed = false;
        const next = prev.map((n) => {
          if (!n.selected) return n;
          changed = true;
          return { ...n, selected: false };
        });
        return changed ? next : prev;
      });
      setRfEdges((prev) => {
        let changed = false;
        const next = prev.map((edge) => {
          const shouldSelect = edgeId !== null && edge.id === edgeId;
          if (Boolean(edge.selected) === shouldSelect) return edge;
          changed = true;
          return { ...edge, selected: shouldSelect };
        });
        return changed ? next : prev;
      });
    },
    [setRfEdges, setRfNodes],
  );

  const {
    handleToggleLock,
    handleInlineUpdateTitle,
    handleInlineUpdateItem,
    handleInlineAddItem,
    handleInlineToggleFieldNullable,
    handleInlineUpdateFieldName,
    handleInlineAddField,
    handleOpenNodeThreads,
    handleCommitWaypoints,
    handleUpdateEdgeRoute,
    createBoxAtPosition,
    handleChangeNodeShape,
    handleAutoLayout,
    handleToggleDirection,
    snapshotDragOrigin,
    handleNodesChange,
    handleNodeDragStop,
    handleSelectionDragStop,
    handleMoveEnd,
    handleReconnectCallback,
    handleFlipEdge,
    handleBeforeDelete,
    handleConfirmEdge,
    handleConnect,
  } = useCanvasInteractions({
    activeView,
    activeViewIdRef,
    activeViewRef,
    positionsRef,
    edgeRoutesRef,
    measuredSizesRef,
    viewportReadyRef,
    pendingSelectNodeIdRef,
    selectedNodeId,
    selectedEdgeId,
    setSelectedNodeId,
    setSelectedEdgeId,
    setDrawerMode,
    setElementTab,
    pendingConn,
    setPendingConn,
    setLayoutVersion,
    setRoutingTick,
    onNodesChange,
    screenToFlowPosition,
    pushHistoryEntry,
    persistCurrentLayout,
    persistView,
    loadViewDetail,
    selectSingleNode,
    showToast,
  });

  const canTriggerToggle = useCallback((key: string): boolean => {
    const now = Date.now();
    const last = toggleCooldownRef.current[key] ?? 0;
    if (now - last < DRAWER_TOGGLE_COOLDOWN_MS) {
      return false;
    }
    toggleCooldownRef.current[key] = now;
    return true;
  }, []);

  const editedNodeIds = useMemo(() => getModifiedNodeIds(viewDiff), [viewDiff]);
  const editedEdgeIds = useMemo(() => getModifiedEdgeIds(viewDiff), [viewDiff]);

  const handleRevertNode = useCallback(
    async (nodeId: string) => {
      if (!activeView) return;
      const reverted = revertNodeToBaseline(activeView, viewBaseline, nodeId);
      if (!reverted) {
        showToast("No baseline state available to revert", "warning");
        return;
      }
      const targetNode =
        activeView.nodes.find((n) => n.id === nodeId) ??
        viewBaseline?.nodes.find((n) => n.id === nodeId);
      if (
        selectedNodeId === nodeId &&
        !reverted.nodes.some((n) => n.id === nodeId)
      ) {
        setSelectedNodeId(null);
        setDrawerMode("none");
      }
      await persistView(reverted);
      showToast(
        `Reverted "${targetNode?.title ?? nodeId}" to unmodified state`,
      );
    },
    [activeView, persistView, selectedNodeId, showToast, viewBaseline],
  );

  const handleRevertEdge = useCallback(
    async (edgeId: string) => {
      if (!activeView) return;
      const reverted = revertEdgeToBaseline(activeView, viewBaseline, edgeId);
      if (!reverted) {
        showToast(
          "Cannot revert edge (missing endpoint or baseline)",
          "warning",
        );
        return;
      }
      if (
        selectedEdgeId === edgeId &&
        !reverted.edges.some((e) => e.id === edgeId)
      ) {
        setSelectedEdgeId(null);
        setDrawerMode("none");
      }
      await persistView(reverted);
      showToast("Reverted edge to unmodified state");
    },
    [activeView, persistView, selectedEdgeId, showToast, viewBaseline],
  );

  const handleRevertViewToBaseline = useCallback(async () => {
    if (!activeView || !viewBaseline) {
      showToast("No agent checkpoint baseline to revert to", "warning");
      return;
    }
    const restored = structuredClone(viewBaseline);
    if (
      selectedNodeId &&
      !restored.nodes.some((n) => n.id === selectedNodeId)
    ) {
      setSelectedNodeId(null);
      setDrawerMode("none");
    }
    if (
      selectedEdgeId &&
      !restored.edges.some((e) => e.id === selectedEdgeId)
    ) {
      setSelectedEdgeId(null);
      setDrawerMode("none");
    }
    await persistView(restored);
    showToast(`Reverted "${activeView.title}" to unmodified state`);
  }, [
    activeView,
    persistView,
    selectedEdgeId,
    selectedNodeId,
    showToast,
    viewBaseline,
  ]);

  const handleUnlockAllInView = useCallback(async () => {
    if (!activeView) return;
    await persistView({
      ...activeView,
      nodes: activeView.nodes.map((n) => ({ ...n, locked: false })),
      edges: activeView.edges.map((e) => ({ ...e, locked: false })),
    });
    showToast(`Unlocked all elements in "${activeView.title}"`);
  }, [activeView, persistView, showToast]);

  const handleUpdateNodeStatus = useCallback(
    async (nodeId: string, status: DesignNode["status"]) => {
      if (!activeView) return;
      await persistView({
        ...activeView,
        nodes: activeView.nodes.map((n) =>
          n.id === nodeId ? { ...n, status } : n,
        ),
      });
      showToast(`Marked status as ${status}`);
    },
    [activeView, persistView, showToast],
  );

  const handleToggleWorkspaceTab = useCallback(
    (tab: WorkspaceDrawerTab) => {
      if (!canTriggerToggle(`workspace:${tab}`)) return;
      if (drawerMode === "workspace" && workspaceTab === tab) {
        setDrawerMode("none");
        return;
      }
      selectSingleNode(null);
      setDrawerMode("workspace");
      setWorkspaceTab(tab);
    },
    [canTriggerToggle, drawerMode, selectSingleNode, workspaceTab],
  );

  const handleSelectFilter = useCallback(
    (next: TriageFilter) => {
      if (!canTriggerToggle(`filter:${next}`)) return;
      setFilter((curr) => (next !== "all" && curr === next ? "all" : next));
    },
    [canTriggerToggle],
  );

  const handleToggleNodeThreads = useCallback(
    (nodeId: string) => {
      if (!canTriggerToggle(`node-threads:${nodeId}`)) return;
      if (
        drawerMode === "node" &&
        selectedNodeId === nodeId &&
        elementTab === "threads"
      ) {
        setDrawerMode("none");
        return;
      }
      handleOpenNodeThreads(nodeId);
    },
    [
      canTriggerToggle,
      drawerMode,
      elementTab,
      handleOpenNodeThreads,
      selectedNodeId,
    ],
  );

  const handleAddBoxAtCursor = useCallback(async () => {
    if (!activeViewRef.current) return;
    const container = canvasContainerRef.current;
    const cursor = lastCursorRef.current;
    if (container && cursor) {
      const rect = container.getBoundingClientRect();
      if (
        cursor.x >= rect.left &&
        cursor.x <= rect.right &&
        cursor.y >= rect.top &&
        cursor.y <= rect.bottom
      ) {
        await createBoxAtPosition(screenToFlowPosition(cursor));
        return;
      }
    }
    await createBoxAtPosition();
  }, [createBoxAtPosition, screenToFlowPosition]);

  const {
    contextMenu,
    contextMenuData,
    clearContextMenu,
    handlePaneContextMenu,
    handleNodeContextMenu,
    handleEdgeContextMenu,
  } = useCanvasContextMenu({
    activeView,
    filter,
    viewDiff,
    viewBaseline,
    editedNodeIds,
    editedEdgeIds,
    positionsRef,
    edgeRoutesRef,
    undoMapRef,
    redoMapRef,
    historyTick,
    rfNodes,
    selectedNodeId,
    selectedEdgeId,
    setSelectedNodeId,
    setSelectedEdgeId,
    setDrawerMode,
    setElementTab,
    setLayoutVersion,
    screenToFlowPosition,
    selectSingleNode,
    selectSingleEdge,
    createBoxAtPosition,
    handleChangeNodeShape,
    handleAutoLayout,
    handleToggleDirection,
    handleUndo,
    handleRedo,
    handleRevertNode,
    handleRevertEdge,
    handleRevertViewToBaseline,
    handleUnlockAllInView,
    handleUpdateNodeStatus,
    handleToggleLock,
    handleInlineAddItem,
    handleInlineAddField,
    handleOpenNodeThreads,
    handleCommitWaypoints,
    handleUpdateEdgeRoute,
    handleFlipEdge,
    persistCurrentLayout,
    persistView,
    showToast,
  });

  const handleDragStart = useCallback(() => {
    clearContextMenu();
    setHoveredNodeId(null);
    snapshotDragOrigin();
  }, [clearContextMenu, snapshotDragOrigin]);

  const handleExpandedChange = useCallback(
    (nodeId: string, expanded: boolean) => {
      const curr = Boolean(expandedNodeIdsRef.current[nodeId]);
      if (curr === expanded) return;
      if (expanded) {
        expandedNodeIdsRef.current = {
          ...expandedNodeIdsRef.current,
          [nodeId]: true,
        };
      } else {
        const nextMap = { ...expandedNodeIdsRef.current };
        delete nextMap[nodeId];
        expandedNodeIdsRef.current = nextMap;
      }
      setRfNodes((prev) => {
        let changed = false;
        const targetZ = expanded ? 1200 : undefined;
        const next = prev.map((n) => {
          if (n.id !== nodeId || n.zIndex === targetZ) return n;
          changed = true;
          return { ...n, zIndex: targetZ };
        });
        return changed ? next : prev;
      });
    },
    [setRfNodes],
  );

  useEffect(() => {
    expandedNodeIdsRef.current = {};
    setHoveredNodeId(null);
  }, [activeView?.id]);

  const handleSelectView = useCallback(
    async (viewId: string) => {
      setActiveViewId(viewId);
      selectSingleNode(null);
      clearContextMenu();
      if (drawerMode === "node" || drawerMode === "edge") {
        setDrawerMode("none");
      }
      window.location.hash = `view=${encodeURIComponent(viewId)}`;
      await loadViewDetail(viewId);
    },
    [
      clearContextMenu,
      drawerMode,
      loadViewDetail,
      selectSingleNode,
      setActiveViewId,
    ],
  );

  const handleJumpToTarget = useCallback(
    async (
      viewId: string | undefined,
      targetType: ThreadTargetType,
      targetId?: string,
      preferredTab?: ElementDrawerTab,
    ) => {
      let targetView = activeViewRef.current;
      const shouldPreserveViewport =
        (targetType === "node" || targetType === "edge") && Boolean(targetId);

      if (viewId && viewId !== activeViewIdRef.current) {
        pendingSelectNodeIdRef.current =
          targetType === "node" && targetId ? targetId : null;
        pendingSelectEdgeIdRef.current =
          targetType === "edge" && targetId ? targetId : null;
        setActiveViewId(viewId);
        window.location.hash = `view=${encodeURIComponent(viewId)}`;
        targetView = await loadViewDetail(viewId, {
          preserveViewport: shouldPreserveViewport,
        });
      }

      if (targetType === "node" && targetId) {
        selectSingleNode(targetId);
        setDrawerMode("node");
        setElementTab(preferredTab ?? "links");
        setPulsingNodeId(targetId);
        setTimeout(() => {
          setPulsingNodeId((curr) => (curr === targetId ? null : curr));
        }, 2800);
        const pos = positionsRef.current[targetId];
        if (pos) {
          viewportReadyRef.current = false;
          requestAnimationFrame(() => {
            void setCenter(pos.x + 150, pos.y + 90, {
              zoom: 1,
              duration: 280,
            });
            setTimeout(() => {
              viewportReadyRef.current = true;
            }, 320);
          });
        } else if (shouldPreserveViewport) {
          viewportReadyRef.current = false;
          requestAnimationFrame(() => {
            void fitView({ padding: 0.16, maxZoom: 1.05, duration: 180 });
            setTimeout(() => {
              viewportReadyRef.current = true;
            }, 250);
          });
        }
      } else if (targetType === "edge" && targetId) {
        selectSingleEdge(targetId);
        setDrawerMode("edge");
        setElementTab(
          preferredTab === "links" ? "spec" : (preferredTab ?? "threads"),
        );
        const edge = targetView?.edges.find((e) => e.id === targetId);
        const srcPos = edge ? positionsRef.current[edge.source] : undefined;
        const tgtPos = edge ? positionsRef.current[edge.target] : undefined;
        if (srcPos && tgtPos) {
          const midX = (srcPos.x + tgtPos.x) / 2 + 150;
          const midY = (srcPos.y + tgtPos.y) / 2 + 90;
          viewportReadyRef.current = false;
          requestAnimationFrame(() => {
            void setCenter(midX, midY, { zoom: 1, duration: 280 });
            setTimeout(() => {
              viewportReadyRef.current = true;
            }, 320);
          });
        } else if (shouldPreserveViewport) {
          viewportReadyRef.current = false;
          requestAnimationFrame(() => {
            void fitView({ padding: 0.16, maxZoom: 1.05, duration: 180 });
            setTimeout(() => {
              viewportReadyRef.current = true;
            }, 250);
          });
        }
      } else {
        selectSingleNode(null);
        setDrawerMode("workspace");
        setWorkspaceTab("adrs");
      }
    },
    [
      fitView,
      loadViewDetail,
      selectSingleEdge,
      selectSingleNode,
      setActiveViewId,
      setCenter,
    ],
  );

  const handleDeleteView = useCallback(
    async (viewId: string) => {
      await deleteView(viewId);
      clearViewHistory(viewId);
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
    [
      clearViewHistory,
      loadViewDetail,
      loadWorkspaceMeta,
      setActiveView,
      setActiveViewId,
      setViewDiff,
      showToast,
    ],
  );

  const {
    searchOpen,
    setSearchOpen,
    searchLoading,
    openSearch,
    searchIndexItems,
    handleSelectSearchItem,
  } = useWorkspaceSearch({
    tabs,
    activeView,
    activeViewId,
    activeViewRef,
    allThreads,
    clearContextMenu,
    handleSelectView,
    handleJumpToTarget,
  });

  const {
    startArrowPan,
    stopArrowPan,
    updateArrowShift,
    stopAllArrowPan,
    handleZoomIn,
    handleZoomOut,
    handleFitView,
    handleResetZoom,
  } = useViewportNavigation({
    containerRef: canvasContainerRef,
    activeViewIdRef,
    positionsRef,
    edgeRoutesRef,
    viewportReadyRef,
    scrollMode,
    getViewport,
    setViewport,
    fitView,
    zoomIn,
    zoomOut,
    zoomTo,
    clearContextMenu,
  });

  useCanvasShortcuts({
    activeViewIdRef,
    tabs,
    searchOpen,
    pendingConn,
    setSearchOpen,
    openSearch,
    clearContextMenu,
    handleSelectView,
    handleUndo,
    handleRedo,
    handleAutoLayout,
    handleAddBoxAtCursor,
    startArrowPan,
    stopArrowPan,
    updateArrowShift,
    stopAllArrowPan,
    handleZoomIn,
    handleZoomOut,
    handleFitView,
    handleResetZoom,
  });

  const { handleExportDiagram } = useDiagramExport({
    activeViewRef,
    positionsRef,
    edgeRoutesRef,
    rfNodes,
    theme,
    bgPattern,
    showToast,
  });

  // Sync DesignView -> React Flow nodes
  useEffect(() => {
    if (!activeView) {
      lastSyncedNodesViewIdRef.current = null;
      setRfNodes([]);
      setAppliedLayoutVersion(layoutVersion);
      return;
    }

    const viewThreads = allThreads.filter(
      (t) => t.status === "open" && t.view_id === activeView.id,
    );

    const pendingSelectId = pendingSelectNodeIdRef.current;
    pendingSelectNodeIdRef.current = null;
    const sameView = lastSyncedNodesViewIdRef.current === activeView.id;
    lastSyncedNodesViewIdRef.current = activeView.id;

    setRfNodes((prev) => {
      const prevById = sameView
        ? new Map(prev.map((n) => [n.id, n]))
        : new Map<string, StructuredFlowNode>();

      return activeView.nodes.map((node) => {
        const nodeThreads = viewThreads.filter(
          (t) => t.target_type === "node" && t.target_id === node.id,
        );
        const waitingThreads = nodeThreads.filter(isThreadWaitingOnHuman);
        const waitingOnHumanCount = waitingThreads.length;
        const latestQuestionPreview =
          waitingThreads[0]?.messages[waitingThreads[0].messages.length - 1]
            ?.body;
        const isEdited = editedNodeIds.has(node.id);
        const editSummary = isEdited
          ? summarizeNodeDiff(
              viewDiff,
              node.id,
              activeView.diagram_type ?? "general",
            )
          : [];

        let matchesFilter = true;
        if (filter === "waiting_on_me") matchesFilter = waitingOnHumanCount > 0;
        else if (filter === "my_edits") matchesFilter = isEdited;
        else if (filter === "locked") matchesFilter = node.locked;
        else if (filter === "drifted") matchesFilter = node.status === "drifted";

        const existing = prevById.get(node.id);
        const selected = pendingSelectId
          ? node.id === pendingSelectId
          : Boolean(existing?.selected);
        const zIndex = expandedNodeIdsRef.current[node.id] ? 1200 : undefined;

        return {
          ...(existing ?? {}),
          id: node.id,
          type: "structured",
          position: positionsRef.current[node.id] ?? { x: 40, y: 40 },
          selected,
          zIndex,
          data: {
            node,
            diagramType: activeView.diagram_type ?? "general",
            isHumanEdited: isEdited,
            editSummary,
            activeFilter: filter,
            latestQuestionPreview,
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
            onOpenNodeThreads: handleToggleNodeThreads,
            onExpandedChange: handleExpandedChange,
          },
        };
      });
    });
    setAppliedLayoutVersion(layoutVersion);
  }, [
    activeView,
    allThreads,
    editedNodeIds,
    filter,
    handleExpandedChange,
    handleInlineAddField,
    handleInlineAddItem,
    handleInlineToggleFieldNullable,
    handleInlineUpdateFieldName,
    handleInlineUpdateItem,
    handleInlineUpdateTitle,
    handleToggleLock,
    handleToggleNodeThreads,
    layoutVersion,
    pulsingNodeId,
    setRfNodes,
    viewDiff,
  ]);

  // Execute pending viewport fit/restore strictly after StoreUpdater commits updated rfNodes
  useEffect(() => {
    const pending = pendingViewportSyncRef.current;
    if (!pending || appliedLayoutVersion < pending.layoutVersion) {
      return;
    }
    pendingViewportSyncRef.current = null;
    const token = ++viewportSyncTokenRef.current;
    const action =
      pending.kind === "restore"
        ? setViewport(pending.viewport, { duration: 150 })
        : fitView({ padding: 0.16, maxZoom: 1.05, duration: 180 });
    void Promise.resolve(action).finally(() => {
      setTimeout(() => {
        if (viewportSyncTokenRef.current === token) {
          viewportReadyRef.current = true;
        }
      }, 80);
    });
  }, [
    appliedLayoutVersion,
    fitView,
    pendingViewportSyncRef,
    rfNodes,
    setViewport,
    viewportReadyRef,
  ]);

  // Sync DesignView + smart routing -> React Flow edges (runs smoothly on drag too!)
  useEffect(() => {
    if (!activeView) {
      lastSyncedEdgesViewIdRef.current = null;
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
      measuredSizesRef.current,
      elkRoutesRef.current,
    );

    const pendingSelectId = pendingSelectEdgeIdRef.current;
    pendingSelectEdgeIdRef.current = null;
    const sameView = lastSyncedEdgesViewIdRef.current === activeView.id;
    lastSyncedEdgesViewIdRef.current = activeView.id;
    const focusNodeId = focusNodeIdRef.current;

    setRfEdges((prev) => {
      const prevById = sameView
        ? new Map(prev.map((e) => [e.id, e]))
        : new Map<string, StepFlowEdge>();

      return activeView.edges.map((edge) => {
        const route = routing[edge.id];
        const diagramType = activeView.diagram_type ?? "general";
        const existing = prevById.get(edge.id);
        const selected = pendingSelectId
          ? edge.id === pendingSelectId
          : Boolean(existing?.selected);
        const highlighted =
          focusNodeId !== null &&
          (edge.source === focusNodeId || edge.target === focusNodeId);
        const softDimmed = focusNodeId !== null && !highlighted;

        const isEditedEdge = editedEdgeIds.has(edge.id);
        const edgeEditSummary = isEditedEdge
          ? summarizeEdgeDiff(viewDiff, edge.id)
          : [];
        const edgeDimmed =
          filter === "my_edits"
            ? !isEditedEdge &&
              dimmedNodeIds.has(edge.source) &&
              dimmedNodeIds.has(edge.target)
            : dimmedNodeIds.has(edge.source) && dimmedNodeIds.has(edge.target);

        return {
          ...(existing ?? {}),
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: route?.sourceHandle ?? "right",
          targetHandle: route?.targetHandle ?? "left",
          type: "step",
          selected,
          zIndex: selected ? 1000 : highlighted ? 900 : 0,
          data: {
            edge,
            diagramType,
            dimmed: edgeDimmed,
            highlighted,
            softDimmed,
            isHumanEdited: isEditedEdge,
            showEditedBadge: filter === "my_edits",
            editSummary: edgeEditSummary,
            sourcePortOffset: route?.sourcePortOffset ?? 0,
            targetPortOffset: route?.targetPortOffset ?? 0,
            manualWaypoints: route?.manualWaypoints ?? [],
            autoWaypoints: route?.autoWaypoints ?? [],
            curveOffset: route?.curveOffset ?? { x: 0, y: 0 },
            onCommitWaypoints: handleCommitWaypoints,
          },
        };
      });
    });
  }, [
    activeView,
    allThreads,
    editedEdgeIds,
    editedNodeIds,
    filter,
    handleCommitWaypoints,
    layoutVersion,
    routingTick,
    setRfEdges,
    viewDiff,
  ]);

  // Lightweight hover/selection edge emphasis without recomputing corridor routing
  useEffect(() => {
    const focusNodeId = hoveredNodeId ?? selectedNodeId;
    setRfEdges((prev) => {
      let changed = false;
      const next = prev.map((e) => {
        const highlighted =
          focusNodeId !== null &&
          (e.source === focusNodeId || e.target === focusNodeId);
        const softDimmed = focusNodeId !== null && !highlighted;
        const targetZ = e.selected ? 1000 : highlighted ? 900 : 0;
        if (
          Boolean(e.data?.highlighted) === highlighted &&
          Boolean(e.data?.softDimmed) === softDimmed &&
          (e.zIndex ?? 0) === targetZ
        ) {
          return e;
        }
        changed = true;
        return {
          ...e,
          zIndex: targetZ,
          data: {
            ...(e.data as NonNullable<StepFlowEdge["data"]>),
            highlighted,
            softDimmed,
          },
        };
      });
      return changed ? next : prev;
    });
  }, [hoveredNodeId, selectedNodeId, setRfEdges]);

  const selectedNode = useMemo(
    () => activeView?.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [activeView, selectedNodeId],
  );

  const selectedEdge = useMemo(
    () => activeView?.edges.find((e) => e.id === selectedEdgeId) ?? null,
    [activeView, selectedEdgeId],
  );

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
  const decisionsCount = useMemo(
    () => allThreads.filter((t) => t.status === "resolved").length,
    [allThreads],
  );

  const canUndo = useMemo(() => {
    void historyTick;
    return Boolean(
      activeView && (undoMapRef.current.get(activeView.id)?.length ?? 0) > 0,
    );
  }, [activeView, historyTick, undoMapRef]);

  const canRedo = useMemo(() => {
    void historyTick;
    return Boolean(
      activeView && (redoMapRef.current.get(activeView.id)?.length ?? 0) > 0,
    );
  }, [activeView, historyTick, redoMapRef]);

  const handleNodeClick = useCallback(
    (e: ReactMouseEvent, node: StructuredFlowNode) => {
      clearContextMenu();
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      setSelectedNodeId(node.id);
      setSelectedEdgeId(null);
      setDrawerMode("node");
    },
    [clearContextMenu],
  );

  const handleEdgeClick = useCallback(
    (e: ReactMouseEvent, edge: StepFlowEdge) => {
      clearContextMenu();
      setHoveredNodeId(null);
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      setSelectedEdgeId(edge.id);
      setSelectedNodeId(null);
      setDrawerMode("edge");
      if (elementTab === "links") setElementTab("spec");
    },
    [clearContextMenu, elementTab],
  );

  const handlePaneClick = useCallback(() => {
    clearContextMenu();
    setHoveredNodeId(null);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    if (drawerMode === "node" || drawerMode === "edge") {
      setDrawerMode("none");
    }
  }, [clearContextMenu, drawerMode]);

  const handleNodeMouseEnter = useCallback(
    (_event: ReactMouseEvent, node: StructuredFlowNode) => {
      setHoveredNodeId(node.id);
    },
    [],
  );

  const handleNodeMouseLeave = useCallback(
    (_event: ReactMouseEvent, node: StructuredFlowNode) => {
      setHoveredNodeId((prev) => (prev === node.id ? null : prev));
    },
    [],
  );

  const miniMapNodeColor = useCallback(
    (n: StructuredFlowNode) => {
      const data = n.data as
        | { node?: DesignNode; waitingOnHumanCount?: number }
        | undefined;
      if (data?.node?.status === "drifted") {
        return theme === "dark" ? "#f43f5e" : "#e11d48";
      }
      if (
        (data?.waitingOnHumanCount ?? 0) > 0 ||
        data?.node?.status === "needs_input"
      ) {
        return theme === "dark" ? "#f59e0b" : "#d97706";
      }
      if (data?.node?.locked) {
        return theme === "dark" ? "#a78bfa" : "#7c3aed";
      }
      return theme === "dark" ? "#38bdf8" : "#0284c7";
    },
    [theme],
  );

  const projectTitle = snapshot?.status.project_name;
  useEffect(() => {
    document.title = projectTitle
      ? `${projectTitle} — Redlinify`
      : "Redlinify";
  }, [projectTitle]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <TabBar
        projectName={snapshot?.status.project_name ?? "Redlinify"}
        projectRootDir={snapshot?.root_dir}
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
        onOpenSearch={openSearch}
        theme={theme}
        onToggleTheme={toggleTheme}
        bgPattern={bgPattern}
        onToggleBgPattern={toggleBgPattern}
      />

      <TriageBar
        filter={filter}
        onChangeFilter={handleSelectFilter}
        hasActiveView={Boolean(activeView)}
        onExport={(format) => void handleExportDiagram(format)}
        activeWorkspaceTab={
          drawerMode === "workspace" ? workspaceTab : null
        }
        openQuestionsCount={openQuestionsCount}
        pendingAgentCount={pendingAgentCount}
        decisionsCount={decisionsCount}
        onOpenQuestions={() => handleToggleWorkspaceTab("questions")}
        onOpenPendingReview={() => handleToggleWorkspaceTab("pending")}
        onOpenDecisions={() => handleToggleWorkspaceTab("adrs")}
        showOfflineWarning={!wsConnected && (wsEverConnected || wsGraceExpired)}
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

      {filter === "my_edits" && activeView && (
        <div
          data-testid="my-edits-banner"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-500/35 bg-sky-500/10 px-4 py-1.5 text-xs text-sky-100"
        >
          {viewDiff && viewDiff.has_changes ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-sky-300">
                  Unsynced edits:
                </span>
                <span>
                  {viewDiff.nodes_modified.length} modified ·{" "}
                  {viewDiff.nodes_added.length} added ·{" "}
                  {viewDiff.nodes_removed.length} removed ·{" "}
                  {viewDiff.edges_added.length +
                    viewDiff.edges_modified.length +
                    viewDiff.edges_removed.length}{" "}
                  edge changes
                </span>
                {viewBaseline &&
                  viewDiff.nodes_removed.map((rem) => (
                    <button
                      key={rem.id}
                      type="button"
                      onClick={() => void handleRevertNode(rem.id)}
                      className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/25"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Restore {rem.title}
                    </button>
                  ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    selectSingleNode(null);
                    setDrawerMode("workspace");
                    setWorkspaceTab("pending");
                  }}
                  className="rounded border border-slate-700 bg-slate-900/80 px-2 py-0.5 text-[11px] text-slate-200 hover:border-sky-500/60"
                >
                  Inspect Pending
                </button>
                {viewBaseline && (
                  <button
                    type="button"
                    onClick={() => void handleRevertViewToBaseline()}
                    className="inline-flex items-center gap-1 rounded bg-sky-500/20 border border-sky-500/50 px-2 py-0.5 text-[11px] font-semibold text-sky-200 hover:bg-sky-500/30"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Revert All Edits
                  </button>
                )}
              </div>
            </>
          ) : (
            <span className="text-slate-300">
              No unsynced edits in{" "}
              <strong className="text-slate-100">{activeView.title}</strong> —
              matches last agent checkpoint.
            </span>
          )}
        </div>
      )}

      <div className="relative flex flex-1 min-h-0">
        <div
          ref={canvasContainerRef}
          onMouseMove={(e) => {
            lastCursorRef.current = { x: e.clientX, y: e.clientY };
          }}
          onMouseLeave={() => {
            lastCursorRef.current = null;
          }}
          className="relative flex-1 min-w-0 min-h-0"
        >
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
              elevateEdgesOnSelect
              multiSelectionKeyCode={MULTI_SELECTION_KEY_CODE}
              selectionKeyCode="Shift"
              panActivationKeyCode="Space"
              zoomOnDoubleClick={false}
              zoomOnScroll={false}
              panOnScroll={false}
              nodeDragThreshold={3}
              onNodesChange={handleNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDragStart={handleDragStart}
              onNodeDragStop={handleNodeDragStop}
              onSelectionDragStart={handleDragStart}
              onSelectionDragStop={handleSelectionDragStop}
              onMoveStart={clearContextMenu}
              onMoveEnd={handleMoveEnd}
              onReconnect={handleReconnectCallback}
              onBeforeDelete={handleBeforeDelete}
              onConnectStart={clearContextMenu}
              onConnect={handleConnect}
              onNodeClick={handleNodeClick}
              onNodeMouseEnter={handleNodeMouseEnter}
              onNodeMouseLeave={handleNodeMouseLeave}
              onEdgeClick={handleEdgeClick}
              onPaneClick={handlePaneClick}
              onPaneContextMenu={handlePaneContextMenu}
              onNodeContextMenu={handleNodeContextMenu}
              onEdgeContextMenu={handleEdgeContextMenu}
              deleteKeyCode={DELETE_KEY_CODE}
              minZoom={VIEWPORT_MIN_ZOOM}
              maxZoom={VIEWPORT_MAX_ZOOM}
              proOptions={PRO_OPTIONS}
            >
              <Background
                variant={
                  bgPattern === "grid"
                    ? BackgroundVariant.Lines
                    : BackgroundVariant.Dots
                }
                gap={24}
                size={bgPattern === "grid" ? 1 : 1.8}
                color={
                  bgPattern === "grid"
                    ? theme === "dark"
                      ? "#1e293b"
                      : "#cbd5e1"
                    : theme === "dark"
                      ? "#334155"
                      : "#94a3b8"
                }
              />
              <Controls showInteractive={false} />
              <MiniMap
                className="hidden sm:block"
                nodeColor={miniMapNodeColor}
                maskColor={
                  theme === "dark"
                    ? "rgba(2, 6, 23, 0.75)"
                    : "rgba(241, 245, 249, 0.72)"
                }
              />
            </ReactFlow>
          )}

          {activeView && (
            <CanvasDock
              diagramType={activeView.diagram_type ?? "general"}
              direction={activeView.direction ?? "TB"}
              canUndo={canUndo}
              canRedo={canRedo}
              onAddBox={(shape) => void createBoxAtPosition(undefined, shape)}
              onUndo={() => void handleUndo()}
              onRedo={() => void handleRedo()}
              onToggleDirection={() => void handleToggleDirection()}
              onAutoLayout={() => void handleAutoLayout()}
            />
          )}

          {activeView && (
            <div
              role="group"
              aria-label="Scroll wheel behavior"
              className="nowheel absolute bottom-[15px] left-[52px] z-20 flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/95 p-1 pl-2 shadow-lg backdrop-blur-sm"
            >
              <span className="select-none text-[11px] font-medium text-slate-400">
                Scroll
              </span>
              <div className="flex items-center rounded-md bg-slate-950/70 p-0.5">
                <button
                  type="button"
                  onClick={() => setScrollMode("pan")}
                  aria-pressed={scrollMode === "pan"}
                  title="Scroll or 2-finger swipe pans; pinch or Ctrl/Cmd+scroll zooms"
                  className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    scrollMode === "pan"
                      ? "bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Pan
                </button>
                <button
                  type="button"
                  onClick={() => setScrollMode("zoom")}
                  aria-pressed={scrollMode === "zoom"}
                  title="Scroll zooms at cursor; drag, Space+drag, or arrows pan"
                  className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    scrollMode === "zoom"
                      ? "bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Zoom
                </button>
              </div>
            </div>
          )}

          {selectedNodeIds.length > 1 && (
            <div className="pointer-events-none absolute bottom-14 left-[52px] z-30 rounded-lg border border-sky-500/40 bg-slate-900/90 px-3 py-1.5 text-[11px] text-sky-200 shadow-lg backdrop-blur-sm">
              {selectedNodeIds.length} boxes selected — drag together or press Delete
            </div>
          )}

          {toast && (
            <div
              className={`pointer-events-none fixed bottom-16 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-3.5 py-2 text-xs font-medium shadow-xl ${
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
          viewBaseline={viewBaseline}
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
          onRevertNode={handleRevertNode}
          onRevertView={handleRevertViewToBaseline}
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
          onFlipEdge={(edgeId) => void handleFlipEdge(edgeId)}
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
          onClose={clearContextMenu}
        />
      )}

      <CommandSearchModal
        open={searchOpen}
        loading={searchLoading}
        items={searchIndexItems}
        onClose={() => setSearchOpen(false)}
        onSelect={handleSelectSearchItem}
      />

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
