import { useEffect, useRef, useState } from "react";

export type LiveQuote = {
  price: number;
  ts: string | null;
};

export type StreamStatus =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "no_credentials";

type Msg =
  | { type: "trade"; symbol: string; price: number; ts: string | null }
  | { type: "quote"; symbol: string; bid: number; ask: number; ts: string | null }
  | { type: "status"; status: string; detail?: string };

const URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`;

export function useLiveQuotes(): {
  quotes: Map<string, LiveQuote>;
  status: StreamStatus;
} {
  const [quotes, setQuotes] = useState<Map<string, LiveQuote>>(new Map());
  const [status, setStatus] = useState<StreamStatus>("idle");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const backoffRef = useRef(1000);

  useEffect(() => {
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      setStatus("connecting");
      const ws = new WebSocket(URL);
      wsRef.current = ws;

      ws.onopen = () => {
        backoffRef.current = 1000;
        setStatus("live");
      };

      ws.onmessage = (e) => {
        let msg: Msg;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.type === "trade") {
          const trade = msg;
          setQuotes((prev) => {
            const next = new Map(prev);
            next.set(trade.symbol, { price: trade.price, ts: trade.ts });
            return next;
          });
        } else if (msg.type === "status") {
          if (msg.status === "no_credentials") {
            setStatus("no_credentials");
          } else if (msg.status === "reconnecting") {
            setStatus("reconnecting");
          } else if (msg.status === "subscribed" || msg.status === "connecting") {
            setStatus(msg.status === "subscribed" ? "live" : "connecting");
          }
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (stopped) return;
        setStatus("reconnecting");
        const delay = Math.min(backoffRef.current, 30_000);
        reconnectRef.current = window.setTimeout(connect, delay);
        backoffRef.current = Math.min(backoffRef.current * 2, 30_000);
      };

      ws.onerror = () => {
        // onclose will fire after this; let it handle reconnect.
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, []);

  return { quotes, status };
}
