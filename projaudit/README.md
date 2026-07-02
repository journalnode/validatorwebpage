# /projaudit Worker Scaffold

Cloudflare Worker for the Journal Node audit-suite backend.

Day 35a selected a self-hosted serverless backend on `pft.wizbubba.xyz`, OpenRouter for inference, and GitHub Gist creation for public audit artifacts.

This Worker ports the old Task Node `/audit` engine into stateless HTTP endpoints and keeps `/projaudit` scaffolded for Day 36 implementation.

## Secrets

Configure these with Wrangler:

```powershell
wrangler secret put OPENROUTER_API_KEY --env staging
wrangler secret put GITHUB_TOKEN --env staging
```

`GITHUB_TOKEN` needs Gists write permission. `OPENROUTER_API_KEY` is sent as a Bearer token to OpenRouter.

## Endpoints

- `GET /health`, `GET /audit/health`, or `GET /projaudit/health`: process health and secret-presence flags.
- `GET /projaudit/integrations`: authenticated checks against OpenRouter and GitHub. No LLM call or gist creation is performed.
- `POST /audit/run`: migrated validator-page audit engine. Requires JSON body:

```json
{
  "url": "https://validator.example.com",
  "modelId": "openai/gpt-5.5"
}
```

Supported model IDs are `openai/gpt-5.5` and `anthropic/claude-opus-4.6`, matching the old Task Node agent.

- `POST /projaudit/audit`: placeholder pipeline entrypoint. It validates that the scaffold is live, reports the no-op charge gate, and returns `NOT_IMPLEMENTED` until Day 36 audit logic is added.

Production routes are configured for:

- `https://pft.wizbubba.xyz/audit/api/*`
- `https://pft.wizbubba.xyz/projaudit/api/*`
- `https://pft.wizbubba.xyz/api/*`

## Deploy

```powershell
npm install
npm run typecheck
npm run deploy:staging
```
