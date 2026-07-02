import type { Env, RuntimeConfig } from "../env";
import { createAuditGist, slugify } from "../integrations/github";
import { callOpenRouterModel } from "../integrations/openrouter";

const FETCH_TIMEOUT_MS = 15000;
const MAX_HTML_CHARS = 400000;
const MAX_PAGE_TEXT_CHARS = 30000;

export const AUDIT_MODELS = [
  { id: "openai/gpt-5.5", name: "ChatGPT 5.5" },
  { id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6" }
] as const;

let canonicalAuditContextCache: string | null = null;

export interface ValidatorAuditRequest {
  url?: string;
  modelId?: string;
}

export function getAuditModelById(modelId?: string | null) {
  return AUDIT_MODELS.find((model) => model.id === modelId) ?? null;
}

export function validatePublicUrl(input?: string) {
  let parsed: URL;

  try {
    parsed = new URL((input || "").trim());
  } catch {
    return { ok: false as const, error: "Provide a valid absolute URL starting with http:// or https://." };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false as const, error: "Only public http:// and https:// URLs are supported." };
  }

  if (parsed.username || parsed.password) {
    return { ok: false as const, error: "Authenticated URLs are not allowed. Use a public page URL." };
  }

  if (isNonPublicHostname(parsed.hostname)) {
    return { ok: false as const, error: "That URL does not look public. Private, local, and internal hosts are blocked." };
  }

  return { ok: true as const, normalizedUrl: parsed.toString() };
}

export async function runValidatorAudit(env: Env, config: RuntimeConfig, input: ValidatorAuditRequest) {
  const validated = validatePublicUrl(input.url);
  if (!validated.ok) {
    return {
      ok: false,
      status: "INPUT_INVALID",
      error: validated.error
    };
  }

  const model = getAuditModelById(input.modelId || AUDIT_MODELS[0].id);
  if (!model) {
    return {
      ok: false,
      status: "INPUT_INVALID",
      error: "Unsupported model. Allowed values: ChatGPT 5.5 or Claude Opus 4.6.",
      allowed_models: AUDIT_MODELS
    };
  }

  const page = await fetchPublicPage(validated.normalizedUrl);
  const context = await loadCanonicalAuditContext(config);
  const systemPrompt = [
    context,
    "",
    "Return only the completed audit report. Follow the exact template from the canonical context."
  ].join("\n");

  const userPrompt = [
    "Run the canonical Post Fiat validator webpage audit on the following fetched page content.",
    `Audit Date: ${new Date().toISOString().slice(0, 10)}`,
    `Page URL: ${page.finalUrl}`,
    `Model: ${model.name} (${model.id})`,
    `Fetched Content-Type: ${page.contentType}`,
    "",
    "Fetched page text:",
    "============================================================",
    page.pageText,
    "============================================================"
  ].join("\n");

  const report = await callOpenRouterModel(env, config, model.id, systemPrompt, userPrompt, {
    maxTokens: 4500,
    temperature: 0.1
  });

  const gist = await createPublicValidatorAuditGist(env, config, {
    pageUrl: page.finalUrl,
    modelId: model.id,
    report
  });

  return {
    ok: true,
    status: "AUDIT_COMPLETE",
    requested_url: validated.normalizedUrl,
    final_url: page.finalUrl,
    model,
    gist,
    report
  };
}

async function loadCanonicalAuditContext(config: RuntimeConfig): Promise<string> {
  if (canonicalAuditContextCache) {
    return canonicalAuditContextCache;
  }

  const response = await fetch(config.validatorAuditContextUrl, {
    headers: {
      accept: "text/plain,text/markdown,*/*;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(`Canonical audit context fetch failed with HTTP ${response.status}.`);
  }

  canonicalAuditContextCache = (await response.text()).trim();
  return canonicalAuditContextCache;
}

async function createPublicValidatorAuditGist(
  env: Env,
  config: RuntimeConfig,
  input: { pageUrl: string; modelId: string; report: string }
) {
  const parsedUrl = new URL(input.pageUrl);
  const dateStamp = new Date().toISOString().slice(0, 10);
  const filename = `audit-${slugify(parsedUrl.hostname, "validator-page")}-${dateStamp}.md`;

  const gist = await createAuditGist(env, config, {
    description: `Validator webpage audit for ${input.pageUrl} via ${input.modelId}`,
    filename,
    content: input.report,
    public: true
  });

  const record = gist as { html_url?: string; id?: string };
  return {
    htmlUrl: record.html_url,
    id: record.id,
    filename
  };
}

async function fetchPublicPage(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "JournalNodeAuditBot/0.1",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5"
      }
    });

    if (!response.ok) {
      throw new Error(`The page could not be fetched. HTTP ${response.status} ${response.statusText}.`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!/(text\/html|application\/xhtml\+xml|text\/plain)/i.test(contentType)) {
      throw new Error(`Unsupported content type: ${contentType || "unknown"}. Submit a public webpage URL.`);
    }

    const raw = await response.text();
    const pageText = extractPageText(raw);
    if (!pageText) {
      throw new Error("The page was reachable but no readable text could be extracted.");
    }

    return {
      finalUrl: response.url || url,
      contentType,
      pageText
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The page fetch timed out. Submit a faster public URL.");
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Failed to fetch the submitted page.");
  } finally {
    clearTimeout(timeout);
  }
}

export function extractPageText(html: string): string {
  const title = extractTagContent(html, "title");
  const description = extractMetaDescription(html);
  const bodyText = htmlToPlainText(html);
  const parts: string[] = [];

  if (title) {
    parts.push(`Title: ${title}`);
  }

  if (description) {
    parts.push(`Meta Description: ${description}`);
  }

  if (bodyText) {
    parts.push(`Page Text:\n${bodyText}`);
  }

  return parts.join("\n\n").trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

function extractTagContent(html: string, tagName: string): string {
  const match = html.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeHtmlEntities(match[1].replace(/\s+/g, " ").trim()) : "";
}

function extractMetaDescription(html: string): string {
  const match =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i) ||
    html.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["'][^>]*>/i);
  return match ? decodeHtmlEntities(match[1].replace(/\s+/g, " ").trim()) : "";
}

function htmlToPlainText(html: string): string {
  const trimmed = String(html || "").slice(0, MAX_HTML_CHARS);
  const withoutHiddenBlocks = trimmed
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, " ");

  const structuralBreaks = withoutHiddenBlocks
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|aside|main|header|footer|nav|li|ul|ol|table|tr|td|th|h1|h2|h3|h4|h5|h6)>/gi, "\n");

  const withoutTags = structuralBreaks.replace(/<[^>]+>/g, " ").replace(/\r/g, "");

  return decodeHtmlEntities(withoutTags)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_PAGE_TEXT_CHARS);
}

function isPrivateIpv4(hostname: string): boolean {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) {
    return false;
  }

  const octets = match.slice(1).map(Number);
  if (octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = octets;
  return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "::1" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd");
}

function isNonPublicHostname(hostname: string): boolean {
  const normalized = (hostname || "").toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized === "localhost") {
    return true;
  }
  if (normalized.endsWith(".local") || normalized.endsWith(".internal") || normalized.endsWith(".lan") || normalized.endsWith(".home")) {
    return true;
  }
  if (isPrivateIpv4(normalized) || isPrivateIpv6(normalized)) {
    return true;
  }
  return !normalized.includes(".") && !normalized.includes(":");
}
