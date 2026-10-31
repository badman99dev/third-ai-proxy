# third-ai-proxy

A Cloudflare Worker proxy for the **Appzone AI** backend (`api.appzoneai.com`).
It injects all required headers automatically, so you can talk to the API with a
plain OpenAI-style payload — no signup, no manual headers.

## What it does

- Injects every required upstream header (`Authorization`, `X-App-Version`,
  `X-Package-Name`, `X-Platform-Type`, `X-Client-Capabilities`).
- Auto-generates `X-User-ID` (or forwards yours via `x-user-id`).
- Exposes an OpenAI-compatible surface:
  - `POST /v1/chat/completions` — streaming SSE, OpenAI chunk format
  - `GET  /v1/models` — model catalog in OpenAI format
  - `GET  /v1/chat/models` — raw upstream catalog
  - any other `/v1/*` — generic passthrough
- `GET /ip` — shows worker egress IPs (to verify Cloudflare IP rotation).
- Auto-retries `429` responses (Cloudflare egress IP may rotate between tries).
- Full CORS support (works from browser / any client).
- Passes the SSE stream straight through (no buffering).
- Optional shared-secret protection via `PROXY_SECRET`.

## Free models

| Model ID | Notes |
|---|---|
| `gpt-5.4-mini` | text + vision |
| `qwen-3.7-plus` | text + vision + strong coding |

Everything else is premium and returns `premium_required`.

## Deploy (Cloudflare Dashboard)

1. Go to <https://dash.cloudflare.com> → **Workers & Pages** → **Create** →
   **Worker**.
2. Name it `third-ai-proxy` and create.
3. Open **Edit code**, delete the sample, paste the full contents of
   `worker.js`, then **Deploy**.
4. (Optional) **Settings → Variables** → add secret `PROXY_SECRET` to lock it
   down.

## Deploy (Wrangler CLI)

```bash
npm i -g wrangler
wrangler login
wrangler deploy
# optional lock-down
wrangler secret put PROXY_SECRET
```

## Usage

```bash
curl -N https://third-ai-proxy.<your-subdomain>.workers.dev/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "qwen-3.7-plus",
    "stream": true,
    "messages": [{"role": "user", "content": "Write a Python quicksort"}]
  }'
```

Model list:

```bash
curl https://third-ai-proxy.<your-subdomain>.workers.dev/v1/models
```

Vision (OpenAI multimodal format):

```json
{
  "model": "gpt-5.4-mini",
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "What is in this image?" },
      { "type": "image_url", "image_url": { "url": "data:image/png;base64,<BASE64>" } }
    ]
  }]
}
```

If you set `PROXY_SECRET`, add `-H 'x-proxy-key: <secret>'` (or `?key=<secret>`).

## Notes

- Rate limit is **per client IP** (~8–10 requests/min). Running on Cloudflare
  Workers gives you a different egress than your own machine.
- Upstream is *always* streaming, even if you send `"stream": false`.
- `X-User-ID` only affects usage accounting, not the 429 limit.