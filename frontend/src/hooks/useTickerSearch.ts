import { useEffect, useState } from "react";
import { api } from "../api/client";

export type TickerHit = { symbol: string; description?: string; type?: string };
type SearchResp = { results: TickerHit[]; warning?: string };

/** Debounced symbol search against /market/search. Used by both cmd+K and the
 * watchlist "Add ticker" autocomplete so they stay consistent. */
export function useTickerSearch(query: string, debounceMs = 200): TickerHit[] {
  const [results, setResults] = useState<TickerHit[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(async () => {
      try {
        const data = await api.get<SearchResp>(
          `/market/search?q=${encodeURIComponent(q)}&limit=10`,
        );
        if (!cancelled) setResults(data.results || []);
      } catch {
        if (!cancelled) setResults([]);
      }
    }, debounceMs);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [query, debounceMs]);

  return results;
}
