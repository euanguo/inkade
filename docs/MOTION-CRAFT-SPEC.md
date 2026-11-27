# Inkade Motion & Typeset Craft Specification

Phase 17 establishes Inkade's semantic motion token system, smart reduced-motion policy, streaming-safe editorial prose rhythm, optical scroll edge treatment, and reusable feedback primitives—built purely with CSS, WAAPI, and Base UI under permissive open-source licenses.

---

## 1. Semantic Duration & Easing Tokens (`packages/ui/src/theme/tokens.css`)

| Token | Value | Intended Usage |
| :--- | :--- | :--- |
| `--duration-stagger` | `40ms` | Per-step diagonal wave offset (`ThinkingIndicator`) and list reveal stagger |
| `--duration-micro` | `80ms` | Press feedback, subtle tint overlays |
| `--duration-quick` | `150ms` | Hover transitions, overlay exit (`data-ending-style`), quick UI responses |
| `--duration-fast` | `220ms` | Overlay entrance (`DialogPopup`, `PopoverPopup`, `MenuPopup`, `ContextMenuPopup`), `CopyButton`, `SegmentedControl` indicator |
| `--duration-medium` | `320ms` | Numeric count-up transitions (`NumberTicker`), moderate layout transitions |
| `--duration-slow` | `380ms` | View Transition surface ripple (`applySurfaceThemeWithRipple`), drawer swipe settles |

### Easing Curves

