/** Anthropic server-side web-search tool block. */
export function webSearchTool(maxUses: number): {
  type: string;
  name: string;
  max_uses: number;
} {
  return { type: 'web_search_20250305', name: 'web_search', max_uses: maxUses };
}
