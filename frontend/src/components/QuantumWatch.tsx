/** Quantum Watch — thin wrapper over ThemeWatch with theme="quantum".
 * Ticker list lives server-side in backend/app/routers/theme_watch.py.
 *
 * Hype cross-ref: the pure-play names (IONQ / RGTI / QBTS / QUBT) tend to
 * spike together on WSB chatter and any quantum-policy headline from the
 * White House — flip to the WSB tab to confirm retail flow before chasing,
 * or click into a ticker to see the Finnhub news panel for policy context. */
import { ThemeWatch } from "./ThemeWatch";

type Props = {
  refreshNonce: number;
  onSelect?: (symbol: string) => void;
};

export function QuantumWatch({ refreshNonce, onSelect }: Props) {
  return (
    <ThemeWatch
      theme="quantum"
      title="Quantum Watch"
      caption="Quantum computing hype basket · pure-plays + big tech · cross-ref WSB for retail flow"
      refreshNonce={refreshNonce}
      onSelect={onSelect}
    />
  );
}