| Curve | Value | Usage |
| :--- | :--- | :--- |
| `--ease-smooth-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | Primary enter transitions, popover glides, indicator slides |
| `--ease-bounce` | `cubic-bezier(0.34, 1.36, 0.64, 1)` | Tactile micro-springs |
| `--ease-bounce-return` | `cubic-bezier(0.34, 2.2, 0.64, 1)` | Subtle overshoot settle on return from micro-lift (`TagPill`) |

Legacy `--motion-fast` (`120ms`), `--motion-base` (`160ms`), and `--motion-ease` remain intact for backward compatibility.

### Asymmetric Enter / Exit Timing

Overlays (`DialogPopup`, `DialogBackdrop`, `PopoverPopup`, `MenuPopup`, `ContextMenuPopup`, `TooltipPopup`, `SheetBackdrop`, `AlertDialogBackdrop`, `CommandDialogBackdrop`) enter with `--duration-fast` (`220ms`) + `--ease-smooth-out`, and exit briskly with `--duration-quick` (`150ms`) + `ease-out` with zero bounce.

---

## 2. Smart Reduced Motion & `[data-motion="reduced-pulse"]`

Instead of freezing all feedback to `0.01ms` indiscriminately:

- Both `@media (prefers-reduced-motion: reduce)` and `html[data-motion="reduced-pulse"]` suppress spatial displacement, scaling, blurs, and shakes (`animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important;`) on ordinary elements (`*:not([data-motion-essential="pulse"])`).
- Elements carrying `data-motion-essential="pulse"` (`Spinner`, `ThinkingIndicator` matrix, reconnecting status indicators) and `.inkade-ade-pulse` transition to `@keyframes inkade-essential-pulse` (`2.6s ease-in-out infinite`, opacity `1 ↔ 0.45`), ensuring live states remain legible without vestibular motion.
- Explicit non-essential animations (`.animate-skeleton`, `HoldConfirmButton` `data-almost-ready="true"` shake, individual `ThinkingIndicator` wave dots) are stopped (`animation: none !important`).
- Theme presets (`MotionProfile`: `"comfort" | "reduced-pulse"`, persisted under `inkade:motion-profile`) mirror this via `data-motion` on `<html>` (`apps/web/src/lib/theme.ts`).

---

## 3. Streaming-Safe `.inkade-prose` & Typeset Presets

- **Presets (`TypesetPreset`)**: `"compact" | "standard" | "relaxed"` persisted under `inkade:typeset` and applied as `html[data-typeset="..."]`, driving `--typeset-size`, `--typeset-leading`, and `--typeset-flow`:
  - `standard` (default): `0.96875rem` (`15.5px`), leading `1.55`, flow `0.95rem`
  - `compact`: `0.90625rem` (`14.5px`), leading `1.48`, flow `0.75rem`
  - `relaxed`: `1.03125rem` (`16.5px`), leading `1.65`, flow `1.15rem`
- **Single-Direction Vertical Rhythm**: `.inkade-prose` removes `:last-child` and `:has()` lookahead selectors. Blocks set `margin-block-end: 0` and apply `margin-block-start` only on subsequent siblings (`> * + *`), preventing earlier blocks from jumping while streaming incremental Markdown or AI responses.
- **Isolation (`.not-typeset`)**: Embedded interactive cards, chips, and diagrams marked with `.not-typeset` reset font family/size/leading and are excluded from `.inkade-prose` descendant rules.

---

## 4. Optical Edge Fades, Header Liquid Tooltips & Sidebar Craft

- **`ScrollArea` (`opticalFade`)**: Keeps `scrollFade` backward-compatible while adding `opticalFade` (plus `opticalFadeTone`: `"background" | "sidebar" | "card" | "popover"`). Renders 24px top and bottom dual-layer overlays (`backdrop-blur-[1px]` + `backdrop-blur-[4px]` + surface gradient + linear mask) whose opacity scales linearly over `0–24px` scroll offset inside `requestAnimationFrame`.
- **`TopHeaderBar`**:
  - Shares one `TooltipCreateHandle<string>` inside `TooltipProvider` (`delay={80}`, `closeDelay={0}`) so moving between adjacent toolbar controls smoothly transitions a single tooltip.
  - Connects the theme toggle button to `applySurfaceThemeWithRipple` (`document.startViewTransition` radial `clip-path` expansion from click coordinates, falling back cleanly when unsupported or under reduced motion).
  - Drives its bottom edge fade (`data-slot="top-header-optical-fade"`) linearly across `0–24px` scroll offset via `--header-scroll-opacity`.
- **`WorkspaceSidebar`**:
  - `SidebarHoverPeek` remains mounted when enabled and transitions smoothly via `data-open` (`translateX` + `opacity` + `inert` when hidden).
  - Tag tree rows apply a subtle `-translate-y-px` group hover lift with asymmetric `--ease-bounce-return` settle.

---

## 5. Phase 17 Primitives (`@inkade/ui`)

1. **`ThinkingIndicator`** (`packages/ui/src/primitives/thinking-indicator.tsx`): 3×3 diagonal dot-wave matrix (`--duration-stagger`), optional shimmering label, optional `tabular-nums` `MM:SS` timer, and `data-motion-essential="pulse"`.
2. **`HoldConfirmButton`** (`packages/ui/src/primitives/hold-confirm-button.tsx`): Restrained resting surface with destructive hairline border, `2px` bottom progress rail via `requestAnimationFrame`, tactile micro-shake at `>= 85%` (`data-almost-ready="true"`), smooth early-release drain (`onCancel`), and keyboard `Space` / `Enter` hold support with `aria-valuenow`.
3. **`NumberTicker`** (`packages/ui/src/primitives/number-ticker.tsx`): Cubic ease-out rAF numeric transition + subtle WAAPI nudge, `tabular-nums`, `aria-live="polite"`, and instant update under reduced motion.
4. **`BucketMeter`** (`packages/ui/src/primitives/bucket-meter.tsx`): Proportional multi-segment capacity bar with interactive legend/segment hover & focus highlighting, `> 85%` / `>= 95%` amber/rose high-watermark warnings, and accessible labels/percentages.

---

## 6. Motion Lint Gate (`bun run check:motion`)

Enforced by `scripts/check-motion.ts` across `packages/ui/src` and `apps/web/src` (excluding tests):

1. Zero `transition-all` classes or `transition: all` declarations.
2. Zero raw arbitrary `duration-[...]` literals; arbitrary durations must reference semantic `--duration-*` CSS custom properties.
3. Every custom `@keyframes` declaration in CSS must be covered by `@media (prefers-reduced-motion: reduce)` and `html[data-motion="reduced-pulse"]`, with no unguarded `!important` animations bypassing reduced motion.
