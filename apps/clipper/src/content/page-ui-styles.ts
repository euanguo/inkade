export const PAGE_UI_SHADOW_CSS = `
:host {
  all: initial;
  font-family: "Inter", "PingFang SC", "Noto Sans SC", system-ui, -apple-system, sans-serif;
  color-scheme: light dark;
  --duration-instant: 90ms;
  --duration-quick: 140ms;
  --duration-fast: 150ms;
  --ease-smooth-out: cubic-bezier(0.22, 1, 0.36, 1);
  --corner-shape: superellipse(1.5);
  --focus-ring-dark: rgba(255, 255, 255, 0.72);
  --focus-ring-light: rgba(23, 23, 23, 0.55);
}

*, *::before, *::after {
  box-sizing: border-box;
}

.ink-overlay-layer {
  position: fixed;
  inset: 0;
  z-index: 2147483640;
  pointer-events: none;
}

.ink-hl-rect {
  position: fixed;
  border-radius: 3px;
  pointer-events: none;
  transition:
    opacity var(--duration-fast) var(--ease-smooth-out),
    box-shadow var(--duration-fast) var(--ease-smooth-out);
}

.ink-hl-rect.amber {
  background: rgba(251, 191, 36, 0.28);
  border-bottom: 2px solid rgba(217, 119, 6, 0.72);
}

.ink-hl-rect.emerald {
  background: rgba(52, 211, 153, 0.25);
  border-bottom: 2px solid rgba(5, 150, 105, 0.72);
}

.ink-hl-rect.blue {
  background: rgba(96, 165, 250, 0.25);
  border-bottom: 2px solid rgba(37, 99, 235, 0.72);
}

.ink-hl-rect.rose {
  background: rgba(251, 113, 133, 0.25);
  border-bottom: 2px solid rgba(225, 29, 72, 0.72);
}

.ink-hl-rect.pulse {
  box-shadow: inset 0 0 0 1.5px rgba(23, 23, 23, 0.55);
}

.ink-hl-pin {
  position: fixed;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  corner-shape: round;
  border: 1.5px solid #ffffff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.22);
  pointer-events: auto;
  cursor: pointer;
  transform: translate(-4px, -6px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #ffffff;
  padding: 0;
  transition: transform var(--duration-instant) var(--ease-smooth-out);
}

.ink-hl-pin:hover {
  transform: translate(-4px, -6px) scale(1.1);
}

.ink-hl-pin:focus-visible {
  outline: 2px solid var(--focus-ring-light);
  outline-offset: 2px;
}

.ink-hl-pin.amber { background: #d97706; }
.ink-hl-pin.emerald { background: #059669; }
.ink-hl-pin.blue { background: #2563eb; }
.ink-hl-pin.rose { background: #e11d48; }

.ink-float-card {
  position: fixed;
  z-index: 2147483646;
  max-width: calc(100vw - 24px);
  pointer-events: auto;
  background: rgba(24, 25, 28, 0.96);
  color: #eeeeef;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 9px;
  corner-shape: var(--corner-shape);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 12px 30px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(12px);
}

.ink-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 6px 8px;
}

.ink-toolbar-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.ink-sep {
  width: 1px;
  height: 16px;
  background: rgba(255, 255, 255, 0.14);
  margin: 0 2px;
}

.ink-dot-btn {
  width: 20px;
  height: 20px;
  border-radius: 999px;
  corner-shape: round;
  border: 1.5px solid rgba(255, 255, 255, 0.28);
  cursor: pointer;
  padding: 0;
  transition:
    transform var(--duration-quick) var(--ease-smooth-out),
    box-shadow var(--duration-quick) var(--ease-smooth-out);
}

.ink-dot-btn:hover { transform: scale(1.12); }
.ink-dot-btn.active {
  border-color: rgba(255, 255, 255, 0.92);
  box-shadow:
    0 0 0 1.5px rgba(24, 25, 28, 0.96),
    0 0 0 3px #ffffff;
}
.ink-dot-btn:focus-visible {
  outline: 2px solid var(--focus-ring-dark);
  outline-offset: 2px;
}
.ink-dot-btn.amber { background: #f59e0b; }
.ink-dot-btn.emerald { background: #10b981; }
.ink-dot-btn.blue { background: #3b82f6; }
.ink-dot-btn.rose { background: #f43f5e; }

.ink-icon-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 7px;
  border-radius: 6px;
  corner-shape: var(--corner-shape);
  border: none;
  background: transparent;
  color: #e2e8f0;
  font-size: 11.5px;
  font-family: inherit;
  cursor: pointer;
  transition: background-color var(--duration-quick) var(--ease-smooth-out);
}

.ink-icon-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}

.ink-icon-btn:focus-visible {
  outline: 2px solid var(--focus-ring-dark);
  outline-offset: 1px;
}

.ink-popover {
  width: 300px;
  max-width: calc(100vw - 24px);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ink-popover-quote {
  font-size: 11.5px;
  color: #d4d4d8;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  corner-shape: var(--corner-shape);
  padding: 6px 8px;
  max-height: 60px;
  overflow: hidden;
  line-height: 1.45;
}

.ink-popover-textarea {
  width: 100%;
  min-height: 58px;
  border-radius: 6px;
  corner-shape: var(--corner-shape);
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.06);
  color: #f8fafc;
  padding: 6px 8px;
  font-size: 12px;
  line-height: 1.45;
  font-family: inherit;
  resize: vertical;
  transition: border-color var(--duration-quick) var(--ease-smooth-out);
}

.ink-popover-textarea:focus-visible {
  outline: 2px solid var(--focus-ring-dark);
  outline-offset: 1px;
  border-color: rgba(255, 255, 255, 0.45);
}

.ink-popover-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.ink-btn-sm {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 9px;
  border-radius: 6px;
  corner-shape: var(--corner-shape);
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.08);
  color: #f8fafc;
  font-size: 11.5px;
  font-family: inherit;
  cursor: pointer;
  transition:
    background-color var(--duration-quick) var(--ease-smooth-out),
    border-color var(--duration-quick) var(--ease-smooth-out),
    transform var(--duration-instant) var(--ease-smooth-out);
}

.ink-btn-sm:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.14);
}

.ink-btn-sm:active:not(:disabled) {
  transform: scale(0.97);
}

.ink-btn-sm:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.ink-btn-sm:focus-visible {
  outline: 2px solid var(--focus-ring-dark);
  outline-offset: 1px;
}

.ink-btn-sm.primary {
  background: #ededee;
  border-color: transparent;
  color: #0f1011;
}

.ink-btn-sm.primary:hover:not(:disabled) {
  background: #ffffff;
}

.ink-btn-sm.danger {
  color: #fca5a5;
  border-color: rgba(248, 113, 113, 0.35);
}

.ink-region-box {
  position: fixed;
  z-index: 2147483644;
  pointer-events: none;
  border: 1.5px solid #171717;
  background: rgba(23, 23, 23, 0.08);
  border-radius: 6px;
  corner-shape: var(--corner-shape);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.65);
  transition:
    top var(--duration-instant) var(--ease-smooth-out),
    left var(--duration-instant) var(--ease-smooth-out),
    width var(--duration-instant) var(--ease-smooth-out),
    height var(--duration-instant) var(--ease-smooth-out);
}

.ink-region-box.locked {
  border-color: #059669;
  background: rgba(5, 150, 105, 0.12);
}

.ink-region-hud {
  position: fixed;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483647;
  pointer-events: auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  max-width: calc(100vw - 24px);
  padding: 7px 14px;
  border-radius: 999px;
  corner-shape: round;
  background: rgba(24, 25, 28, 0.96);
  color: #f9fafb;
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 10px 28px rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(12px);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.ink-reader-progress {
  position: absolute;
  top: 0;
  left: 0;
  height: 2px;
  background: currentColor;
  opacity: 0.42;
  border-radius: 8px 8px 0 0;
  transition: width var(--duration-instant) linear;
}

.ink-reader-fontsize {
  font-size: 11.5px;
  min-width: 34px;
  text-align: center;
  opacity: 0.78;
  font-variant-numeric: tabular-nums;
}

.ink-reader-loading {
  max-width: 70ch;
  margin: 48px auto;
  text-align: center;
  font-size: 13px;
  opacity: 0.72;
}

.ink-reader-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483645;
  pointer-events: auto;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 24px 16px 64px;
  background: #ffffff;
  color: #171717;
}

.ink-reader-backdrop.sepia {
  background: #fbf8f1;
  color: #2b251e;
}

.ink-reader-backdrop.dark {
  background: #141517;
  color: #eeeeef;
}

.ink-reader-bar {
  position: sticky;
  top: 0;
  max-width: 70ch;
  margin: 0 auto 24px;
  padding: 10px 14px;
  border-radius: 9px;
  corner-shape: var(--corner-shape);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: rgba(245, 245, 245, 0.92);
  border: 1px solid rgba(0, 0, 0, 0.068);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  backdrop-filter: blur(12px);
}

.ink-reader-backdrop.sepia .ink-reader-bar {
  background: rgba(244, 239, 228, 0.92);
  border-color: rgba(120, 96, 62, 0.14);
}

.ink-reader-backdrop.dark .ink-reader-bar {
  background: rgba(24, 25, 28, 0.92);
  border-color: rgba(255, 255, 255, 0.075);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 4px 16px rgba(0, 0, 0, 0.25);
}

.ink-reader-article {
  max-width: 70ch;
  margin: 0 auto;
  line-height: 1.7;
}

.ink-reader-article h1 {
  font-size: 1.85em;
  line-height: 1.25;
  margin: 0 0 10px;
}

.ink-reader-article img {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  corner-shape: var(--corner-shape);
}

.ink-reader-article pre {
  padding: 12px 14px;
  border-radius: 8px;
  corner-shape: var(--corner-shape);
  background: #f8f8f9;
  border: 1px solid rgba(0, 0, 0, 0.068);
  overflow-x: auto;
  scrollbar-gutter: stable;
}

.ink-reader-backdrop.sepia .ink-reader-article pre {
  background: #f4efe4;
  border-color: rgba(120, 96, 62, 0.14);
}

.ink-reader-backdrop.dark .ink-reader-article pre {
  background: #1a1b1f;
  border-color: rgba(255, 255, 255, 0.075);
}

.ink-reader-article blockquote {
  border-left: 2px solid color-mix(in srgb, currentColor 22%, transparent);
  margin: 14px 0;
  padding: 4px 14px;
  opacity: 0.9;
}

.ink-reader-backdrop.light .ink-btn-sm,
.ink-reader-backdrop.sepia .ink-btn-sm {
  outline-color: var(--focus-ring-light);
}

.ink-reader-backdrop.light .ink-btn-sm:focus-visible,
.ink-reader-backdrop.sepia .ink-btn-sm:focus-visible {
  outline: 2px solid var(--focus-ring-light);
  outline-offset: 1px;
}

.ink-reader-backdrop.light .ink-btn-sm {
  border-color: rgba(23, 23, 23, 0.12);
  background: rgba(23, 23, 23, 0.04);
  color: #171717;
}

.ink-reader-backdrop.light .ink-btn-sm:hover:not(:disabled) {
  background: rgba(23, 23, 23, 0.08);
}

.ink-reader-backdrop.sepia .ink-btn-sm {
  border-color: rgba(120, 96, 62, 0.24);
  background: rgba(120, 96, 62, 0.08);
  color: #2b251e;
}

.ink-reader-backdrop.sepia .ink-btn-sm:hover:not(:disabled) {
  background: rgba(120, 96, 62, 0.15);
}

.ink-reader-backdrop.dark .ink-btn-sm {
  border-color: rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.07);
  color: #eeeeef;
}

.ink-reader-backdrop.dark .ink-btn-sm:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.13);
}

.ink-reader-backdrop.light .ink-btn-sm.primary,
.ink-reader-backdrop.sepia .ink-btn-sm.primary {
  background: #171717;
  border-color: transparent;
  color: #ffffff;
}

.ink-reader-backdrop.dark .ink-btn-sm.primary {
  background: #ededee;
  border-color: transparent;
  color: #0f1011;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

.ink-toast-stack {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: min(340px, calc(100vw - 24px));
  pointer-events: auto;
}

.ink-toast {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 9px;
  corner-shape: var(--corner-shape);
  background: rgba(24, 25, 28, 0.96);
  color: #eeeeef;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 10px 26px rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(12px);
  font-size: 12.5px;
  line-height: 1.4;
}

.ink-toast.success { border-color: rgba(74, 222, 128, 0.45); }
.ink-toast.error { border-color: rgba(248, 113, 113, 0.55); }
.ink-toast-link {
  color: #eeeeef;
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
  background: none;
  border: none;
  border-radius: 4px;
  padding: 0 2px;
  font-size: 12px;
  white-space: nowrap;
}
.ink-toast-link:focus-visible {
  outline: 2px solid var(--focus-ring-dark);
  outline-offset: 2px;
}
.ink-toast-close {
  color: rgba(238, 238, 239, 0.65);
  cursor: pointer;
  background: none;
  border: none;
  border-radius: 4px;
  padding: 0 2px;
  font-size: 15px;
  line-height: 1;
}
.ink-toast-close:hover {
  color: #ffffff;
}
.ink-toast-close:focus-visible {
  outline: 2px solid var(--focus-ring-dark);
  outline-offset: 2px;
}
`;
