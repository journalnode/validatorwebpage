import type { Env, RuntimeConfig } from "../env";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | OpenRouterContentPart[];
}

export type OpenRouterContentPart =
  | string
  | {
      type?: string;
      text?: string | OpenRouterContentPart[];
      content?: string | OpenRouterContentPart[];
      image_url?: { url: string };
    };

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
): Promise<string> {
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

  const body = await parseOpenRouterResponse(response);
  return extractOpenRouterContent(body);
}

export async function callOpenRouterModel(
  env: Env,
  config: RuntimeConfig,
  modelId: string,
  systemPrompt: string,
  userMessage: string,
  options: { maxTokens?: number; temperature?: number; imageBase64?: string; imageUrl?: string } = {}
): Promise<string> {
  return createOpenRouterChatCompletion(env, config, {
    model: modelId,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildMessageContent(userMessage, options) }
    ],
    max_tokens: options.maxTokens ?? 500,
    temperature: options.temperature
  });
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

function buildMessageContent(
  userMessage: string,
  options: { imageBase64?: string; imageUrl?: string } = {}
): string | OpenRouterContentPart[] {
  if (options.imageBase64) {
    return [
      { type: "text", text: userMessage },
      { type: "image_url", image_url: { url: `data:image/png;base64,${options.imageBase64}` } }
    ];
  }

  if (options.imageUrl) {
    return [
      { type: "text", text: userMessage },
      { type: "image_url", image_url: { url: options.imageUrl } }
    ];
  }

  return userMessage;
}

export function extractOpenRouterContent(data: unknown): string {
  const record = data as {
    choices?: Array<{
      message?: { content?: unknown };
      text?: unknown;
    }>;
  };
  const choice = record.choices?.[0] ?? null;
  const content = choice?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (content && typeof content === "object" && !Array.isArray(content)) {
    const text = extractTextFromContentPart(content).trim();
    if (text) {
      return text;
    }
  }

  if (Array.isArray(content)) {
    const text = content.map(extractTextFromContentPart).filter(Boolean).join("\n").trim();
    if (text) {
      return text;
    }
  }

  if (typeof choice?.text === "string" && choice.text.trim()) {
    return choice.text.trim();
  }

  const contentType = Array.isArray(content) ? "array" : typeof content;
  const partTypes = Array.isArray(content)
    ? content.map((part) => (part && typeof part === "object" ? (part as { type?: string }).type ?? typeof part : typeof part)).join(", ")
    : "";
  const choiceKeys = choice && typeof choice === "object" ? Object.keys(choice).join(", ") : "";

  throw new Error(
    `OpenRouter returned an unexpected response shape. contentType=${contentType || "undefined"}; ` +
      `partTypes=${partTypes || "n/a"}; choiceKeys=${choiceKeys || "n/a"}`
  );
}

function extractTextFromContentPart(part: unknown): string {
  if (!part) {
    return "";
  }

  if (typeof part === "string") {
    return part;
  }

  if (typeof part !== "object") {
    return "";
  }

  const record = part as {
    type?: string;
    text?: string | OpenRouterContentPart[];
    content?: string | OpenRouterContentPart[];
  };
  if (typeof record.type === "string" && /reasoning/i.test(record.type)) {
    return "";
  }

  if (typeof record.text === "string") {
    return record.text;
  }

  if (typeof record.content === "string") {
    return record.content;
  }

  if (Array.isArray(record.text)) {
    return record.text.map(extractTextFromContentPart).filter(Boolean).join("\n");
  }

  if (Array.isArray(record.content)) {
    return record.content.map(extractTextFromContentPart).filter(Boolean).join("\n");
  }

  return "";
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
