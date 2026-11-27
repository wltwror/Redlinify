import { useEffect, useRef } from "react";
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

function isSpaceEvent(e: KeyboardEvent): boolean {
  return e.code === "Space" || e.key === " ";
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
  handleAutoLayout: () => Promise<void>;
  handleAddBoxAtCursor: () => Promise<void>;
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
 * Global keyboard shortcuts: Ctrl/Cmd+K or '/' (Search), Tab / Shift+Tab / 1-9
 * (Switch tabs), r (Auto-layout), n (New box at cursor), Ctrl/Cmd+Z / Ctrl+Shift+Z /
 * Ctrl+Y (Undo/Redo), Space tap / 0 / Shift+1 (Fit whole view; Space+drag pans),
 * +, -, Shift+0 / Ctrl+0 (Zoom / Reset 100%), and arrow-key panning.
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
}: UseCanvasShortcutsOptions) {
  const spaceHeldRef = useRef(false);
  const spaceDraggedRef = useRef(false);

  useEffect(() => {
    if (searchOpen || pendingConn) {
      stopAllArrowPan();
      spaceHeldRef.current = false;
      spaceDraggedRef.current = false;
    }
  }, [pendingConn, searchOpen, stopAllArrowPan]);

  useEffect(() => {
    const onPointerDown = () => {
      if (spaceHeldRef.current) {
        spaceDraggedRef.current = true;
      }
    };

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
        if (!mod && !e.shiftKey && isSpaceEvent(e)) {
          e.preventDefault();
          if (!e.repeat) {
            spaceHeldRef.current = true;
            spaceDraggedRef.current = false;
          }
          return;
        }

        if (!mod && !e.shiftKey && e.key >= "1" && e.key <= "9") {
          const targetTab = tabs[Number(e.key) - 1];
          if (targetTab) {
            e.preventDefault();
            clearContextMenu();
            void handleSelectView(targetTab.view_id);
          }
          return;
        }

        if (!mod && !e.shiftKey && !e.repeat && e.key.toLowerCase() === "r") {
          e.preventDefault();
          clearContextMenu();
          void handleAutoLayout();
          return;
        }

        if (!mod && !e.shiftKey && !e.repeat && e.key.toLowerCase() === "n") {
          e.preventDefault();
          clearContextMenu();
          void handleAddBoxAtCursor();
          return;
        }

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
          (!mod && e.shiftKey && (e.key === ")" || e.code === "Digit0")) ||
          (mod && !e.shiftKey && (e.key === "0" || e.code === "Digit0"))
        ) {
          e.preventDefault();
          handleResetZoom();
          return;
        }
        if (
          (!mod && !e.shiftKey && e.key === "0") ||
          (!mod && e.shiftKey && (e.key === "!" || e.code === "Digit1"))
        ) {
          e.preventDefault();
          handleFitView();
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
      if (isSpaceEvent(e) && spaceHeldRef.current) {
        e.preventDefault();
        const dragged = spaceDraggedRef.current;
        spaceHeldRef.current = false;
        spaceDraggedRef.current = false;
        if (
          !dragged &&
          !searchOpen &&
          !isEditableFocus() &&
          !pendingConn &&
          !document.querySelector('[role="dialog"]')
        ) {
          handleFitView();
        }
        return;
      }
      if (isArrowDirectionKey(e.key)) {
        stopArrowPan(e.key);
      } else if (e.key === "Shift") {
        updateArrowShift(false);
      }
    };

    const onBlur = () => {
      spaceHeldRef.current = false;
      spaceDraggedRef.current = false;
      stopAllArrowPan();
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [
    activeViewIdRef,
    clearContextMenu,
    handleAddBoxAtCursor,
    handleAutoLayout,
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
