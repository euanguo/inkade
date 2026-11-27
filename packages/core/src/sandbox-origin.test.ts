import { describe, expect, test } from "bun:test";
import {
  ARTIFACT_HTML_MAX_BYTES,
  buildSandboxArtifactOrigin,
  buildSandboxCspHeader,
  extractArtifactBlocks,
  extractRegistrableSite,
  formatInkadeArtifactFence,
  markdownToPlainText,
  matchesSandboxHostname,
  parseInkadeArtifactPayload,
  replaceInkadeArtifactFencesWithFallback,
  sanitizeExtraFrameAncestors,
  validateArtifactHtml,
  validateDualOriginConfig,
} from "./index.ts";

describe("Phase 51 sandbox-origin & artifact helpers", () => {
  test("extractRegistrableSite classifies standard TLDs, multi-label suffixes, loopback, wildcard DNS, and local suffixes", () => {
    expect(extractRegistrableSite("notes.example.com")).toBe("example.com");
    expect(extractRegistrableSite("sub.sandbox.example.co.uk")).toBe("example.co.uk");
    expect(extractRegistrableSite("app.example.com.cn")).toBe("example.com.cn");

    expect(extractRegistrableSite("localhost")).toBe("localhost");
    expect(extractRegistrableSite("art_abc.sandbox.localhost")).toBe("localhost");
    expect(extractRegistrableSite("127.0.0.1")).toBe("127.0.0.1");
    expect(extractRegistrableSite("::1")).toBe("::1");

    expect(extractRegistrableSite("app.127.0.0.1.nip.io")).toBe("1.nip.io");
    expect(extractRegistrableSite("sandbox.192.168.1.5.sslip.io")).toBe("5.sslip.io");
    expect(extractRegistrableSite("notes.home.arpa")).toBe("notes.home.arpa");
    expect(extractRegistrableSite("inkade.local")).toBe("inkade.local");
    expect(extractRegistrableSite("192.168.1.42")).toBe("192.168.1.42");
  });

  test("validateDualOriginConfig enforces distinct sites unless sameSiteOptIn=true", () => {
    const dev = validateDualOriginConfig({
      appOrigin: "http://localhost:3456",
    });
    expect(dev.mode).toBe("dev_localhost");
    expect(dev.sandboxOriginPattern).toBe("http://{id}.sandbox.localhost:3456");

    const prodIsolated = validateDualOriginConfig({
      appOrigin: "https://inkade.example.com",
      sandboxOrigin: "https://*.inkade-sandbox.net",
    });
    expect(prodIsolated.mode).toBe("dual_origin");
    expect(
      buildSandboxArtifactOrigin("art_xyz123", {
        appOrigin: prodIsolated.appOrigin,
        sandboxOrigin: prodIsolated.sandboxOriginPattern,
      }).origin,
    ).toBe("https://art-xyz123.inkade-sandbox.net");

    expect(() =>
      validateDualOriginConfig({
        appOrigin: "https://app.example.com",
        sandboxOrigin: "https://*.sandbox.example.com",
      }),
    ).toThrow(/same-site|distinct|sandbox/i);

    const prodSameSite = validateDualOriginConfig({
      appOrigin: "https://app.example.com",
      sandboxOrigin: "https://*.sandbox.example.com",
      sameSiteOptIn: true,
    });
    expect(prodSameSite.mode).toBe("same_site");
  });

  test("matchesSandboxHostname rejects *.sandbox.localhost for production non-loopback appOrigin", () => {
    expect(
      matchesSandboxHostname(
        "art_1.sandbox.localhost",
        "http://*.sandbox.localhost:3456",
        "localhost",
      ),
    ).toBe(true);
    expect(
      matchesSandboxHostname(
        "art_1.sandbox.localhost",
        "https://*.sandbox-static.net",
        "inkade.example.com",
      ),
    ).toBe(false);
    expect(
      matchesSandboxHostname(
        "art_1.sandbox-static.net",
        "https://*.sandbox-static.net",
        "inkade.example.com",
      ),
    ).toBe(true);
  });

  test("buildSandboxCspHeader strictly locks down network origins", () => {
    const strictCsp = buildSandboxCspHeader({
      appOrigin: "https://app.example.com",
    });
    expect(strictCsp).toContain("default-src 'none'");
    expect(strictCsp).toContain("connect-src 'none'");
    expect(strictCsp).toContain("frame-ancestors https://app.example.com");
    expect(strictCsp).toContain("form-action 'none'");
    expect(strictCsp).toContain("base-uri 'none'");

    const allowlistCsp = buildSandboxCspHeader({
      appOrigin: "https://app.example.com",
      allowedHttpsOrigins: ["https://api.weather.gov", "http://insecure.example"],
    });
    expect(allowlistCsp).toContain("connect-src https://api.weather.gov");
    expect(allowlistCsp).not.toContain("insecure.example");

    const loopbackCsp = buildSandboxCspHeader({
      appOrigin: "http://localhost:3499",
      sameSite: false,
      extraFrameAncestors: sanitizeExtraFrameAncestors(
        "http://localhost:5173 https://ade.example.com 'self' javascript:alert(1) http://evil.example/bad capacitor://localhost",
      ),
    });
    expect(loopbackCsp).toContain("http://localhost:3499");
    expect(loopbackCsp).toContain("http://127.0.0.1:3499");
    expect(loopbackCsp).toContain("http://[::1]:3499");
    expect(loopbackCsp).toContain("http://localhost:5173");
    expect(loopbackCsp).toContain("https://ade.example.com");
    expect(loopbackCsp).toContain("'self'");
    expect(loopbackCsp).not.toContain("javascript:");
    expect(loopbackCsp).not.toContain("evil.example");
    expect(loopbackCsp).not.toContain("capacitor:");
  });

  test("validateArtifactHtml preserves https:// URLs in JS strings and ignores comments", () => {
    const tooBig = `<!DOCTYPE html><html><head><title>Big</title></head><body>${"x".repeat(ARTIFACT_HTML_MAX_BYTES + 10)}</body></html>`;
    expect(validateArtifactHtml(tooBig, {}).valid).toBe(false);

    const noTitle = "<!DOCTYPE html><html><body><p>hi</p></body></html>";
    expect(validateArtifactHtml(noTitle, {}).valid).toBe(false);

    const externalScript =
      '<!DOCTYPE html><html><head><title>Bad</title><script src="https://cdn.example/x.js"></script></head><body></body></html>';
    expect(validateArtifactHtml(externalScript, {}).valid).toBe(false);

    const hiddenFetchWithScheme =
      '<!DOCTYPE html><html><head><title>Fetch</title></head><body><script>fetch("https://evil.example/api");</script></body></html>';
    const hiddenFetchRes = validateArtifactHtml(hiddenFetchWithScheme, { network: "none" });
    expect(hiddenFetchRes.valid).toBe(false);
    expect(hiddenFetchRes.errors.join(" ")).toContain("without declaring it in capabilities.network");

    const commentOnlyFetch =
      '<!DOCTYPE html><html><head><title>Safe</title></head><body><script>// Example: fetch("https://evil.example")\nwindow.inkade?.use("theme");</script></body></html>';
    const safeRes = validateArtifactHtml(commentOnlyFetch, { theme: true, network: "none" });
    expect(safeRes.valid).toBe(true);
    expect(safeRes.warnings).toHaveLength(0);
  });

  test("inkade-artifact markdown fences parse, index title, skip excerpt, and replace with fallback", () => {
    const fence = formatInkadeArtifactFence({
      id: "art_calc1",
      title: "Compound Interest",
      height: 480,
    });
    expect(parseInkadeArtifactPayload("id: art_calc1\ntitle: Compound Interest\nheight: 480")).toEqual({
      id: "art_calc1",
      title: "Compound Interest",
      height: 480,
    });

    const docMd = [
      "# Overview",
      "",
      fence,
      "",
      "```markdown",
      "```inkade-artifact",
      "id: art_nested_example",
      "```",
      "```",
      "",
      "Tail paragraph.",
    ].join("\n");

    const extracted = extractArtifactBlocks(docMd);
    expect(extracted.map((b) => b.id)).toEqual(["art_calc1"]);

    expect(markdownToPlainText(docMd)).toContain("Compound Interest");
    expect(markdownToPlainText(docMd, { skipCodeBlocks: true })).not.toContain("Compound Interest");

    const degraded = replaceInkadeArtifactFencesWithFallback(
      docMd,
      new Map([
        [
          "art_calc1",
          {
            title: "Compound Interest",
            fallbackMarkdown: "| Year | Balance |\n| --- | --- |\n| 1 | $1,050 |",
          },
        ],
      ]),
    );
    expect(degraded).toContain("| Year | Balance |");
    expect(degraded).not.toContain("id: art_calc1");
    expect(degraded).toContain("Tail paragraph.");
  });
});
