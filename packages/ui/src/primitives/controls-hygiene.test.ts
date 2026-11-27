import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, buttonVariants } from "./button.tsx";
import { Field, FieldLabel } from "./field.tsx";
import { Input } from "./input.tsx";
import { ScrollArea } from "./scroll-area.tsx";
import { SegmentedControl, SegmentedControlItem } from "./segmented-control.tsx";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./select.tsx";
import { Textarea } from "./textarea.tsx";

describe("controls-hygiene", () => {
  it("normalizes Button radii and replaces diffuse ring halo with crisp focus-visible outline", () => {
    const xsHtml = renderToStaticMarkup(
      React.createElement(Button, { size: "xs", variant: "outline" }, "Edit"),
    );
    const iconXsHtml = renderToStaticMarkup(
      React.createElement(Button, { size: "icon-xs", variant: "ghost", "aria-label": "Close" }, "x"),
    );

    expect(xsHtml).toContain("rounded-md");
    expect(xsHtml).not.toContain("rounded-sm");
    expect(xsHtml).toContain("focus-visible:outline-2");
    expect(xsHtml).toContain("var(--border-focus)");
    expect(xsHtml).not.toContain("ring-offset-1");
    expect(xsHtml).not.toContain("ring-2");
    expect(xsHtml).not.toContain("not-dark:bg-clip-padding");
    expect(xsHtml).not.toContain("before:shadow");

    expect(iconXsHtml).toContain("rounded-md");
    expect(iconXsHtml).not.toContain("rounded-sm");
    expect(iconXsHtml).not.toContain("ring-offset-1");
  });

  it("renders Input and Textarea with single-stroke focus border and supports xs + start/end addons", () => {
    const inputHtml = renderToStaticMarkup(
      React.createElement(Input, { placeholder: "Template name" }),
    );
    const xsAddonInputHtml = renderToStaticMarkup(
      React.createElement(Input, {
        placeholder: "Filter...",
        size: "xs",
        startAddon: React.createElement("span", null, "#"),
        endAddon: React.createElement("button", { type: "button" }, "x"),
      }),
    );
    const textareaHtml = renderToStaticMarkup(
      React.createElement(Textarea, { placeholder: "Notes" }),
    );

    for (const html of [inputHtml, textareaHtml]) {
      expect(html).toContain("var(--border-focus)");
      expect(html).not.toContain("has-focus-visible:ring-2");
      expect(html).not.toContain("ring-ring/25");
      expect(html).not.toContain("not-dark:bg-clip-padding");
      expect(html).not.toContain("before:shadow");
    }

    expect(xsAddonInputHtml).toContain('data-size="xs"');
    expect(xsAddonInputHtml).toContain("sm:h-5.5");
    expect(xsAddonInputHtml).toContain('data-slot="input-start-addon"');
    expect(xsAddonInputHtml).toContain('data-slot="input-end-addon"');
    expect(xsAddonInputHtml).toContain("ps-1.5");
    expect(xsAddonInputHtml).toContain("pe-1.5");
  });

  it("renders SegmentedControl with concentric item radii, sm height parity, and single-stroke indicator", () => {
    const segmentedHtml = renderToStaticMarkup(
      React.createElement(
        SegmentedControl,
        { size: "sm" },
        React.createElement(SegmentedControlItem, { "aria-current": "page" }, "Today"),
        React.createElement(SegmentedControlItem, null, "Tonight"),
      ),
    );

    expect(segmentedHtml).toContain("rounded-[calc(var(--radius-md)-2px)]");
    expect(segmentedHtml).toContain("border-border/90");
    expect(segmentedHtml).toContain("sm:h-6");
    expect(segmentedHtml).not.toContain("ring-1");
    expect(segmentedHtml).not.toContain("ring-2");
  });

  it("renders SelectTrigger cleanly without ring halo and preserves concentric menu-item & viewport contracts", () => {
    const selectHtml = renderToStaticMarkup(
      React.createElement(
        Select,
        { defaultValue: "article" },
        React.createElement(
          SelectTrigger,
          null,
          React.createElement(SelectValue, { placeholder: "Kind" }),
        ),
        React.createElement(
          SelectPopup,
          null,
          React.createElement(SelectItem, { value: "article" }, "article"),
        ),
      ),
    );

    expect(selectHtml).toContain("var(--border-focus)");
    expect(selectHtml).not.toContain("ring-2");
    expect(selectHtml).not.toContain("ring-offset-1");
    expect(selectHtml).not.toContain("not-dark:bg-clip-padding");
    expect(selectHtml).not.toContain("before:shadow");
    expect(typeof SelectPopup).toBe("function");

    const primitivesDir = import.meta.dir;
    const selectSource = readFileSync(join(primitivesDir, "select.tsx"), "utf8");
    const menuSource = readFileSync(join(primitivesDir, "menu.tsx"), "utf8");
    const popoverSource = readFileSync(join(primitivesDir, "popover.tsx"), "utf8");

    expect(selectSource).toContain("rounded-[var(--radius-menu-item)]");
    expect(menuSource).toContain("rounded-[var(--radius-menu-item)]");
    expect(popoverSource).toContain("viewportClassName");
    expect(popoverSource).not.toContain("**:data-current:w-[");
  });

  it("enforces V4.4 Textarea grid display, Field 6px rhythm, Button Kbd foreground inheritance, and ScrollArea hooks", () => {
    const fieldHtml = renderToStaticMarkup(
      React.createElement(
        Field,
        null,
        React.createElement(FieldLabel, null, "Notes"),
        React.createElement(Textarea, { placeholder: "Notes" }),
      ),
    );
    expect(fieldHtml).toContain("gap-1.5");
    expect(fieldHtml).toContain("sm:text-sm/5");
    expect(fieldHtml).toContain("relative grid w-full");
    expect(fieldHtml).not.toContain("inline-grid");

    const primaryKbdCls = buttonVariants({ size: "xs", variant: "default" });
    const destructiveCls = buttonVariants({ variant: "destructive" });
    expect(primaryKbdCls).toContain("[&_[data-slot=kbd]]:text-current");
    expect(primaryKbdCls).toContain("[&_[data-slot=kbd]]:h-4");
    expect(destructiveCls).toContain("[&_[data-slot=kbd]]:text-current");

    const scrollHtml = renderToStaticMarkup(
      React.createElement(
        ScrollArea,
        { onViewportScroll: () => {}, viewportClassName: "qa-vp" },
        React.createElement("div", null, "Body"),
      ),
    );
    expect(scrollHtml).toContain("qa-vp");
  });

  it("enforces V4.5 Popover content wrapper, Dialog/Sheet/Drawer form flex containment, and ImageInsertDialog sibling footer", () => {
    const primitivesDir = import.meta.dir;
    const popoverSource = readFileSync(join(primitivesDir, "popover.tsx"), "utf8");
    const dialogSource = readFileSync(join(primitivesDir, "dialog.tsx"), "utf8");
    const sheetSource = readFileSync(join(primitivesDir, "sheet.tsx"), "utf8");
    const drawerSource = readFileSync(join(primitivesDir, "drawer.tsx"), "utf8");
    const imageDialogSource = readFileSync(
      join(primitivesDir, "..", "editor", "menus", "ImageInsertDialog.tsx"),
      "utf8",
    );

    expect(popoverSource).toContain('data-slot="popover-content"');
    expect(popoverSource).toContain("flex min-h-full w-full flex-col");

    for (const overlaySource of [dialogSource, sheetSource]) {
      expect(overlaySource).toContain("overflow-hidden");
      expect(overlaySource).toContain(
        "[&>form]:flex [&>form]:min-h-0 [&>form]:flex-1 [&>form]:flex-col",
      );
      expect(overlaySource).toContain('<ScrollArea className="min-h-0 flex-1"');
    }

    expect(drawerSource).toContain(
      "[&>form]:flex [&>form]:min-h-0 [&>form]:flex-1 [&>form]:flex-col",
    );
    expect(drawerSource).toContain("data-nested-drawer-open:overflow-hidden");
    expect(drawerSource).not.toContain('"relative flex max-h-full min-h-0 w-full min-w-0 flex-col overflow-hidden');
    expect(drawerSource).toContain("min-h-0 flex-1 touch-auto");

    const panelCloseIndex = imageDialogSource.indexOf("</DialogPanel>");
    const footerStartIndex = imageDialogSource.indexOf("<DialogFooter");
    const formCloseIndex = imageDialogSource.lastIndexOf("</form>");
    expect(panelCloseIndex).toBeGreaterThan(-1);
    expect(footerStartIndex).toBeGreaterThan(panelCloseIndex);
    expect(formCloseIndex).toBeGreaterThan(footerStartIndex);
  });

  it("enforces V4.6 outliner left-gutter handle, unclipped 1px inset highlight stroke, and mobile bulk-bar placement", () => {
    const primitivesDir = import.meta.dir;
    const outlineEditorDir = join(primitivesDir, "..", "patterns", "outline-editor");
    const outlinerSource = [
      readFileSync(join(primitivesDir, "..", "patterns", "ProseMirrorOutlineEditor.tsx"), "utf8"),
      ...readdirSync(outlineEditorDir)
        .filter((f) => /\.(ts|tsx)$/.test(f))
        .map((f) => readFileSync(join(outlineEditorDir, f), "utf8")),
    ].join("\n");
    const libraryPageSource = readFileSync(
      join(primitivesDir, "..", "..", "..", "views", "src", "views", "DocumentListView.tsx"),
      "utf8",
    );

    expect(outlinerSource).toContain('data-outline-handle');
    expect(outlinerSource).toContain('data-inkade-node-menu="true"');
    expect(outlinerSource).not.toContain("inkade-pm-actions");
    expect(outlinerSource).toContain(
      "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_48%,transparent)]",
    );
    expect(outlinerSource).not.toContain("ring-2 ring-primary/60");

    expect(libraryPageSource).toContain('data-testid="library-bulk-bar"');
    expect(libraryPageSource).toContain("bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))]");
  });
});
