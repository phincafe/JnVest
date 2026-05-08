import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";

export type TabDef = {
  id: string;
  label: string;
  icon: LucideIcon;
};

type Props = {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
};

/**
 * Top tab bar on tablet+ (md and up). On mobile we render `MobileTabBar`
 * fixed to the bottom — the standard iOS/Android pattern that doesn't
 * require the user to thumb-stretch to the top of the screen.
 */
export function Tabs({ tabs, active, onChange }: Props) {
  return (
    <nav
      role="tablist"
      aria-label="JnVest sections"
      className="hidden items-center gap-1 border-b border-(--color-border) bg-(--color-bg) px-2 md:flex sm:px-4"
    >
      {tabs.map((t) => {
        const Icon = t.icon;
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            className={`flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors ${
              isActive
                ? "border-(--color-accent) text-(--color-text)"
                : "border-transparent text-(--color-text-dim) hover:text-(--color-text)"
            }`}
          >
            <Icon size={14} />
            <span>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function MobileTabBar({ tabs, active, onChange }: Props) {
  // Render via Portal directly to <body> so the bar is never affected by
  // ancestor stacking contexts (Recharts/lightweight-charts internally use
  // CSS transforms which can contain fixed children inside their parents).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return null;

  const node = (
    <nav
      role="tablist"
      aria-label="JnVest sections (mobile)"
      // No backdrop-blur — caused fixed-positioning glitches in iOS Safari
      // when a chart re-paints. Solid background is fine here.
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 60,
        paddingBottom: "env(safe-area-inset-bottom)",
        WebkitTransform: "translateZ(0)",
        transform: "translateZ(0)",
      }}
      className="grid grid-cols-4 border-t border-(--color-border) bg-(--color-bg) md:hidden"
    >
      {tabs.map((t) => {
        const Icon = t.icon;
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-2 py-1.5 text-[10px] uppercase tracking-wide transition-colors ${
              isActive
                ? "text-(--color-accent)"
                : "text-(--color-text-dim) active:text-(--color-text)"
            }`}
          >
            <Icon size={20} />
            <span>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );

  return createPortal(node, document.body);
}
