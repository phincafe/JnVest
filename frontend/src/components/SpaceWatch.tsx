/** Space Watch — thin wrapper over ThemeWatch with theme="space".
 * Ticker list lives server-side in backend/app/routers/theme_watch.py. */
import { ThemeWatch } from "./ThemeWatch";

type Props = {
  refreshNonce: number;
  onSelect?: (symbol: string) => void;
};

export function SpaceWatch({ refreshNonce, onSelect }: Props) {
  return (
    <ThemeWatch
      theme="space"
      title="Space Watch"
      caption="SpaceX-IPO hype + space economy · sorted by buy signal"
      refreshNonce={refreshNonce}
      onSelect={onSelect}
    />
  );
}
