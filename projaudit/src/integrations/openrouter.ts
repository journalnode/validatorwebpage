import type { Env, RuntimeConfig } from "../env";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

export async function createOpenRouterChatCompletion(
  env: Env,
  config: RuntimeConfig,
  request: OpenRouterChatRequest
): Promise<unknown> {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const response = await fetch(`${config.openRouterBaseUrl}/chat/completions`, {
    method: "POST",
    headers: openRouterHeaders(env.OPENROUTER_API_KEY, config),
    body: JSON.stringify({
      model: request.model ?? config.openRouterModel,
      messages: request.messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.max_tokens,
      stream: false
    })
  });

  return parseOpenRouterResponse(response);
}

export async function checkOpenRouterAuth(env: Env, config: RuntimeConfig): Promise<Record<string, unknown>> {
  if (!env.OPENROUTER_API_KEY) {
    return {
      ok: false,
      configured: false,
      status: null
    };
  }

  const response = await fetch(`${config.openRouterBaseUrl}/auth/key`, {
    method: "GET",
    headers: openRouterHeaders(env.OPENROUTER_API_KEY, config)
  });

  const body = await readJsonOrText(response);

  return {
    ok: response.ok,
    configured: true,
    status: response.status,
    model: config.openRouterModel,
    response: summarizeAuthBody(body)
  };
}

function openRouterHeaders(apiKey: string, config: RuntimeConfig): HeadersInit {
  return {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "http-referer": config.openRouterSiteUrl,
    "x-title": config.openRouterAppTitle
  };
}

async function parseOpenRouterResponse(response: Response): Promise<unknown> {
  const body = await readJsonOrText(response);

  if (!response.ok) {
    throw new Error(`OpenRouter request failed with ${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

async function readJsonOrText(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function summarizeAuthBody(body: unknown): Record<string, unknown> | string | null {
  if (!body || typeof body !== "object") {
    return body as string | null;
  }

  const record = body as Record<string, unknown>;
  return {
    label: record.label,
    usage: record.usage,
    limit: record.limit,
    is_free_tier: record.is_free_tier
  };
}
