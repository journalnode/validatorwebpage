import type { Env, RuntimeConfig } from "../env";

export interface CreateGistInput {
  filename: string;
  content: string;
  description: string;
  public?: boolean;
}

export async function createAuditGist(
  env: Env,
  config: RuntimeConfig,
  input: CreateGistInput
): Promise<unknown> {
  if (!env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is not configured");
  }

  const response = await fetch(`${config.githubApiBaseUrl}/gists`, {
    method: "POST",
    headers: githubHeaders(env.GITHUB_TOKEN, config),
    body: JSON.stringify({
      description: input.description,
      public: input.public ?? config.gistPublic,
      files: {
        [input.filename]: {
          content: input.content
        }
      }
    })
  });

  const body = await readJsonOrText(response);

  if (response.status !== 201) {
    throw new Error(`GitHub gist creation failed with ${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

export async function checkGitHubAuth(env: Env, config: RuntimeConfig): Promise<Record<string, unknown>> {
  if (!env.GITHUB_TOKEN) {
    return {
      ok: false,
      configured: false,
      status: null
    };
  }

  const response = await fetch(`${config.githubApiBaseUrl}/user`, {
    method: "GET",
    headers: githubHeaders(env.GITHUB_TOKEN, config)
  });

  const body = await readJsonOrText(response);
  const scopes = response.headers.get("x-oauth-scopes");

  return {
    ok: response.ok,
    configured: true,
    status: response.status,
    login: typeof body === "object" && body !== null ? (body as Record<string, unknown>).login : null,
    gist_scope_present: scopes ? scopes.split(",").map((scope) => scope.trim()).includes("gist") : null
  };
}

function githubHeaders(token: string, config: RuntimeConfig): HeadersInit {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "user-agent": "journalnode-projaudit-worker",
    "x-github-api-version": config.githubApiVersion
  };
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
