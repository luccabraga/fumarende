import { describe, expect, it } from 'vitest';
import { webSearchTool } from './web-search.js';

describe('webSearchTool', () => {
  it('builds the web_search tool block', () => {
    expect(webSearchTool(3)).toEqual({
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 3,
    });
  });
});
