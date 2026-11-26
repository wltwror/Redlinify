import { useCallback, useRef } from "react";
import type {
  Connection,
  Edge,
  NodeChange,
  Viewport,
} from "@xyflow/react";
import type {
  Cardinality,
  DesignEdge,
  DesignNode,
  DesignView,
  EdgeRoute,
  EntityField,
  HandleSide,
  NodeShape,
  RelationKind,
  ViewDirection,
} from "@redlinify/shared/browser";
import { clearLayout, saveLayout } from "../api/client";
import type { StepFlowEdge } from "../components/StepEdge";
import type { StructuredFlowNode } from "../components/StructuredNode";
import type {
  DrawerMode,
  ElementDrawerTab,
} from "../components/inspector/types";
import type { Point } from "../layout/routing";
import { isEditableFocus } from "./useCanvasShortcuts";
import type { HistoryEntry } from "./useViewHistory";

interface RefBox<T> {
  current: T;
}

interface UseCanvasInteractionsOptions {
  activeView: DesignView | null;
  activeViewIdRef: RefBox<string | null>;
  activeViewRef: RefBox<DesignView | null>;
  positionsRef: RefBox<Record<string, Point>>;
  edgeRoutesRef: RefBox<Record<string, EdgeRoute>>;
  viewportReadyRef: RefBox<boolean>;
  pendingSelectNodeIdRef: RefBox<string | null>;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  setSelectedEdgeId: (id: string | null) => void;
  setDrawerMode: (mode: DrawerMode) => void;
  setElementTab: (tab: ElementDrawerTab) => void;
  pendingConn: Connection | null;
  setPendingConn: (conn: Connection | null) => void;
  setLayoutVersion: (updater: (v: number) => number) => void;
  setRoutingTick: (updater: (t: number) => number) => void;
  onNodesChange: (changes: NodeChange<StructuredFlowNode>[]) => void;
  screenToFlowPosition: (pos: Point) => Point;
  pushHistoryEntry: (viewId: string, customEntry?: HistoryEntry) => void;
  persistCurrentLayout: (viewId: string) => Promise<void>;
  persistView: (
    nextView: DesignView,
    options?: { recordHistory?: boolean },
  ) => Promise<void>;
  loadViewDetail: (
    viewId: string,
    options?: { preserveViewport?: boolean; forceResetLayout?: boolean },
  ) => Promise<DesignView>;
  selectSingleNode: (nodeId: string | null) => void;
  showToast: (message: string, tone?: "info" | "warning" | "error") => void;
}

