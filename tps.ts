/**
 * TPS Extension - live output throughput (tokens/sec) in the footer.
 *
 * One timestamp, one formula: usage.output / seconds since the assistant
 * message started. Live value while streaming (throttled), accurate final
 * on completion. Uses the provider's real output token count, never an
 * estimate.
 *
 * Caveat: the clock starts at message_start, so large-context turns fold
 * in prefill/TTFT and understate pure decode speed. Providers that report
 * usage only at the end (e.g. OpenAI) show no live value, just the final.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "tps";
const RENDER_INTERVAL_MS = 100;

let startTs = 0;
let lastRenderTs = 0;

function formatTps(tps: number): string {
  return tps >= 100 ? tps.toFixed(0) : tps.toFixed(1);
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    startTs = 0;
    lastRenderTs = 0;
    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", "tps —"));
  });

  pi.on("message_start", async (event, ctx) => {
    if (!ctx.hasUI) return;
    if (event.message.role !== "assistant") return;
    startTs = Date.now();
    lastRenderTs = 0;
  });

  pi.on("message_update", async (event, ctx) => {
    if (!ctx.hasUI) return;
    if (event.message.role !== "assistant") return;
    if (startTs === 0) return;
    const output = event.message.usage.output;
    if (output <= 0) return;
    const elapsed = (Date.now() - startTs) / 1000;
    if (elapsed <= 0) return;
    const now = Date.now();
    if (now - lastRenderTs < RENDER_INTERVAL_MS) return;
    lastRenderTs = now;
    const theme = ctx.ui.theme;
    ctx.ui.setStatus(
      STATUS_KEY,
      theme.fg("accent", "⚡") + theme.fg("dim", ` ${formatTps(output / elapsed)} tps`),
    );
  });

  pi.on("message_end", async (event, ctx) => {
    if (!ctx.hasUI) return;
    if (event.message.role !== "assistant") return;
    if (startTs === 0) return;
    const output = event.message.usage.output;
    if (output <= 0) return;
    const elapsed = (Date.now() - startTs) / 1000;
    if (elapsed <= 0) return;
    startTs = 0;
    const theme = ctx.ui.theme;
    ctx.ui.setStatus(
      STATUS_KEY,
      theme.fg("success", "✓") + theme.fg("dim", ` ${formatTps(output / elapsed)} tps`),
    );
  });
}
