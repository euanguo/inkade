import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  computeElapsedSecondsFromIso,
  formatElapsedTimer,
  getThinkingDotDelayStep,
  ThinkingIndicator,
} from "./thinking-indicator.tsx";

describe("thinking-indicator", () => {
  it("computes diagonal stagger wave steps across the 3x3 grid", () => {
    const steps = Array.from({ length: 9 }, (_, i) => getThinkingDotDelayStep(i));
    expect(steps).toEqual([0, 1, 2, 1, 2, 3, 2, 3, 4]);
    expect(getThinkingDotDelayStep(-1)).toBe(0);
    expect(getThinkingDotDelayStep(99)).toBe(4);
  });

  it("formats elapsed seconds as zero-padded MM:SS and HH:MM:SS above one hour", () => {
    expect(formatElapsedTimer(0)).toBe("00:00");
    expect(formatElapsedTimer(12)).toBe("00:12");
    expect(formatElapsedTimer(65)).toBe("01:05");
    expect(formatElapsedTimer(3665)).toBe("01:01:05");
    expect(formatElapsedTimer(126790)).toBe("35:13:10");
    expect(formatElapsedTimer(-4)).toBe("00:00");
    expect(formatElapsedTimer(Number.NaN)).toBe("00:00");
  });

  it("renders 9 staggered dots, essential pulse marker, shimmering label, and tabular timer", () => {
    const html = renderToStaticMarkup(
      React.createElement(ThinkingIndicator, {
        label: "Synthesizing notes",
        showTimer: true,
        elapsedSeconds: 12,
        size: "md",
      }),
    );

    expect(html).toContain('data-slot="thinking-indicator"');
    expect(html).toContain('data-size="md"');
    expect(html).toContain('role="status"');
    expect(html).toContain('data-motion-essential="pulse"');
    expect(html).toContain('data-slot="thinking-indicator-matrix"');
    expect(html.match(/data-slot="thinking-indicator-dot"/g)?.length).toBe(9);
    expect(html).toContain("calc(var(--duration-stagger) * 4)");
    expect(html).toContain("Synthesizing notes");
    expect(html).toContain("00:12");
    expect(html).toContain("tabular-nums");
  });

  it("supports compact inline mode without timer or shimmer", () => {
    const html = renderToStaticMarkup(
      React.createElement(ThinkingIndicator, {
        size: "sm",
        shimmer: false,
      }),
    );

    expect(html).toContain('data-size="sm"');
    expect(html).not.toContain('data-slot="thinking-indicator-timer"');
    expect(html).not.toContain('data-slot="thinking-indicator-label"');
  });

  it("computes live elapsed duration from a server ISO startedAt timestamp", () => {
    const nowMs = Date.parse("2026-11-25T10:01:25.000Z");
    expect(computeElapsedSecondsFromIso("2026-11-25T10:00:00.000Z", nowMs)).toBe(85);
    expect(computeElapsedSecondsFromIso("2026-11-25T10:02:00.000Z", nowMs)).toBe(0);
    expect(computeElapsedSecondsFromIso("not-a-date", nowMs)).toBeNull();
    expect(computeElapsedSecondsFromIso(null, nowMs)).toBeNull();

    const startedAt = new Date(Date.now() - 125_000).toISOString();
    const html = renderToStaticMarkup(
      React.createElement(ThinkingIndicator, {
        label: "Indexing",
        showTimer: true,
        startedAt,
      }),
    );
    expect(html).toContain('data-slot="thinking-indicator-timer"');
    expect(html).toMatch(/02:0[456]/);
  });
});
