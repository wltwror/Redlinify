import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  id: string;
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  dividerBefore?: boolean;
  onSelect: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  header?: string;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({
  x,
  y,
  header,
  items,
  onClose,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const clampedLeft = Math.min(x, Math.max(8, window.innerWidth - 230));
  const clampedTop = Math.min(
    y,
    Math.max(8, window.innerHeight - Math.min(360, items.length * 34 + 40)),
  );

  return (
    <div
      ref={menuRef}
      style={{ left: clampedLeft, top: clampedTop }}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 min-w-[215px] rounded-xl border border-slate-700 bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur-md"
    >
      {header && (
        <div className="mb-1 border-b border-slate-800 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-400 truncate">
          {header}
        </div>
      )}
      {items.map((item) => (
        <div key={item.id}>
          {item.dividerBefore && (
            <div className="my-1 border-t border-slate-800" />
          )}
          <button
            type="button"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              item.onSelect();
            }}
            className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
              item.disabled
                ? "cursor-not-allowed text-slate-600"
                : item.danger
                  ? "text-rose-300 hover:bg-rose-500/15 hover:text-rose-200"
                  : "text-slate-200 hover:bg-slate-800 hover:text-white"
            }`}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span className="font-mono text-[10px] text-slate-500">
                {item.shortcut}
              </span>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
