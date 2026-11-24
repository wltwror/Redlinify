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
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Layers } from "lucide-react";
import {
  isThreadWaitingOnHuman,
  type DesignEdge,
  type DesignNode,
  type DesignThread,
  type DesignView,
  type SemanticDiff,
  type ThreadKind,
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

function getModifiedNodeIds(diff: SemanticDiff | null): Set<string> {
  const set = new Set<string>();
  if (!diff) return set;
  for (const n of diff.nodes_added) set.add(n.id);
  for (const n of diff.nodes_modified) set.add(n.id);
  return set;
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
  const [wsConnected, setWsConnected] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [conflictBanner, setConflictBanner] = useState(false);

  const positionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const viewportReadyRef = useRef(false);
  const activeViewIdRef = useRef<string | null>(null);
  const viewHashRef = useRef<string | undefined>(undefined);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  activeViewIdRef.current = activeViewId;
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
      setActiveView(detail.view);
      setViewHash(detail.view_hash);
      setViewDiff(detail.diff);
      setConflictBanner(false);

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
    async (nextView: DesignView) => {
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

  // Node action callbacks
  const handleToggleLock = useCallback(
    (nodeId: string) => {
      if (!activeView) return;
      const next: DesignView = {
        ...activeView,
        nodes: activeView.nodes.map((n) =>
          n.id === nodeId ? { ...n, locked: !n.locked } : n,
        ),
      };
      void persistView(next);
    },
    [activeView, persistView],
  );

  const handleInlineUpdateTitle = useCallback(
    (nodeId: string, nextTitle: string) => {
      if (!activeView) return;
      const next: DesignView = {
        ...activeView,
        nodes: activeView.nodes.map((n) =>
          n.id === nodeId ? { ...n, title: nextTitle } : n,
        ),
      };
      void persistView(next);
    },
    [activeView, persistView],
  );

  const handleInlineUpdateItem = useCallback(
    (
      nodeId: string,
      sectionId: string,
      itemIndex: number,
      nextValue: string,
    ) => {
      if (!activeView) return;
      const next: DesignView = {
        ...activeView,
        nodes: activeView.nodes.map((n) => {
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
      };
      void persistView(next);
    },
    [activeView, persistView],
  );

  const handleOpenNodeThreads = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setDrawerMode("node");
    setElementTab("threads");
  }, []);

  // Sync DesignView -> React Flow nodes & edges
  const editedNodeIds = useMemo(() => getModifiedNodeIds(viewDiff), [viewDiff]);

  useEffect(() => {
    if (!activeView) {
      setRfNodes([]);
      setRfEdges([]);
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
          direction: activeView.direction,
          isHumanEdited: isEdited,
          waitingOnHumanCount,
          totalOpenThreads: nodeThreads.length,
          dimmed: !matchesFilter,
          pulsing: pulsingNodeId === node.id,
          onToggleLock: handleToggleLock,
          onInlineUpdateTitle: handleInlineUpdateTitle,
          onInlineUpdateItem: handleInlineUpdateItem,
          onOpenNodeThreads: handleOpenNodeThreads,
        },
      };
    });

    const nodeDimMap = new Map(nextNodes.map((n) => [n.id, n.data.dimmed]));
    const nextEdges: StepFlowEdge[] = activeView.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "step",
      selected: selectedEdgeId === edge.id,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: selectedEdgeId === edge.id ? "#38bdf8" : "#64748b",
      },
      data: {
        edge,
        dimmed: Boolean(nodeDimMap.get(edge.source) && nodeDimMap.get(edge.target)),
      },
    }));

    setRfNodes(nextNodes);
    setRfEdges(nextEdges);
  }, [
    activeView,
    allThreads,
    editedNodeIds,
    filter,
    handleInlineUpdateItem,
    handleInlineUpdateTitle,
    handleOpenNodeThreads,
    handleToggleLock,
    pulsingNodeId,
    selectedEdgeId,
    selectedNodeId,
    setRfEdges,
    setRfNodes,
  ]);

  const handleSelectView = useCallback(
    async (viewId: string) => {
      setActiveViewId(viewId);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
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
        setElementTab(preferredTab === "links" ? "spec" : (preferredTab ?? "threads"));
      } else {
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setDrawerMode("workspace");
        setWorkspaceTab("adrs");
      }
    },
    [loadViewDetail, setCenter],
  );

  const handleAddBox = useCallback(async () => {
    if (!activeView) return;
    const suffix = Date.now().toString(36).slice(-4);
    const id = `box_${suffix}`;
    const center = screenToFlowPosition({
      x: window.innerWidth * 0.42,
      y: window.innerHeight * 0.48,
    });
    const newPos = {
      x: Math.round(center.x - 140),
      y: Math.round(center.y - 60),
    };
    positionsRef.current = { ...positionsRef.current, [id]: newPos };

    const newNode: DesignNode = {
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
    await saveLayout(activeView.id, {
      positions: positionsRef.current,
      viewport: getViewport(),
    });
    await persistView(nextView);
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    setDrawerMode("node");
    setElementTab("spec");
  }, [activeView, getViewport, persistView, screenToFlowPosition]);

  const handleAutoLayout = useCallback(async () => {
    if (!activeView) return;
    await clearLayout(activeView.id);
    await loadViewDetail(activeView.id, { forceResetLayout: true });
    showToast("Auto-layout applied");
  }, [activeView, loadViewDetail, showToast]);

  const handleToggleDirection = useCallback(async () => {
    if (!activeView) return;
    const nextDir: ViewDirection = activeView.direction === "TB" ? "LR" : "TB";
    const nextView: DesignView = { ...activeView, direction: nextDir };
    await persistView(nextView);
    await clearLayout(activeView.id);
    await loadViewDetail(activeView.id, { forceResetLayout: true });
  }, [activeView, loadViewDetail, persistView]);

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
      void saveLayout(activeView.id, {
        positions: positionsRef.current,
        viewport: getViewport(),
      });
    },
    [activeView, getViewport],
  );

  const handleMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => {
      if (!activeView || !viewportReadyRef.current) return;
      void saveLayout(activeView.id, {
        positions: positionsRef.current,
        viewport,
      });
    },
    [activeView],
  );

  const handleBeforeDelete = useCallback(
    async ({
      nodes: nodesToDel,
      edges: edgesToDel,
    }: {
      nodes: StructuredFlowNode[];
      edges: StepFlowEdge[];
    }) => {
      if (!activeView) return false;
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.tagName === "SELECT" ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return false;
      }

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
    }) => {
      if (!activeView || !pendingConn?.source || !pendingConn?.target) {
        setPendingConn(null);
        return;
      }
      const edge: DesignEdge = {
        id: `e_${Date.now().toString(36)}`,
        source: pendingConn.source,
        target: pendingConn.target,
        ...(opts.label ? { label: opts.label } : {}),
        ...(opts.step !== undefined ? { step: opts.step } : {}),
        style: opts.style,
      };
      setPendingConn(null);
      await persistView({
        ...activeView,
        edges: [...activeView.edges, edge],
      });
    },
    [activeView, pendingConn, persistView],
  );

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
            nextTabs.map(({ view_id, title, description, order }) => ({
              view_id,
              title,
              ...(description ? { description } : {}),
              order,
            })),
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
      />

      <TriageBar
        filter={filter}
        onChangeFilter={setFilter}
        hasActiveView={Boolean(activeView)}
        direction={activeView?.direction ?? "TB"}
        onToggleDirection={() => void handleToggleDirection()}
        onAddBox={() => void handleAddBox()}
        onAutoLayout={() => void handleAutoLayout()}
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
                the top tab bar to create a blank sketch or queue a view request
                for your coding agent.
              </p>
            </div>
          ) : (
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              connectionMode={ConnectionMode.Loose}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDragStop={handleNodeDragStop}
              onMoveEnd={handleMoveEnd}
              onBeforeDelete={handleBeforeDelete}
              onConnect={(conn) => {
                if (conn.source && conn.target) {
                  setPendingConn(conn);
                }
              }}
              onNodeClick={(_e, node) => {
                setSelectedNodeId(node.id);
                setSelectedEdgeId(null);
                setDrawerMode("node");
              }}
              onEdgeClick={(_e, edge) => {
                setSelectedEdgeId(edge.id);
                setSelectedNodeId(null);
                setDrawerMode("edge");
                if (elementTab === "links") setElementTab("spec");
              }}
              onPaneClick={() => {
                setSelectedNodeId(null);
                setSelectedEdgeId(null);
                if (drawerMode === "node" || drawerMode === "edge") {
                  setDrawerMode("none");
                }
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
          onCreateThread={async (input) => {
            await createThread(input);
            await loadWorkspaceMeta();
          }}
          onReplyThread={async (threadId, input) => {
            await postThreadReply(threadId, input);
            await loadWorkspaceMeta();
          }}
          onJumpToTarget={(viewId, targetType, targetId, preferredTab) => {
            void handleJumpToTarget(viewId, targetType, targetId, preferredTab);
          }}
          onNotify={showToast}
        />
      </div>

      {pendingConn && activeView && (
        <EdgeCreateModal
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
