import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

export interface ContextMenuItem {
  id: string;
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  dividerBefore?: boolean;
  onSelect?: () => void;
  children?: ContextMenuItem[];
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
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);

  useEffect(() => {
    setOpenSubmenuId(null);
  }, [x, y]);

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
  const flipSubmenuLeft = clampedLeft + 430 > window.innerWidth;

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
      {items.map((item) => {
        const hasChildren = Boolean(item.children && item.children.length > 0);
        const submenuOpen = hasChildren && openSubmenuId === item.id;

        return (
          <div
            key={item.id}
            className="relative"
            onMouseEnter={() => {
              setOpenSubmenuId(
                hasChildren && !item.disabled ? item.id : null,
              );
            }}
          >
            {item.dividerBefore && (
              <div className="my-1 border-t border-slate-800" />
            )}
            <button
              type="button"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                if (hasChildren) {
                  setOpenSubmenuId(item.id);
                  return;
                }
                onClose();
                item.onSelect?.();
              }}
              className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                item.disabled
                  ? "cursor-not-allowed text-slate-600"
                  : item.danger
                    ? "text-rose-300 hover:bg-rose-500/15 hover:text-rose-200"
                    : submenuOpen
                      ? "bg-slate-800 text-slate-50"
                      : "text-slate-200 hover:bg-slate-800 hover:text-slate-50"
              }`}
            >
              <span className="truncate">{item.label}</span>
              {hasChildren ? (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              ) : (
                item.shortcut && (
                  <span className="font-mono text-[10px] text-slate-500">
                    {item.shortcut}
                  </span>
                )
              )}
            </button>

            {submenuOpen && item.children && (
              <div
                onContextMenu={(e) => e.preventDefault()}
                className={`absolute top-0 z-50 ${
                  flipSubmenuLeft ? "right-full pr-1" : "left-full pl-1"
                }`}
              >
                <div className="min-w-[190px] max-w-[260px] max-h-[260px] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur-md">
                  {item.children.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      disabled={child.disabled}
                      onClick={() => {
                        if (child.disabled) return;
                        onClose();
                        child.onSelect?.();
                      }}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                        child.disabled
                          ? "cursor-not-allowed text-slate-600"
                          : child.danger
                            ? "text-rose-300 hover:bg-rose-500/15 hover:text-rose-200"
                            : "text-slate-200 hover:bg-slate-800 hover:text-slate-50"
                      }`}
                    >
                      <span className="truncate">{child.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
