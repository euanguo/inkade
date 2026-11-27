import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BucketMeter, computeBucketMeterLayout } from "./bucket-meter.tsx";

describe("bucket-meter", () => {
  it("computes proportional widths, clamps negatives, and detects >85% high-watermark warnings", () => {
    const normal = computeBucketMeterLayout(
      [
        { id: "md", label: "Markdown", value: 40 },
        { id: "img", label: "Images", value: 20 },
        { id: "bad", label: "Negative", value: -10 },
      ],
      { capacity: 100 },
    );

    expect(normal.usedTotal).toBe(60);
    expect(normal.capacityTotal).toBe(100);
    expect(normal.warningLevel).toBe("none");
    expect(normal.segments[0]?.widthPercent).toBe(40);
    expect(normal.segments[1]?.widthPercent).toBe(20);
    expect(normal.segments[2]?.cleanValue).toBe(0);

    const warn = computeBucketMeterLayout(
      [
        { id: "md", label: "Markdown", value: 60 },
        { id: "img", label: "Images", value: 28 },
      ],
      { capacity: 100 },
    );
    expect(warn.usagePercent).toBe(88);
    expect(warn.warningLevel).toBe("warning");

    const critical = computeBucketMeterLayout(
      [
        { id: "md", label: "Markdown", value: 70 },
        { id: "img", label: "Images", value: 50 },
      ],
      { capacity: 100 },
    );
    expect(critical.warningLevel).toBe("critical");
    // Normalized widths sum <= 100 even when usedTotal > capacity
    const totalBarWidth = critical.segments.reduce((s, item) => s + item.widthPercent, 0);
    expect(totalBarWidth).toBeLessThanOrEqual(100);
  });

  it("renders accessible segments, legend readouts, and warning badge when >85% capacity", () => {
    const html = renderToStaticMarkup(
      React.createElement(BucketMeter, {
        ariaLabel: "Storage usage",
        capacity: 100,
        formatValue: (v) => `${v} MB`,
        segments: [
          { id: "docs", label: "Docs", value: 50, tone: "primary" },
          { id: "media", label: "Media", value: 40, tone: "warning" },
        ],
      }),
    );

    expect(html).toContain('data-slot="bucket-meter"');
    expect(html).toContain('data-warning-level="warning"');
    expect(html).toContain('aria-label="Storage usage"');
    expect(html).toContain('aria-label="Docs: 50 MB (50%)"');
    expect(html).toContain('aria-label="Media: 40 MB (40%)"');
    expect(html).toContain('data-slot="bucket-meter-legend"');
    expect(html).toContain('data-slot="bucket-meter-warning"');
    expect(html).toContain("90%");
  });

  it("switches scaleMode='auto' to internal used composition when usage < 5% and preserves tiny capacity segments", () => {
    const lowUsage = computeBucketMeterLayout(
      [
        { id: "articles", label: "Articles", value: 3700 },
        { id: "outlines", label: "Outlines", value: 343 },
        { id: "clips", label: "Clips", value: 99 },
        { id: "attachments", label: "Attachments", value: 67 },
      ],
      { capacity: 1_073_741_824, scaleMode: "auto" },
    );

    expect(lowUsage.resolvedScaleMode).toBe("used");
    expect(lowUsage.warningLevel).toBe("none");
    expect(lowUsage.segments[0]?.sharePercent).toBeCloseTo(87.9, 1);
    expect(lowUsage.segments[1]?.sharePercent).toBeCloseTo(8.1, 1);
    expect(lowUsage.segments.reduce((sum, seg) => sum + seg.widthPercent, 0)).toBeCloseTo(100, 0);

    const highUsage = computeBucketMeterLayout(
      [
        { id: "articles", label: "Articles", value: 860 },
        { id: "outlines", label: "Outlines", value: 50 },
      ],
      { capacity: 1000, scaleMode: "auto" },
    );
    expect(highUsage.resolvedScaleMode).toBe("capacity");
    expect(highUsage.warningLevel).toBe("warning");

    // Explicit capacity mode still renders tiny non-zero segments (even if widthPercent rounds to 0)
    const tinyCapacityHtml = renderToStaticMarkup(
      React.createElement(BucketMeter, {
        capacity: 1_073_741_824,
        scaleMode: "capacity",
        segments: [
          { id: "articles", label: "Articles", value: 3700, tone: "primary" },
          { id: "empty", label: "Empty", value: 0, tone: "info" },
        ],
      }),
    );
    expect(tinyCapacityHtml).toContain('data-scale-mode="capacity"');
    const trackHtml = tinyCapacityHtml.split('data-slot="bucket-meter-legend"')[0] ?? "";
    expect(trackHtml).toContain('data-segment-id="articles"');
    expect(trackHtml).not.toContain('data-segment-id="empty"');
    expect(tinyCapacityHtml).toContain('data-segment-id="empty"');
  });
});
