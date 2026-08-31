import type { AiConfig } from '../config.js';

export class ClaudeNotConfiguredError extends Error {
  constructor() {
    super('Anthropic API key is not configured');
    this.name = 'ClaudeNotConfiguredError';
  }
}

export class ClaudeUpstreamError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null,
  ) {
    super(message);
    this.name = 'ClaudeUpstreamError';
  }
}

export interface ClaudeResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  webSearchRequests: number;
}

/** A single Anthropic message content block (text, document, image, …). */
export type ContentBlock = { type: string; [k: string]: unknown };

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

export async function callClaude(
  cfg: AiConfig,
  args: { system: string; user: string | ContentBlock[]; maxTokens?: number; tools?: unknown[] },
  fetchImpl: typeof fetch = fetch,
): Promise<ClaudeResult> {
  if (cfg.apiKey === null) throw new ClaudeNotConfiguredError();

  let res: Response;
  try {
    res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: args.maxTokens ?? 1200,
        system: args.system,
        messages: [{ role: 'user', content: args.user }],
        ...(args.tools ? { tools: args.tools } : {}),
      }),
    });
  } catch (err) {
    throw new ClaudeUpstreamError(err instanceof Error ? err.message : String(err), null);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ClaudeUpstreamError(`Anthropic ${res.status}: ${body.slice(0, 500)}`, res.status);
  }

  const json = (await res.json()) as {
    content?: { type: string; text?: string }[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      server_tool_use?: { web_search_requests?: number };
    };
  };
  const text = (json.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
  return {
    text,
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
    webSearchRequests: json.usage?.server_tool_use?.web_search_requests ?? 0,
  };
}
