# third-ai-proxy

A **Vercel Edge** (primary) + **Cloudflare Worker** (bonus) proxy for the
**Appzone AI** backend (`api.appzoneai.com`). It injects all required headers
automatically, so you can use a plain OpenAI-style payload — no signup, no
manual headers.

## Why Vercel?

Vercel Edge Functions egress from a **rotating pool of IPs** (not one fixed IP
like a Cloudflare Worker). Since the upstream rate limit is **per-IP** (~8–10
req/min), rotating egress = you can push far more requests per minute.

## Layout

```
api/                # Vercel Edge Functions (primary)
  index.js          #   GET /            -> info
  [...route].js     #   catch-all router
lib/proxy.js        # shared logic (headers, upstream, handlers)
vercel.json         # rewrites: /v1/* -> /api/*
cloudflare/         # optional Cloudflare Worker version
  worker.js
  wrangler.toml
```

## Endpoints

| Route | Method | Description |
|---|---|---|
| `/v1/chat/completions` | POST | OpenAI-compatible chat, streaming SSE |
| `/v1/models` | GET | Model catalog in OpenAI format |
| `/v1/chat/models` | GET | Raw upstream catalog |
| `/v1/ip` | GET | Egress IPs (rotation check) |
| `/v1/debug/headers` | GET | Inspect outbound headers (`?strip=1`) |
| `/v1/*` | ANY | Generic passthrough with headers injected |

`/chat/completions`, `/models`, `/ip` also work without the `/v1` prefix.

## Free models

| Model ID | Notes |
|---|---|
| `gpt-5.4-mini` | text + vision |
| `qwen-3.7-plus` | text + vision + strong coding |

Everything else is premium and returns `premium_required`.

## Deploy on Vercel

**Option A — Dashboard**

1. Go to <https://vercel.com/new> → **Import Git Repository** → pick
   `third-ai-proxy`.
2. Framework Preset: **Other** (Vercel auto-detects the `api/` directory).
3. (Optional) Project → Settings → Environment Variables → add
   `PROXY_SECRET` to lock the proxy down.
4. **Deploy**. Your base URL is `https://<project>.vercel.app`.

**Option B — CLI**

```bash
npm i -g vercel
vercel login
vercel --prod
# optional lock-down
vercel env add PROXY_SECRET
```

> No build step is required — `vercel.json` + `api/` is enough.

## Usage

```bash
curl -N https://<project>.vercel.app/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "qwen-3.7-plus",
    "stream": true,
    "messages": [{"role": "user", "content": "Write a Python quicksort"}]
  }'
```

Model list:

```bash
curl https://<project>.vercel.app/v1/models
```

Check egress IP rotation:

```bash
curl https://<project>.vercel.app/v1/ip?n=8
```

Vision (OpenAI multimodal):

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

If `PROXY_SECRET` is set, add `-H 'x-proxy-key: <secret>'` (or `?key=<secret>`).

## OpenAI SDK

```python
from openai import OpenAI
client = OpenAI(
    base_url="https://<project>.vercel.app/v1",
    api_key="anything",          # not validated
    default_headers={"x-proxy-key": "<secret-if-set>"},
)
r = client.chat.completions.create(
    model="gpt-5.4-mini",
    messages=[{"role": "user", "content": "hi"}],
    stream=True,
)
for c in r:
    print(c.choices[0].delta.content or "", end="")
```

## Cloudflare Worker variant

Inside `cloudflare/`:

```bash
npm i -g wrangler
wrangler login
wrangler deploy
```

Caveat: Cloudflare Workers add a `CF-Worker` header to every outbound
subrequest (cannot be removed) and egress from a **fixed** IP
(`2a06:98c0:3600::103`), so they don't give the IP rotation that Vercel does.

## Notes

- Upstream is *always* streaming, even if you send `"stream": false`.
- Rate limit is **per client IP**; `X-User-ID` only affects usage accounting.
- The proxy auto-retries `429` responses a few times.
