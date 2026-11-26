import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DesignThread,
  DesignView,
  ThreadTargetType,
} from "@redlinify/shared/browser";
import { fetchAllViews, type TabStatusSummary } from "../api/client";
import type { ElementDrawerTab } from "../components/inspector/types";
import { buildSearchIndex, type SearchItem } from "../utils/fuzzySearch";

interface UseWorkspaceSearchOptions {
  tabs: TabStatusSummary[];
  activeView: DesignView | null;
  activeViewId: string | null;
  activeViewRef: { current: DesignView | null };
  allThreads: DesignThread[];
  clearContextMenu: () => void;
  handleSelectView: (viewId: string) => Promise<void>;
  handleJumpToTarget: (
    viewId: string | undefined,
    targetType: ThreadTargetType,
    targetId?: string,
    preferredTab?: ElementDrawerTab,
  ) => Promise<void>;
}

export function useWorkspaceSearch({
  tabs,
  activeView,
  activeViewId,
  activeViewRef,
  allThreads,
  clearContextMenu,
  handleSelectView,
  handleJumpToTarget,
}: UseWorkspaceSearchOptions) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [allViewsCache, setAllViewsCache] = useState<DesignView[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const openSearch = useCallback(() => {
    clearContextMenu();
    setSearchOpen(true);
  }, [clearContextMenu]);

  useEffect(() => {
    if (!searchOpen) return;
    let cancelled = false;
    setSearchLoading(true);
    fetchAllViews()
      .then((res) => {
        if (cancelled) return;
        setAllViewsCache(res.views);
      })
      .catch(() => {
        if (cancelled) return;
        setAllViewsCache(activeViewRef.current ? [activeViewRef.current] : []);
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeViewRef, searchOpen]);

  const searchIndexItems = useMemo(() => {
    if (!searchOpen) return [];
    const byId = new Map(allViewsCache.map((v) => [v.id, v]));
    if (activeView) {
      byId.set(activeView.id, activeView);
    }
    return buildSearchIndex({
      tabs,
      views: Array.from(byId.values()),
      allThreads,
      activeViewId,
    });
  }, [activeView, activeViewId, allThreads, allViewsCache, searchOpen, tabs]);

  const handleSelectSearchItem = useCallback(
    (item: SearchItem) => {
      setSearchOpen(false);
      if (item.kind === "view" && item.viewId) {
        void handleSelectView(item.viewId);
        return;
      }
      void handleJumpToTarget(
        item.viewId,
        item.targetType ?? "workspace",
        item.targetId,
        item.preferredTab,
      );
    },
    [handleJumpToTarget, handleSelectView],
  );

  return {
    searchOpen,
    setSearchOpen,
    searchLoading,
    openSearch,
    searchIndexItems,
    handleSelectSearchItem,
  };
}
