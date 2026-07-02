import { getConfig, getSecretStatus, type Env } from "./env";
import { checkGitHubAuth } from "./integrations/github";
import { checkOpenRouterAuth } from "./integrations/openrouter";
import { json, methodNotAllowed, notFound } from "./http";
import { createScaffoldAuditResponse, type ProjAuditRequest } from "./projaudit/module";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const config = getConfig(env);
    const url = new URL(request.url);
    const pathname = normalizePath(url.pathname);

    if (pathname === "/" || pathname === "/projaudit" || pathname === "/projaudit/") {
      return json({
        ok: true,
        service: "journalnode-projaudit",
        app_env: config.appEnv,
        routes: ["/health", "/projaudit/health", "/projaudit/integrations", "/projaudit/audit"]
      });
    }

    if (pathname === "/health" || pathname === "/projaudit/health" || pathname === "/projaudit/api/health") {
      if (request.method !== "GET") {
        return methodNotAllowed(["GET"]);
      }

      return json({
        ok: true,
        service: "journalnode-projaudit",
        version: "v0.2.0-scaffold",
        app_env: config.appEnv,
        timestamp: new Date().toISOString(),
        runtime: "cloudflare-workers",
        secrets: getSecretStatus(env),
        audit_logic: "not_implemented"
      });
    }

    if (pathname === "/projaudit/integrations" || pathname === "/projaudit/api/integrations") {
      if (request.method !== "GET") {
        return methodNotAllowed(["GET"]);
      }

      const [openrouter, github] = await Promise.all([
        checkOpenRouterAuth(env, config),
        checkGitHubAuth(env, config)
      ]);

      return json({
        ok: Boolean(openrouter.ok && github.ok),
        service: "journalnode-projaudit",
        app_env: config.appEnv,
        checks: {
          openrouter,
          github
        }
      });
    }

    if (pathname === "/projaudit/audit" || pathname === "/projaudit/api/audit") {
      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }

      const body = await readJsonBody<ProjAuditRequest>(request);

      return json(createScaffoldAuditResponse(env, config, body), { status: 501 });
    }

    return notFound(pathname);
  }
};

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

async function readJsonBody<T>(request: Request): Promise<T | null> {
  const text = await request.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
