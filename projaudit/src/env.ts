export interface Env {
  APP_ENV?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BASE_URL?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_SITE_URL?: string;
  OPENROUTER_APP_TITLE?: string;
  GITHUB_TOKEN?: string;
  GITHUB_API_BASE_URL?: string;
  GITHUB_API_VERSION?: string;
  GIST_PUBLIC?: string;
}

export interface RuntimeConfig {
  appEnv: string;
  openRouterBaseUrl: string;
  openRouterModel: string;
  openRouterSiteUrl: string;
  openRouterAppTitle: string;
  githubApiBaseUrl: string;
  githubApiVersion: string;
  gistPublic: boolean;
}

export function getConfig(env: Env): RuntimeConfig {
  return {
    appEnv: env.APP_ENV ?? "development",
    openRouterBaseUrl: trimTrailingSlash(env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1"),
    openRouterModel: env.OPENROUTER_MODEL ?? "openai/gpt-5.2",
    openRouterSiteUrl: env.OPENROUTER_SITE_URL ?? "https://pft.wizbubba.xyz",
    openRouterAppTitle: env.OPENROUTER_APP_TITLE ?? "Journal Node ProjAudit",
    githubApiBaseUrl: trimTrailingSlash(env.GITHUB_API_BASE_URL ?? "https://api.github.com"),
    githubApiVersion: env.GITHUB_API_VERSION ?? "2022-11-28",
    gistPublic: (env.GIST_PUBLIC ?? "true").toLowerCase() === "true"
  };
}

export function getSecretStatus(env: Env) {
  return {
    openrouter_api_key: Boolean(env.OPENROUTER_API_KEY),
    github_token: Boolean(env.GITHUB_TOKEN)
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
