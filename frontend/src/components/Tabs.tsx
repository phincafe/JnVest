import type { ReactNode } from "react";
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
  children?: ReactNode;
};

export function Tabs({ tabs, active, onChange }: Props) {
  return (
    <nav
      role="tablist"
      aria-label="JnVest sections"
      className="flex items-center gap-1 border-b border-(--color-border) bg-(--color-bg) px-2 sm:px-4"
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
