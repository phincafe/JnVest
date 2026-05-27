/** WH Watch — thin wrapper over ThemeWatch with theme="wh".
 * Ticker list lives server-side in backend/app/routers/theme_watch.py. */
import { ThemeWatch } from "./ThemeWatch";

type Props = {
  refreshNonce: number;
  onSelect?: (symbol: string) => void;
};

export function WhWatch({ refreshNonce, onSelect }: Props) {
  return (
    <ThemeWatch
      theme="wh"
      title="WH Watch"
      caption="US policy / spending themes · sorted by buy signal"
      refreshNonce={refreshNonce}
      onSelect={onSelect}
    />
  );
}