export function useCanvasInteractions({
  activeView,
  activeViewIdRef,
  activeViewRef,
  positionsRef,
  edgeRoutesRef,
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
}: UseCanvasInteractionsOptions) {
  const dragOriginRef = useRef<{
    nodePositions: Record<string, Point>;
    edgeRoutes: Record<string, EdgeRoute>;
  } | null>(null);

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
    [activeViewRef, persistView],
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
    [activeViewRef, persistView],
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
    [activeViewRef, persistView],
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
    [activeViewRef, persistView],
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
    [activeViewRef, persistView],
  );

  const handleInlineUpdateFieldName = useCallback(
    (nodeId: string, fieldId: string, nextName: string) => {
      const curr = activeViewRef.current;
      if (!curr) return;
      const trimmed = nextName.trim();
      const targetNode = curr.nodes.find((n) => n.id === nodeId);
      const targetField = targetNode?.fields?.find((f) => f.id === fieldId);
      if (!targetField) return;
      if (trimmed === targetField.name) return;

      void persistView({
        ...curr,
        nodes: curr.nodes.map((n) => {
          if (n.id !== nodeId) return n;
          const prevFields = n.fields ?? [];
          return {
            ...n,
            fields: !trimmed
              ? prevFields.filter((f) => f.id !== fieldId)
              : prevFields.map((f) =>
                  f.id === fieldId ? { ...f, name: trimmed } : f,
                ),
          };
        }),
      });
    },
    [activeViewRef, persistView],
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
    [activeViewRef, persistView],
  );

  const handleOpenNodeThreads = useCallback(
    (nodeId: string) => {
      selectSingleNode(nodeId);
      setDrawerMode("node");
      setElementTab("threads");
    },
    [selectSingleNode, setDrawerMode, setElementTab],
  );

  const handleCommitWaypoints = useCallback(
    (
      edgeId: string,
      waypoints: Point[],
      handles?: { source_handle: HandleSide; target_handle: HandleSide },
    ) => {
      const viewId = activeViewIdRef.current;
      if (!viewId) return;
      pushHistoryEntry(viewId);
      const currentRoute = edgeRoutesRef.current[edgeId] ?? {};
      if (waypoints.length === 0) {
        const nextRoute = { ...currentRoute };
        delete nextRoute.waypoints;
        if (Object.keys(nextRoute).length === 0) {
          const next = { ...edgeRoutesRef.current };
          delete next[edgeId];
          edgeRoutesRef.current = next;
        } else {
          edgeRoutesRef.current = {
            ...edgeRoutesRef.current,
            [edgeId]: nextRoute,
          };
        }
      } else {
        edgeRoutesRef.current = {
          ...edgeRoutesRef.current,
          [edgeId]: {
            ...currentRoute,
            ...(handles && !currentRoute.source_handle
              ? { source_handle: handles.source_handle }
              : {}),
            ...(handles && !currentRoute.target_handle
              ? { target_handle: handles.target_handle }
              : {}),
            waypoints,
          },
        };
      }
      setRoutingTick((t) => t + 1);
      void persistCurrentLayout(viewId);
    },
    [
      activeViewIdRef,
      edgeRoutesRef,
      persistCurrentLayout,
      pushHistoryEntry,
      setRoutingTick,
    ],
  );

  const handleUpdateEdgeRoute = useCallback(
    (edgeId: string, patch: Partial<EdgeRoute> | null) => {
      const viewId = activeViewIdRef.current;
      if (!viewId) return;
      pushHistoryEntry(viewId);
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
    [
      activeViewIdRef,
      edgeRoutesRef,
      persistCurrentLayout,
      pushHistoryEntry,
      setRoutingTick,
    ],
  );

  const handleChangeNodeShape = useCallback(
    async (nodeId: string, nextShape: NodeShape) => {
      const curr = activeViewRef.current;
      if (!curr || curr.diagram_type === "er") return;
      const target = curr.nodes.find((n) => n.id === nodeId);
      if (!target) return;
      if (target.locked) {
        showToast("Locked node cannot change shape", "warning");
        return;
      }
      if ((target.shape ?? "card") === nextShape) return;

      await persistView({
        ...curr,
        nodes: curr.nodes.map((n) => {
          if (n.id !== nodeId) return n;
          if (nextShape === "card") {
            const copy = { ...n };
            delete copy.shape;
            return copy;
          }
          return { ...n, shape: nextShape };
        }),
      });
    },
    [activeViewRef, persistView, showToast],
  );

  const createBoxAtPosition = useCallback(
    async (flowPos?: Point, shape: NodeShape = "card") => {
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
        : shape === "decision"
          ? {
              id,
              kind: "Decision",
              shape: "decision",
              title: "Decision?",
              status: "draft",
              locked: false,
              sections: [],
            }
          : shape === "terminal"
            ? {
                id,
                kind: "Terminal",
                shape: "terminal",
                title: "Start / End",
                status: "draft",
                locked: false,
                sections: [],
              }
            : shape === "store"
              ? {
                  id,
                  kind: "Store",
                  shape: "store",
                  title: "Data Store",
                  status: "draft",
                  locked: false,
                  sections: [
                    {
                      id: "schema",
                      heading: "Schema / Keys",
                      items: ["define data"],
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
      pendingSelectNodeIdRef.current = id;
      await persistCurrentLayout(activeView.id);
      await persistView(nextView);
      setLayoutVersion((v) => v + 1);
      selectSingleNode(id);
      setDrawerMode("node");
      setElementTab("spec");
    },
    [
      activeView,
      pendingSelectNodeIdRef,
      persistCurrentLayout,
      persistView,
      positionsRef,
      screenToFlowPosition,
      selectSingleNode,
      setDrawerMode,
      setElementTab,
      setLayoutVersion,
    ],
  );

  const handleAutoLayout = useCallback(async () => {
    if (!activeView) return;
    pushHistoryEntry(activeView.id);
    await clearLayout(activeView.id);
    await loadViewDetail(activeView.id, { forceResetLayout: true });
    showToast("Auto-layout and smart edge routes reset");
  }, [activeView, loadViewDetail, pushHistoryEntry, showToast]);

  const handleToggleDirection = useCallback(async () => {
    if (!activeView) return;
    const nextDir: ViewDirection = activeView.direction === "TB" ? "LR" : "TB";
    const nextView: DesignView = { ...activeView, direction: nextDir };
    await persistView(nextView);
    await clearLayout(activeView.id);
    await loadViewDetail(activeView.id, { forceResetLayout: true });
  }, [activeView, loadViewDetail, persistView]);

  const snapshotDragOrigin = useCallback(() => {
    dragOriginRef.current = {
      nodePositions: structuredClone(positionsRef.current),
      edgeRoutes: structuredClone(edgeRoutesRef.current),
    };
  }, [edgeRoutesRef, positionsRef]);

  const applyAutoMoveWaypoints = useCallback(() => {
    const origin = dragOriginRef.current;
    const view = activeViewRef.current;
    if (!origin || !view) return;

    for (const edge of view.edges) {
      const origRoute = origin.edgeRoutes[edge.id];
      const origWps = origRoute?.waypoints;
      if (!origWps || origWps.length === 0) continue;

      const srcOrig = origin.nodePositions[edge.source];
      const srcCurr = positionsRef.current[edge.source];
      const tgtOrig = origin.nodePositions[edge.target];
      const tgtCurr = positionsRef.current[edge.target];
      if (!srcOrig || !srcCurr || !tgtOrig || !tgtCurr) continue;

      const srcDx = srcCurr.x - srcOrig.x;
      const srcDy = srcCurr.y - srcOrig.y;
      const tgtDx = tgtCurr.x - tgtOrig.x;
      const tgtDy = tgtCurr.y - tgtOrig.y;

      const srcMoved = Math.abs(srcDx) > 0 || Math.abs(srcDy) > 0;
      const tgtMoved = Math.abs(tgtDx) > 0 || Math.abs(tgtDy) > 0;
      if (!srcMoved && !tgtMoved) continue;

      const m = origWps.length;
      const nextWps = origWps.map((pt, i) => {
        if (srcMoved && tgtMoved) {
          return {
            x: Math.round(pt.x + (srcDx + tgtDx) / 2),
            y: Math.round(pt.y + (srcDy + tgtDy) / 2),
          };
        }
        const weight = srcMoved ? (m - i) / (m + 1) : (i + 1) / (m + 1);
        const dx = srcMoved ? srcDx : tgtDx;
        const dy = srcMoved ? srcDy : tgtDy;
        return {
          x: Math.round(pt.x + dx * weight),
          y: Math.round(pt.y + dy * weight),
        };
      });

      edgeRoutesRef.current = {
        ...edgeRoutesRef.current,
        [edge.id]: {
          ...(edgeRoutesRef.current[edge.id] ?? origRoute),
          waypoints: nextWps,
        },
      };
    }
  }, [activeViewRef, edgeRoutesRef, positionsRef]);

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
        applyAutoMoveWaypoints();
        setRoutingTick((t) => t + 1);
      }
    },
    [applyAutoMoveWaypoints, onNodesChange, positionsRef, setRoutingTick],
  );

  const finalizeDraggedNodes = useCallback(
    (draggedNodes: StructuredFlowNode[]) => {
      if (!activeView) return;
      const nextPos = { ...positionsRef.current };
      for (const n of draggedNodes) {
        nextPos[n.id] = {
          x: Math.round(n.position.x),
          y: Math.round(n.position.y),
        };
      }
      const origin = dragOriginRef.current;
      if (origin) {
        const anyMoved = draggedNodes.some((n) => {
          const prev = origin.nodePositions[n.id];
          return (
            !prev ||
            Math.round(prev.x) !== nextPos[n.id]!.x ||
            Math.round(prev.y) !== nextPos[n.id]!.y
          );
        });
        if (anyMoved) {
          pushHistoryEntry(activeView.id, {
            view: structuredClone(activeView),
            positions: structuredClone(origin.nodePositions),
            edgeRoutes: structuredClone(origin.edgeRoutes),
          });
        }
      }
      positionsRef.current = nextPos;
      applyAutoMoveWaypoints();
      dragOriginRef.current = null;
      setRoutingTick((t) => t + 1);
      void persistCurrentLayout(activeView.id);
    },
    [
      activeView,
      applyAutoMoveWaypoints,
      persistCurrentLayout,
      positionsRef,
      pushHistoryEntry,
      setRoutingTick,
    ],
  );

  const handleNodeDragStop = useCallback(
    (
      _event: unknown,
      draggedNode: StructuredFlowNode,
      allDragged?: StructuredFlowNode[],
    ) => {
      finalizeDraggedNodes(
        allDragged && allDragged.length > 0 ? allDragged : [draggedNode],
      );
    },
    [finalizeDraggedNodes],
  );

  const handleSelectionDragStop = useCallback(
    (_evt: unknown, nodes: StructuredFlowNode[]) => {
      finalizeDraggedNodes(nodes);
    },
    [finalizeDraggedNodes],
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
    [activeView, edgeRoutesRef, positionsRef, viewportReadyRef],
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

      pushHistoryEntry(activeView.id);
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
        await persistView(
          {
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
          },
          { recordHistory: false },
        );
      }
    },
    [
      activeView,
      edgeRoutesRef,
      persistCurrentLayout,
      persistView,
      pushHistoryEntry,
      setRoutingTick,
      showToast,
    ],
  );

  const handleReconnectCallback = useCallback(
    (oldEdge: Edge, newConn: Connection) => {
      void handleReconnect(oldEdge, newConn);
    },
    [handleReconnect],
  );

  const handleFlipEdge = useCallback(
    async (edgeId: string) => {
      const view = activeViewRef.current;
      if (!view) return;
      const existing = view.edges.find((e) => e.id === edgeId);
      if (!existing) return;
      if (existing.locked) {
        showToast("Unlock edge before flipping direction.", "warning");
        return;
      }

      pushHistoryEntry(view.id);

      const prevRoute = edgeRoutesRef.current[edgeId];
      if (prevRoute) {
        const swappedRoute: EdgeRoute = {};
        if (prevRoute.target_handle) {
          swappedRoute.source_handle = prevRoute.target_handle;
        }
        if (prevRoute.source_handle) {
          swappedRoute.target_handle = prevRoute.source_handle;
        }
        if (prevRoute.waypoints && prevRoute.waypoints.length > 0) {
          swappedRoute.waypoints = [...prevRoute.waypoints].reverse();
        }
        if (Object.keys(swappedRoute).length > 0) {
          edgeRoutesRef.current = {
            ...edgeRoutesRef.current,
            [edgeId]: swappedRoute,
          };
          setRoutingTick((t) => t + 1);
          await persistCurrentLayout(view.id);
        }
      }

      await persistView(
        {
          ...view,
          edges: view.edges.map((e) =>
            e.id === edgeId
              ? {
                  ...e,
                  source: e.target,
                  target: e.source,
                }
              : e,
          ),
        },
        { recordHistory: false },
      );
    },
    [
      activeViewRef,
      edgeRoutesRef,
      persistCurrentLayout,
      persistView,
      pushHistoryEntry,
      setRoutingTick,
      showToast,
    ],
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
    [
      activeView,
      persistView,
      selectedEdgeId,
      selectedNodeId,
      setDrawerMode,
      setSelectedEdgeId,
      setSelectedNodeId,
      showToast,
    ],
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
    [
      activeView,
      edgeRoutesRef,
      pendingConn,
      persistCurrentLayout,
      persistView,
      setPendingConn,
    ],
  );

  const handleConnect = useCallback(
    (conn: Connection) => {
      if (conn.source && conn.target) {
        setPendingConn(conn);
      }
    },
    [setPendingConn],
  );

  return {
    handleToggleLock,
    handleChangeNodeShape,
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
  };
}
