declare module "micromark-extension-wiki-link" {
  export interface MicromarkWikiLinkOptions {
    readonly aliasDivider?: string | undefined;
    readonly permalinks?: readonly string[] | undefined;
  }
  export function syntax(options?: MicromarkWikiLinkOptions): Record<string, unknown>;
}
