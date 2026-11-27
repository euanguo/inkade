import { describe, expect, it } from "bun:test";
import { parseEmbedConfigFromSearch } from "./embed-config.ts";

describe("parseEmbedConfigFromSearch", () => {
  it("resolves chrome=minimal and chrome=none presets plus additive hide targets", () => {
    const minimal = parseEmbedConfigFromSearch("?embed=1&chrome=minimal&theme=dark&density=compact&readonly=1&host=Cursor");
    expect(minimal.embed).toBe(true);
    expect(minimal.chrome).toBe("minimal");
    expect(minimal.hideSidebar).toBe(true);
    expect(minimal.hideMobileNav).toBe(true);
    expect(minimal.hideTopbar).toBe(false);
    expect(minimal.hideInspector).toBe(false);
    expect(minimal.themeOverride).toBe("dark");
    expect(minimal.density).toBe("compact");
    expect(minimal.readonly).toBe(true);
    expect(minimal.hostId).toBe("cursor");

    const custom = parseEmbedConfigFromSearch("?embed=1&hide=sidebar,topbar,fab");
    expect(custom.hideSidebar).toBe(true);
    expect(custom.hideTopbar).toBe(true);
    expect(custom.hideFab).toBe(true);
    expect(custom.hideInspector).toBe(false);

    const none = parseEmbedConfigFromSearch("?chrome=none");
    expect(none.embed).toBe(true);
    expect(none.hideSidebar).toBe(true);
    expect(none.hideTopbar).toBe(true);
    expect(none.hideInspector).toBe(true);
    expect(none.hideMobileNav).toBe(true);
    expect(none.hideQuickCapture).toBe(true);
  });

  it("preserves prior session embed config across in-app navigation and resets on ?embed=0", () => {
    const first = parseEmbedConfigFromSearch("?embed=1&hide=sidebar&density=compact&host=cindy");
    const navigated = parseEmbedConfigFromSearch("", first);
    expect(navigated.embed).toBe(true);
    expect(navigated.hideSidebar).toBe(true);
    expect(navigated.density).toBe("compact");
    expect(navigated.hostId).toBe("cindy");
    expect(navigated.embedTicket).toBeNull();

    const exited = parseEmbedConfigFromSearch("?embed=0", first);
    expect(exited.embed).toBe(false);
    expect(exited.hideSidebar).toBe(false);
    expect(exited.chrome).toBe("full");
  });

  it("clears computed hidden targets when switching from chrome=none to chrome=minimal", () => {
    const none = parseEmbedConfigFromSearch("?embed=1&chrome=none");
    expect(none.hideTopbar).toBe(true);
    expect(none.hideInspector).toBe(true);

    const minimal = parseEmbedConfigFromSearch("?embed=1&chrome=minimal", none);
    expect(minimal.chrome).toBe("minimal");
    expect(minimal.hideSidebar).toBe(true);
    expect(minimal.hideMobileNav).toBe(true);
    expect(minimal.hideTopbar).toBe(false);
    expect(minimal.hideInspector).toBe(false);

    const full = parseEmbedConfigFromSearch("?embed=1&chrome=full", minimal);
    expect(full.chrome).toBe("full");
    expect(full.hideSidebar).toBe(false);
    expect(full.hideTopbar).toBe(false);
  });
});
