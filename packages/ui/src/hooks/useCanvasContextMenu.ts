import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type {
  DesignNode,
  DesignView,
  EdgeRoute,
  HandleSide,
  NodeShape,
  SemanticDiff,
} from "@redlinify/shared/browser";
import { NODE_SHAPE_OPTIONS } from "../layout/elk";
import type { ContextMenuItem } from "../components/ContextMenu";
import type { StepFlowEdge } from "../components/StepEdge";
import type { StructuredFlowNode } from "../components/StructuredNode";
import type { TriageFilter } from "../components/TriageBar";
import type {
  DrawerMode,
  ElementDrawerTab,
} from "../components/inspector/types";
import { insertWaypointAlongEdge, type Point } from "../layout/routing";
import type { HistoryEntry } from "./useViewHistory";

export type ContextMenuState =
  | { kind: "pane"; x: number; y: number; flowPos: Point }
  | { kind: "node"; x: number; y: number; nodeId: string }
  | { kind: "edge"; x: number; y: number; edgeId: string; flowPos: Point };

interface RefBox<T> {
  current: T;
}

interface UseCanvasContextMenuOptions {
  activeView: DesignView | null;
  filter: TriageFilter;
  viewDiff: SemanticDiff | null;
  viewBaseline: DesignView | null;
  editedNodeIds: Set<string>;
  editedEdgeIds: Set<string>;
  positionsRef: RefBox<Record<string, Point>>;
  edgeRoutesRef: RefBox<Record<string, EdgeRoute>>;
  undoMapRef: RefBox<Map<string, HistoryEntry[]>>;
  redoMapRef: RefBox<Map<string, HistoryEntry[]>>;
  historyTick: number;
  rfNodes: StructuredFlowNode[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  setSelectedEdgeId: (id: string | null) => void;
  setDrawerMode: (mode: DrawerMode) => void;
  setElementTab: (tab: ElementDrawerTab) => void;
  setLayoutVersion: (updater: (v: number) => number) => void;
  screenToFlowPosition: (pos: Point) => Point;
  selectSingleNode: (nodeId: string | null) => void;
  selectSingleEdge: (edgeId: string | null) => void;
  createBoxAtPosition: (flowPos?: Point, shape?: NodeShape) => Promise<void>;
  handleChangeNodeShape: (nodeId: string, shape: NodeShape) => Promise<void>;
  handleAutoLayout: () => Promise<void>;
  handleToggleDirection: () => Promise<void>;
  handleUndo: () => Promise<void>;
  handleRedo: () => Promise<void>;
  handleRevertNode: (nodeId: string) => Promise<void>;
  handleRevertEdge: (edgeId: string) => Promise<void>;
  handleRevertViewToBaseline: () => Promise<void>;
  handleUnlockAllInView: () => Promise<void>;
  handleUpdateNodeStatus: (
    nodeId: string,
    status: DesignNode["status"],
  ) => Promise<void>;
  handleToggleLock: (nodeId: string) => void;
  handleInlineAddItem: (
    nodeId: string,
    sectionId: string,
    item: string,
  ) => void;
  handleInlineAddField: (nodeId: string, name: string) => void;
  handleOpenNodeThreads: (nodeId: string) => void;
  handleCommitWaypoints: (
    edgeId: string,
    waypoints: Point[],
    handles?: { source_handle: HandleSide; target_handle: HandleSide },
  ) => void;
  handleUpdateEdgeRoute: (edgeId: string, patch: Partial<EdgeRoute> | null) => void;
  handleFlipEdge: (edgeId: string) => Promise<void>;
  persistCurrentLayout: (viewId: string) => Promise<void>;
  persistView: (
    nextView: DesignView,
    options?: { recordHistory?: boolean },
  ) => Promise<void>;
  showToast: (message: string, tone?: "info" | "warning" | "error") => void;
}

export function useCanvasContextMenu({
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
}: UseCanvasContextMenuOptions) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const rightDownPosRef = useRef<Point | null>(null);

