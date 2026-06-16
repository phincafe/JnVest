/** Render a World Cup match-analysis "share card" straight to a canvas and
 * return a JPEG data URL. Pure Canvas 2D — no DOM capture, no web-font
 * embedding, no cross-origin image fetches — so it's instant and works
 * reliably on every browser (incl. iOS Safari), unlike html-to-image's
 * foreignObject approach which stalls in some engines. */
import type { WcMatchAnalysis, WcMatchDetail } from "../api/types";

const W = 640;
const PAD = 28;
const CW = W - PAD * 2;
const SCALE = 2;
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

function leanLabel(a: WcMatchAnalysis): string {
  if (a.lean === "home") return a.home_team ?? "Home";
  if (a.lean === "away") return a.away_team ?? "Away";
  if (a.lean === "draw") return "Draw";
  return "Too close to call";
}

export function drawShareCard(
  data: WcMatchDetail,
  analysis: WcMatchAnalysis | null,
): string {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string, f: string) => css.getPropertyValue(n).trim() || f;
  const C = {
    bg: v("--color-panel", "#0e1726"),
    text: v("--color-text", "#e6edf6"),
    dim: v("--color-text-dim", "#93a4bb"),
    accent: v("--color-accent", "#6ea8fe"),
    up: v("--color-up", "#34d399"),
    down: v("--color-down", "#f87171"),
    border: v("--color-border", "#243049"),
  };

  const font = (size: number, weight = "") => `${weight} ${size}px ${FONT}`.trim();
  const probe = document.createElement("canvas").getContext("2d")!;
  const wrap = (text: string, maxW: number, size: number, weight = ""): string[] => {
    probe.font = font(size, weight);
    const lines: string[] = [];
    let cur = "";
    for (const word of (text || "").split(/\s+/)) {
      const t = cur ? `${cur} ${word}` : word;
      if (probe.measureText(t).width > maxW && cur) {
        lines.push(cur);
        cur = word;
      } else {
        cur = t;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  };

  type Op = { h: number; draw: (ctx: CanvasRenderingContext2D, y: number) => void };
  const ops: Op[] = [];
  const home = data.home;
  const away = data.away;
  const fH = home?.lineup?.formation;
  const fA = away?.lineup?.formation;

  const text = (
    s: string,
    size: number,
    color: string,
    weight = "",
    lh = Math.round(size * 1.4),
    gap = 8,
    maxLines = 0,
  ) => {
    let lines = wrap(s, CW, size, weight);
    if (maxLines > 0) lines = lines.slice(0, maxLines);
    ops.push({
      h: lines.length * lh + gap,
      draw: (ctx, y) => {
        ctx.font = font(size, weight);
        ctx.fillStyle = color;
        ctx.textBaseline = "top";
        lines.forEach((ln, i) => ctx.fillText(ln, PAD, y + i * lh));
      },
    });
  };
  const divider = () =>
    ops.push({
      h: 14,
      draw: (ctx, y) => {
        ctx.strokeStyle = C.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PAD, y + 7);
        ctx.lineTo(W - PAD, y + 7);
        ctx.stroke();
      },
    });
  const eyebrow = (s: string) =>
    ops.push({
      h: 16,
      draw: (ctx, y) => {
        ctx.font = font(10, "700");
        ctx.fillStyle = C.dim;
        ctx.textBaseline = "top";
        ctx.fillText(s.toUpperCase(), PAD, y);
      },
    });

  // Header
  ops.push({
    h: 16,
    draw: (ctx, y) => {
      ctx.font = font(11, "700");
      ctx.fillStyle = C.accent;
      ctx.textBaseline = "top";
      ctx.fillText("2026 FIFA WORLD CUP", PAD, y);
    },
  });
  text(`${home?.name ?? "Home"}  vs  ${away?.name ?? "Away"}`, 21, C.text, "700", 26, 4);

  let sub: string;
  if (data.state === "in" || data.state === "post") {
    const hs = home?.score ?? "–";
    const as = away?.score ?? "–";
    sub = `${home?.abbr ?? ""} ${hs} – ${as} ${away?.abbr ?? ""}`;
    if (data.status_detail) sub += `  ·  ${data.status_detail}`;
  } else {
    sub = data.status_detail || "Scheduled";
  }
  const forms = [fH ? `${home?.abbr} ${fH}` : "", fA ? `${away?.abbr} ${fA}` : ""]
    .filter(Boolean)
    .join(" · ");
  if (forms) sub += `   ·   ${forms}`;
  text(sub, 12, C.dim, "", 16, 12);
  divider();

  if (analysis && analysis.available) {
    // Lean + confidence
    ops.push({
      h: 26,
      draw: (ctx, y) => {
        ctx.textBaseline = "top";
        const lead = `Lean: ${leanLabel(analysis)}`;
        ctx.font = font(16, "700");
        ctx.fillStyle = C.accent;
        ctx.fillText(lead, PAD, y);
        if (analysis.confidence) {
          const lw = ctx.measureText(lead).width;
          ctx.font = font(12, "600");
          ctx.fillStyle = C.dim;
          ctx.fillText(`   ${analysis.confidence} confidence`, PAD + lw, y + 3);
        }
      },
    });
    if (analysis.headline) text(analysis.headline, 14, C.text, "600", 19, 12);

    for (const [side, brief] of [
      [home, analysis.home],
      [away, analysis.away],
    ] as const) {
      if (!brief) continue;
      const f = side?.lineup?.formation;
      const nm = side?.name ?? "";
      ops.push({
        h: 18,
        draw: (ctx, y) => {
          ctx.textBaseline = "top";
          ctx.font = font(13, "700");
          ctx.fillStyle = C.text;
          ctx.fillText(nm, PAD, y);
          if (f) {
            const nw = ctx.measureText(nm).width;
            ctx.font = font(12, "600");
            ctx.fillStyle = C.accent;
            ctx.fillText(`  ${f}`, PAD + nw, y + 1);
          }
        },
      });
      text(brief.summary, 12, C.dim, "", 16, 10, 3);
    }

    const m = analysis.markets;
    if (m) {
      eyebrow("Markets");
      const rows: [string, string, boolean][] = [
        [
          "Total goals",
          `${m.total_goals.lean}${
            m.total_goals.line && m.total_goals.line.toLowerCase() !== "n/a"
              ? ` ${m.total_goals.line}`
              : ""
          }`,
          m.total_goals.lean === "no edge",
        ],
        ["Both teams to score", m.btts.lean, m.btts.lean === "no edge"],
        [
          "Corners",
          `${m.corners.lean} · ${m.corners.projected_total}`,
          m.corners.lean === "no edge",
        ],
        ["Cards", `${m.cards.lean} · ${m.cards.projected_total}`, m.cards.lean === "no edge"],
        [
          "Goals by half",
          m.game_flow.higher_scoring_half === "even"
            ? "even"
            : `${m.game_flow.higher_scoring_half} half`,
          m.game_flow.higher_scoring_half === "even",
        ],
      ];
      for (const [label, val, neutral] of rows) {
        ops.push({
          h: 19,
          draw: (ctx, y) => {
            ctx.textBaseline = "top";
            ctx.font = font(12);
            ctx.fillStyle = C.dim;
            ctx.fillText(label, PAD, y);
            const valStr = val.toUpperCase();
            ctx.font = font(12, "700");
            ctx.fillStyle = neutral ? C.dim : C.accent;
            const vw = ctx.measureText(valStr).width;
            ctx.fillText(valStr, W - PAD - vw, y);
          },
        });
      }
    }

    if (analysis.key_factors?.length) {
      ops.push({ h: 6, draw: () => {} });
      eyebrow("Key factors");
      for (const f of analysis.key_factors.slice(0, 4)) {
        const ls = wrap(`•  ${f}`, CW, 12);
        ops.push({
          h: ls.length * 16 + 2,
          draw: (ctx, y) => {
            ctx.font = font(12);
            ctx.fillStyle = C.text;
            ctx.textBaseline = "top";
            ls.forEach((ln, i) => ctx.fillText(ln, PAD, y + i * 16));
          },
        });
      }
    }
  } else {
    text(
      'Open this match in JnVest and tap "Analyze both teams with Claude" for the full prediction breakdown.',
      13,
      C.dim,
      "",
      18,
      6,
    );
  }

  divider();
  ops.push({
    h: 30,
    draw: (ctx, y) => {
      ctx.textBaseline = "top";
      ctx.font = font(10);
      ctx.fillStyle = C.dim;
      ctx.fillText("AI-generated from live data · not financial advice", PAD, y);
      ctx.font = font(10, "700");
      ctx.fillStyle = C.accent;
      ctx.fillText(
        `jnvest.me${analysis?.model ? `   ·   ${analysis.model}` : ""}`,
        PAD,
        y + 14,
      );
    },
  });

  const innerH = ops.reduce((s, o) => s + o.h, 0);
  const H = Math.ceil(innerH + PAD * 2);

  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.accent;
  ctx.fillRect(0, 0, W, 3); // accent top bar

  let y = PAD;
  for (const o of ops) {
    o.draw(ctx, y);
    y += o.h;
  }
  return canvas.toDataURL("image/jpeg", 0.95);
}
