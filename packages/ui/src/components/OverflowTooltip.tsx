import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export interface OverflowTooltipProps {
  text: string;
  detail?: string;
  alwaysShow?: boolean;
  delayMs?: number;
  className?: string;
  children: ReactNode;
}

interface TooltipCoords {
  x: number;
  y: number;
  placeBelow: boolean;
}

function isElementTruncated(root: HTMLElement): boolean {
  if (
    root.scrollWidth > root.clientWidth + 1 ||
    root.scrollHeight > root.clientHeight + 1
  ) {
    return true;
  }
  const child = root.firstElementChild as HTMLElement | null;
  if (!child) return false;
  return (
    child.scrollWidth > child.clientWidth + 1 ||
    child.scrollHeight > child.clientHeight + 1
  );
}

/**
 * Renders an interactive portal tooltip only when the child element is visually
 * truncated (`scrollWidth > clientWidth` or `scrollHeight > clientHeight`), or
 * when `alwaysShow` is set (e.g., extra schema field metadata).
 */
export function OverflowTooltip({
  text,
  detail,
  alwaysShow = false,
  delayMs = 160,
  className = "inline-block min-w-0 max-w-full",
  children,
}: OverflowTooltipProps) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const [coords, setCoords] = useState<TooltipCoords | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    setCoords(null);
  }, [clearTimer]);

  const handleMouseEnter = useCallback(() => {
    if (!text.trim() && !detail?.trim()) return;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const host = triggerRef.current;
      if (!host) return;
      const target = (host.firstElementChild as HTMLElement | null) ?? host;
      if (!alwaysShow && !isElementTruncated(target) && !isElementTruncated(host)) {
        return;
      }
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const centerX = rect.left + rect.width / 2;
      const clampedX = Math.min(window.innerWidth - 20, Math.max(20, centerX));
      const placeBelow = rect.top < 88;
      setCoords({
        x: clampedX,
        y: placeBelow ? rect.bottom + 8 : rect.top - 8,
        placeBelow,
      });
    }, delayMs);
  }, [alwaysShow, clearTimer, delayMs, detail, text]);

  useEffect(() => {
    if (!coords) return;
    const close = () => hide();
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("wheel", close);
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("keydown", close);
    };
  }, [coords, hide]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  return (
    <span
      ref={triggerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={hide}
      onPointerDown={hide}
      className={className}
    >
      {children}
      {coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="tooltip"
            style={{
              left: coords.x,
              top: coords.y,
              transform: coords.placeBelow
                ? "translate(-50%, 0)"
                : "translate(-50%, -100%)",
            }}
            className="pointer-events-none fixed z-[9999] max-w-[360px] break-words rounded-lg border border-slate-700 bg-slate-900/95 px-2.5 py-1.5 text-[11px] leading-snug text-slate-100 shadow-2xl backdrop-blur-sm"
          >
            <div className="font-mono whitespace-pre-wrap">{text}</div>
            {detail && (
              <div className="mt-1 border-t border-slate-800 pt-1 text-[10px] font-sans text-slate-400 whitespace-pre-wrap">
                {detail}
              </div>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
