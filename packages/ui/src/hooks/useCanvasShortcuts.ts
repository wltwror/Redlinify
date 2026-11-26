import { useEffect } from "react";
import type { Connection } from "@xyflow/react";
import type { TabStatusSummary } from "../api/client";

export function isEditableFocus(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    (el as HTMLElement).isContentEditable
  );
}

interface UseCanvasShortcutsOptions {
  activeViewIdRef: { current: string | null };
  tabs: TabStatusSummary[];
  searchOpen: boolean;
  pendingConn: Connection | null;
  setSearchOpen: (updater: (prev: boolean) => boolean) => void;
  openSearch: () => void;
  clearContextMenu: () => void;
  handleSelectView: (viewId: string) => Promise<void>;
  handleUndo: () => Promise<void>;
  handleRedo: () => Promise<void>;
}

/**
 * Global keyboard shortcuts: Ctrl/Cmd+K or '/' (Search), Tab / Shift+Tab
 * (Cycle tabs), and Ctrl/Cmd+Z / Ctrl+Shift+Z / Ctrl+Y (Undo/Redo).
 */
export function useCanvasShortcuts({
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
}: UseCanvasShortcutsOptions) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const hasOpenDialog = Boolean(document.querySelector('[role="dialog"]'));

      if (mod && !e.altKey && e.key.toLowerCase() === "k") {
        if (!searchOpen && hasOpenDialog) return;
        e.preventDefault();
        clearContextMenu();
        setSearchOpen((prev) => !prev);
        return;
      }

      if (searchOpen) return;
      if (isEditableFocus()) return;

      if (
        !mod &&
        !e.altKey &&
        e.key === "/" &&
        !pendingConn &&
        !hasOpenDialog
      ) {
        e.preventDefault();
        openSearch();
        return;
      }

      if (
        !mod &&
        !e.altKey &&
        e.key === "Tab" &&
        !pendingConn &&
        !hasOpenDialog &&
        tabs.length > 1
      ) {
        e.preventDefault();
        const currIdx = tabs.findIndex(
          (t) => t.view_id === activeViewIdRef.current,
        );
        const delta = e.shiftKey ? -1 : 1;
        const baseIdx = currIdx === -1 ? 0 : currIdx;
        const nextIdx = (baseIdx + delta + tabs.length) % tabs.length;
        const nextTab = tabs[nextIdx];
        if (nextTab) {
          void handleSelectView(nextTab.view_id);
        }
        return;
      }

      if (!mod || e.altKey) return;
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
  }, [
    activeViewIdRef,
    clearContextMenu,
    handleRedo,
    handleSelectView,
    handleUndo,
    openSearch,
    pendingConn,
    searchOpen,
    setSearchOpen,
    tabs,
  ]);
}
