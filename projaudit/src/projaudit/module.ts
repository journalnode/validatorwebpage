import type { Env, RuntimeConfig } from "../env";

export interface ProjAuditRequest {
  command?: string;
  url?: string;
  surfaces?: Record<string, string>;
}

export function createScaffoldAuditResponse(
  env: Env,
  config: RuntimeConfig,
  body: ProjAuditRequest | null
) {
  return {
    ok: false,
    status: "NOT_IMPLEMENTED",
    command: "/projaudit",
    version: "v0.2.0-scaffold",
    app_env: config.appEnv,
    input_received: body,
    pipeline: [
      { stage: 1, name: "input_validation", status: "stubbed" },
      { stage: 2, name: "normalization", status: "stubbed" },
      { stage: 3, name: "content_fetch", status: "pending_day_36" },
      { stage: 4, name: "tier_classification", status: "pending_day_36" },
      { stage: 5, name: "pft_charge_gate", status: "no_op_v1" },
      { stage: 6, name: "llm_generation", status: "openrouter_wrapper_ported" },
      { stage: 7, name: "template_validation", status: "pending_day_36" },
      { stage: 8, name: "gist_creation", status: "github_wrapper_ported" }
    ],
    integrations: {
      openrouter_configured: Boolean(env.OPENROUTER_API_KEY),
      github_configured: Boolean(env.GITHUB_TOKEN),
      model: config.openRouterModel,
      gist_public: config.gistPublic
    },
    message: "Scaffold only. Audit logic is intentionally not implemented until Day 36."
  };
}
