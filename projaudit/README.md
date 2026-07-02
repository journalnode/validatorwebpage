# /projaudit Worker Scaffold

Cloudflare Worker scaffold for the Journal Node `/projaudit` backend.

Day 35a selected a self-hosted serverless backend on `pft.wizbubba.xyz`, OpenRouter for inference, and GitHub Gist creation for public audit artifacts. This scaffold wires those integrations without implementing the audit pipeline.

## Secrets

Configure these with Wrangler:

```powershell
wrangler secret put OPENROUTER_API_KEY --env staging
wrangler secret put GITHUB_TOKEN --env staging
```

`GITHUB_TOKEN` needs Gists write permission. `OPENROUTER_API_KEY` is sent as a Bearer token to OpenRouter.

## Endpoints

- `GET /health` or `GET /projaudit/health`: process health and secret-presence flags.
- `GET /projaudit/integrations`: authenticated checks against OpenRouter and GitHub. No LLM call or gist creation is performed.
- `POST /projaudit/audit`: placeholder pipeline entrypoint. It validates that the scaffold is live, reports the no-op charge gate, and returns `NOT_IMPLEMENTED` until Day 36 audit logic is added.

## Deploy

```powershell
npm install
npm run typecheck
npm run deploy:staging
```
