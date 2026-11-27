import type { AdeKind, SelectionAnchor } from "@inkade/core";

export interface McpSnippetOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly serverName?: string | undefined;
}

export function buildMcpConfigSnippet(options: McpSnippetOptions): string {
  const cleanBase = options.baseUrl.replace(/\/+$/, "");
  const serverName = options.serverName?.trim() || "inkade";
  const payload = {
    mcpServers: {
      [serverName]: {
        type: "http",
        url: `${cleanBase}/mcp`,
        headers: {
          Authorization: `Bearer ${options.token}`,
        },
      },
    },
  };
  return JSON.stringify(payload, null, 2);
}

export interface AdePromptOptions {
  readonly adeKind: AdeKind;
  readonly documentTitle: string;
  readonly documentId: string;
  readonly nodeId?: string | null | undefined;
  readonly excerpt: string;
  readonly selectionAnchor?: SelectionAnchor | null | undefined;
  readonly instruction?: string | undefined;
}

export function buildAdeDispatchPrompt(options: AdePromptOptions): string {
  const lines: string[] = [
    `[Inkade Context · ${options.adeKind.toUpperCase()}]`,
    `Document: ${options.documentTitle} (${options.documentId})`,
  ];
  if (options.nodeId) {
    lines.push(`Outline Node: ${options.nodeId}`);
  }
  if (options.selectionAnchor?.headingSlug) {
    lines.push(`Section: #${options.selectionAnchor.headingSlug}`);
  }
  if (options.excerpt.trim()) {
    lines.push("", "Excerpt:", `> ${options.excerpt.trim()}`);
  }
  if (options.instruction?.trim()) {
    lines.push("", "Task:", options.instruction.trim());
  }
  return lines.join("\n");
}
