import { getConfig, getSecretStatus, type Env } from "./env";
import { AUDIT_MODELS, runValidatorAudit, type ValidatorAuditRequest } from "./audit/validator";
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
        routes: [
          "/health",
          "/audit/health",
          "/audit/run",
          "/projaudit/health",
          "/projaudit/integrations",
          "/projaudit/audit"
        ]
      });
    }

    if (
      pathname === "/health" ||
      pathname === "/api/health" ||
      pathname === "/audit/health" ||
      pathname === "/audit/api/health" ||
      pathname === "/projaudit/health" ||
      pathname === "/projaudit/api/health"
    ) {
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
        audit: {
          status: "ported_from_tasknode_agent",
          models: AUDIT_MODELS
        },
        projaudit: {
          status: "scaffold_only"
        }
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

    if (pathname === "/audit/run" || pathname === "/audit/api/run" || pathname === "/api/audit") {
      if (request.method !== "POST") {
        return methodNotAllowed(["POST"]);
      }

      if (!env.OPENROUTER_API_KEY || !env.GITHUB_TOKEN) {
        return json(
          {
            ok: false,
            status: "INTEGRATION_NOT_CONFIGURED",
            message:
              "The /audit engine is hosted, but OPENROUTER_API_KEY and GITHUB_TOKEN Worker secrets must be configured before running audits.",
            secrets: getSecretStatus(env)
          },
          { status: 503 }
        );
      }

      const body = await readJsonBody<ValidatorAuditRequest>(request);
      const result = await runValidatorAudit(env, config, body ?? {});

      return json(result, { status: result.ok ? 200 : 400 });
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