  const clearContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const wasRightClickDrag = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const start = rightDownPosRef.current;
      rightDownPosRef.current = null;
      if (!start) return false;
      return Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6;
    },
    [],
  );

  useEffect(() => {
    const onCaptureMouseDown = (e: MouseEvent) => {
      if (e.button === 2) {
        rightDownPosRef.current = { x: e.clientX, y: e.clientY };
      } else {
        rightDownPosRef.current = null;
      }
    };
    window.addEventListener("mousedown", onCaptureMouseDown, true);
    return () => {
      window.removeEventListener("mousedown", onCaptureMouseDown, true);
    };
  }, []);

  const handlePaneContextMenu = useCallback(
    (e: MouseEvent | ReactMouseEvent) => {
      e.preventDefault();
      if (wasRightClickDrag(e)) {
        setContextMenu(null);
        return;
      }
      setContextMenu({
        kind: "pane",
        x: e.clientX,
        y: e.clientY,
        flowPos: screenToFlowPosition({
          x: e.clientX,
          y: e.clientY,
        }),
      });
    },
    [screenToFlowPosition, wasRightClickDrag],
  );

  const handleNodeContextMenu = useCallback(
    (e: ReactMouseEvent, node: StructuredFlowNode) => {
      e.preventDefault();
      if (wasRightClickDrag(e)) {
        setContextMenu(null);
        return;
      }
      selectSingleNode(node.id);
      setContextMenu({
        kind: "node",
        x: e.clientX,
        y: e.clientY,
        nodeId: node.id,
      });
    },
    [selectSingleNode, wasRightClickDrag],
  );

  const handleEdgeContextMenu = useCallback(
    (e: ReactMouseEvent, edge: StepFlowEdge) => {
      e.preventDefault();
      if (wasRightClickDrag(e)) {
        setContextMenu(null);
        return;
      }
      selectSingleEdge(edge.id);
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
    },
    [screenToFlowPosition, selectSingleEdge, wasRightClickDrag],
  );

  const contextMenuData = useMemo((): {
    header?: string;
    items: ContextMenuItem[];
  } | null => {
    void historyTick;
    if (!contextMenu || !activeView) return null;
    const isEr = activeView.diagram_type === "er";
    const undoStack = undoMapRef.current.get(activeView.id) ?? [];
    const redoStack = redoMapRef.current.get(activeView.id) ?? [];

    if (contextMenu.kind === "pane") {
      const removedNodes = viewDiff?.nodes_removed ?? [];
      const hasLockedInView =
        activeView.nodes.some((n) => n.locked) ||
        activeView.edges.some((e) => e.locked);
      const revertPaneItems: ContextMenuItem[] = [];
      if (removedNodes.length > 0 && viewBaseline) {
        revertPaneItems.push({
          id: "restore_removed_nodes",
          label: isEr ? "Restore Removed Entity…" : "Restore Removed Box…",
          dividerBefore: true,
          children: removedNodes.map((rem) => ({
            id: `restore_removed_${rem.id}`,
            label: rem.title,
            onSelect: () => void handleRevertNode(rem.id),
          })),
        });
      }
      if (viewDiff?.has_changes && viewBaseline) {
        revertPaneItems.push({
          id: "revert_view_baseline",
          label: "Revert All Unsynced Edits",
          danger: true,
          dividerBefore: revertPaneItems.length === 0,
          onSelect: () => void handleRevertViewToBaseline(),
        });
      }
      if (filter === "locked" && hasLockedInView) {
        revertPaneItems.push({
          id: "unlock_all_view",
          label: "Unlock All in View",
          dividerBefore: revertPaneItems.length === 0,
          onSelect: () => void handleUnlockAllInView(),
        });
      }

      return {
        header: activeView.title,
        items: [
          {
            id: "add_box",
            label: isEr ? "Add Entity Here" : "Add Box Here",
            shortcut: "N",
            onSelect: () => void createBoxAtPosition(contextMenu.flowPos),
          },
          ...(isEr
            ? []
            : [
                {
                  id: "add_shape",
                  label: "Add Shape…",
                  children: NODE_SHAPE_OPTIONS.map((opt) => ({
                    id: `add_shape_${opt.shape}`,
                    label: opt.label,
                    onSelect: () =>
                      void createBoxAtPosition(contextMenu.flowPos, opt.shape),
                  })),
                },
              ]),
          {
            id: "auto_layout",
            label: "Auto-Layout & Reset Routes",
            shortcut: "R",
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
          ...revertPaneItems,
        ],
      };
    }

    if (contextMenu.kind === "node") {
      const node = activeView.nodes.find((n) => n.id === contextMenu.nodeId);
      if (!node) return null;

      const makeAddEntryItem = (sec: {
        id: string;
        heading: string;
      }): ContextMenuItem => ({
        id: `add_entry_${sec.id}`,
        label: sec.heading,
        disabled: node.locked,
        onSelect: () => handleInlineAddItem(node.id, sec.id, "new_item"),
      });

      const addEntryMenuItems: ContextMenuItem[] = (() => {
        if (isEr) {
          return [
            {
              id: "add_entry",
              label: "Add Attribute",
              disabled: node.locked,
              onSelect: () => {
                const name = `col_${(node.fields?.length ?? 0) + 1}`;
                handleInlineAddField(node.id, name);
              },
            },
          ];
        }
        if (node.sections.length === 0) {
          return [
            {
              id: "add_entry",
              label: "Add Entry to Details",
              disabled: node.locked,
              onSelect: () => {
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
              },
            },
          ];
        }
        if (node.sections.length === 1) {
          return [
            {
              id: "add_entry",
              label: `Add Entry to ${node.sections[0]!.heading}`,
              disabled: node.locked,
              onSelect: () =>
                handleInlineAddItem(node.id, node.sections[0]!.id, "new_item"),
            },
          ];
        }
        return [
          {
            id: "add_entry",
            label: "Add Entry to…",
            disabled: node.locked,
            children: node.sections.map(makeAddEntryItem),
          },
        ];
      })();

      const isHumanEdited = editedNodeIds.has(node.id);
      const isAddedInSession = Boolean(
        viewDiff?.nodes_added.some((n) => n.id === node.id),
      );
      const hasBaselineNode = Boolean(
        viewBaseline?.nodes.some((n) => n.id === node.id),
      );
      const canRevertNode =
        isHumanEdited && (isAddedInSession || hasBaselineNode);

      const revertNodeItem: ContextMenuItem | null = canRevertNode
        ? {
            id: "revert_to_unmodified",
            label: isAddedInSession
              ? isEr
                ? "Discard Added Entity"
                : "Discard Added Box"
              : isEr
                ? "Revert Entity to Unmodified"
                : "Revert Box to Unmodified",
            danger: isAddedInSession,
            onSelect: () => void handleRevertNode(node.id),
          }
        : null;

      const triageLeadingItems: ContextMenuItem[] = [];
      if (filter === "my_edits" && revertNodeItem) {
        triageLeadingItems.push(revertNodeItem);
      } else if (filter === "waiting_on_me") {
        triageLeadingItems.push({
          id: "answer_open_question",
          label: "Answer Open Question",
          onSelect: () => handleOpenNodeThreads(node.id),
        });
      } else if (filter === "drifted" || node.status === "drifted") {
        triageLeadingItems.push(
          {
            id: "mark_implemented",
            label: "Mark as Implemented",
            disabled: node.status === "implemented",
            onSelect: () =>
              void handleUpdateNodeStatus(node.id, "implemented"),
          },
          {
            id: "mark_approved",
            label: "Mark as Approved",
            disabled: node.status === "approved",
            onSelect: () => void handleUpdateNodeStatus(node.id, "approved"),
          },
        );
      }

      const items: ContextMenuItem[] = [
        ...triageLeadingItems.map((item, idx) =>
          idx === 0 ? item : item,
        ),
        ...(triageLeadingItems.length > 0 && addEntryMenuItems.length > 0
          ? addEntryMenuItems.map((item, idx) =>
              idx === 0 ? { ...item, dividerBefore: true } : item,
            )
          : addEntryMenuItems),
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
        ...(isEr
          ? []
          : [
              {
                id: "change_shape",
                label: "Change Shape…",
                disabled: node.locked,
                children: NODE_SHAPE_OPTIONS.map((opt) => {
                  const isCurrent = (node.shape ?? "card") === opt.shape;
                  return {
                    id: `change_shape_${opt.shape}`,
                    label: opt.label,
                    disabled: node.locked || isCurrent,
                    onSelect: () =>
                      void handleChangeNodeShape(node.id, opt.shape),
                  };
                }),
              },
            ]),
        {
          id: "spec",
          label: "Edit in Spec Drawer",
          onSelect: () => {
            selectSingleNode(node.id);
            setDrawerMode("node");
            setElementTab("spec");
          },
        },
        {
          id: "threads",
          label: "Open Threads",
          onSelect: () => handleOpenNodeThreads(node.id),
        },
        ...(filter !== "my_edits" && revertNodeItem
          ? [{ ...revertNodeItem, dividerBefore: true }]
          : []),
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
    const isEdgeEdited = editedEdgeIds.has(edge.id);
    const isEdgeAdded = Boolean(
      viewDiff?.edges_added.some((e) => e.id === edge.id),
    );
    const canRevertEdge =
      isEdgeEdited &&
      (isEdgeAdded || Boolean(viewBaseline?.edges.some((e) => e.id === edge.id)));
    const revertEdgeItem: ContextMenuItem | null = canRevertEdge
      ? {
          id: "revert_edge_to_unmodified",
          label: isEdgeAdded ? "Discard Added Edge" : "Revert Edge to Unmodified",
          danger: isEdgeAdded,
          onSelect: () => void handleRevertEdge(edge.id),
        }
      : null;

    const edgeItems: ContextMenuItem[] = [
      ...(filter === "my_edits" && revertEdgeItem ? [revertEdgeItem] : []),
      {
        id: "add_bend",
        label: "Add Bend Point Here",
        dividerBefore: filter === "my_edits" && Boolean(revertEdgeItem),
        onSelect: () => {
          const measuredMap: Record<
            string,
            { width?: number; height?: number }
          > = {};
          for (const n of rfNodes) {
            const w = n.measured?.width ?? n.width;
            const h = n.measured?.height ?? n.height;
            if (w !== undefined || h !== undefined) {
              measuredMap[n.id] = { width: w, height: h };
            }
          }
          const inserted = insertWaypointAlongEdge(
            activeView,
            positionsRef.current,
            edgeRoutesRef.current,
            edge.id,
            contextMenu.flowPos,
            measuredMap,
          );
          handleCommitWaypoints(edge.id, inserted.waypoints, inserted.handles);
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
          void handleFlipEdge(edge.id);
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
      ...(filter !== "my_edits" && revertEdgeItem
        ? [{ ...revertEdgeItem, dividerBefore: true }]
        : []),
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
    edgeRoutesRef,
    editedEdgeIds,
    editedNodeIds,
    filter,
    handleAutoLayout,
    handleChangeNodeShape,
    handleCommitWaypoints,
    handleFlipEdge,
    handleInlineAddField,
    handleInlineAddItem,
    handleOpenNodeThreads,
    handleRedo,
    handleRevertEdge,
    handleRevertNode,
    handleRevertViewToBaseline,
    handleToggleDirection,
    handleToggleLock,
    handleUndo,
    handleUnlockAllInView,
    handleUpdateEdgeRoute,
    handleUpdateNodeStatus,
    historyTick,
    persistCurrentLayout,
    persistView,
    positionsRef,
    redoMapRef,
    rfNodes,
    selectSingleNode,
    selectedEdgeId,
    selectedNodeId,
    setDrawerMode,
    setElementTab,
    setLayoutVersion,
    setSelectedEdgeId,
    setSelectedNodeId,
    showToast,
    undoMapRef,
    viewBaseline,
    viewDiff,
  ]);

  return {
    contextMenu,
    contextMenuData,
    clearContextMenu,
    handlePaneContextMenu,
    handleNodeContextMenu,
    handleEdgeContextMenu,
  };
}
