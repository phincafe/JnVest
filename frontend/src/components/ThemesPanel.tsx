/** Themes — WH / Space / Quantum curated watches consolidated into one tab.
 * A pill selector switches between them (persisted in sessionStorage), which
 * keeps the Watchlist sub-tab bar from sprawling as themes are added.
 * Ticker lists live server-side in backend/app/routers/theme_watch.py. */
import { useState } from "react";
import { ThemeWatch } from "./ThemeWatch";

const THEMES = [
  {
    key: "wh",
    label: "WH",
    title: "WH Watch",
    caption: "US policy / spending themes · sorted by buy signal",
  },
  {
    key: "space",
    label: "Space",
    title: "Space Watch",
    caption: "SpaceX-IPO hype + space economy · sorted by buy signal",
  },
  {
    key: "quantum",
    label: "Quantum",
    title: "Quantum Watch",
    caption:
      "Quantum computing hype basket · pure-plays + big tech · cross-ref WSB for retail flow",
  },
] as const;

type ThemeKey = (typeof THEMES)[number]["key"];

type Props = {
  refreshNonce: number;
  onSelect?: (symbol: string) => void;
};

export function ThemesPanel({ refreshNonce, onSelect }: Props) {
  const [active, setActive] = useState<ThemeKey>(() => {
    const saved = sessionStorage.getItem("jnv:theme") as ThemeKey | null;
    return THEMES.some((t) => t.key === saved) && saved ? saved : "wh";
  });
  const pick = (key: ThemeKey) => {
    sessionStorage.setItem("jnv:theme", key);
    setActive(key);
  };
  const theme = THEMES.find((t) => t.key === active) ?? THEMES[0];

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-md border border-(--color-border) bg-(--color-panel) p-0.5 text-xs">
        {THEMES.map((t) => (
          <button
            key={t.key}
            onClick={() => pick(t.key)}
            className={`rounded px-3 py-1 font-medium ${
              active === t.key
                ? "bg-(--color-accent) text-white"
                : "text-(--color-text-dim) hover:text-(--color-text)"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <ThemeWatch
        theme={theme.key}
        title={theme.title}
        caption={theme.caption}
        refreshNonce={refreshNonce}
        onSelect={onSelect}
      />
    </div>
  );
}
