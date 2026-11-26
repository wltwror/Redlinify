import { useEffect } from "react";
import type { Connection } from "@xyflow/react";
import type { TabStatusSummary } from "../api/client";
import type { ArrowDirectionKey } from "./useViewportNavigation";

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

function isArrowDirectionKey(key: string): key is ArrowDirectionKey {
  return (
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "ArrowLeft" ||
    key === "ArrowRight"
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
  startArrowPan: (key: ArrowDirectionKey, shiftKey: boolean) => void;
  stopArrowPan: (key: ArrowDirectionKey) => void;
  updateArrowShift: (shiftKey: boolean) => void;
  stopAllArrowPan: () => void;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleFitView: () => void;
  handleResetZoom: () => void;
}

/**
 * Global keyboard shortcuts: Ctrl/Cmd+K or '/' (Search), Tab / Shift+Tab
 * (Cycle tabs), Ctrl/Cmd+Z / Ctrl+Shift+Z / Ctrl+Y (Undo/Redo), plus canvas
 * zoom (+, -, 0/Shift+1, 1) and tap-or-hold arrow-key viewport panning.
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
  startArrowPan,
  stopArrowPan,
  updateArrowShift,
  stopAllArrowPan,
  handleZoomIn,
  handleZoomOut,
  handleFitView,
  handleResetZoom,
}: UseCanvasShortcutsOptions) {
  useEffect(() => {
    if (searchOpen || pendingConn) {
      stopAllArrowPan();
    }
  }, [pendingConn, searchOpen, stopAllArrowPan]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const hasOpenDialog = Boolean(document.querySelector('[role="dialog"]'));

      if (mod && !e.altKey && e.key.toLowerCase() === "k") {
        if (!searchOpen && hasOpenDialog) return;
        e.preventDefault();
        clearContextMenu();
        stopAllArrowPan();
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

      if (!pendingConn && !hasOpenDialog && !e.altKey) {
        if (e.key === "+" || e.key === "=") {
          e.preventDefault();
          handleZoomIn();
          return;
        }
        if (e.key === "-" || e.key === "_") {
          e.preventDefault();
          handleZoomOut();
          return;
        }
        if (
          e.key === "0" ||
          (!mod && e.shiftKey && (e.key === "!" || e.code === "Digit1"))
        ) {
          e.preventDefault();
          handleFitView();
          return;
        }
        if (!mod && !e.shiftKey && e.key === "1") {
          e.preventDefault();
          handleResetZoom();
          return;
        }
      }

      if (e.key === "Shift") {
        updateArrowShift(true);
      }

      if (
        !mod &&
        !e.altKey &&
        !pendingConn &&
        !hasOpenDialog &&
        isArrowDirectionKey(e.key) &&
        !document.activeElement?.closest(".react-flow__node")
      ) {
        e.preventDefault();
        if (!e.repeat) {
          startArrowPan(e.key, e.shiftKey);
        } else {
          updateArrowShift(e.shiftKey);
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

    const onKeyUp = (e: KeyboardEvent) => {
      if (isArrowDirectionKey(e.key)) {
        stopArrowPan(e.key);
      } else if (e.key === "Shift") {
        updateArrowShift(false);
      }
    };

    const onBlur = () => {
      stopAllArrowPan();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [
    activeViewIdRef,
    clearContextMenu,
    handleFitView,
    handleRedo,
    handleResetZoom,
    handleSelectView,
    handleUndo,
    handleZoomIn,
    handleZoomOut,
    openSearch,
    pendingConn,
    searchOpen,
    setSearchOpen,
    startArrowPan,
    stopAllArrowPan,
    stopArrowPan,
    tabs,
    updateArrowShift,
  ]);
}
