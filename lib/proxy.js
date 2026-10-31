export const UPSTREAM = "https://api.appzoneai.com";
export const DEFAULT_MODEL = "gpt-5.4-mini";
export const FREE_MODELS = ["gpt-5.4-mini", "qwen-3.7-plus"];

export const UPSTREAM_HEADERS = {
  Authorization: "Bearer az-chatai-key",
  "X-App-Version": "1.0.22",
  "X-Package-Name": "com.appzone.chatbotai",
  "X-Platform-Type": "android",
  "X-Client-Capabilities": "subscription_limits_v2, free_chat_quota_v3",
  "Content-Type": "application/json",
  Accept: "application/json",
};

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

export function clientIp(request) {
  return (
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    "unknown"
  );
}

export function buildHeaders(request) {
  const h = new Headers();
  for (const [k, v] of Object.entries(UPSTREAM_HEADERS)) h.set(k, v);
  h.set("X-User-ID", request.headers.get("x-user-id") || crypto.randomUUID());
  h.set("X-Language", request.headers.get("x-language") || "en");
  const promo = request.headers.get("x-promo-code");
  if (promo) h.set("X-Promo-Code", promo);
  return h;
}

export async function upstream(path, method, headers, body, retries = 3) {
  let res;
  for (let attempt = 0; attempt <= retries; attempt++) {
    res = await fetch(UPSTREAM + path, { method, headers, body, redirect: "follow" });
    if (res.status !== 429 || attempt === retries) return res;
    try {
      await res.body?.cancel();
    } catch {}
    await sleep(250 + attempt * 400);
  }
  return res;
}

export function passthrough(res, extra = {}) {
  const headers = new Headers(res.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

export async function handleModels(request) {
  const res = await upstream(`/v1/chat/models?t=${Date.now()}`, "GET", buildHeaders(request));
  if (!res.ok) return passthrough(res);
  const data = await res.json().catch(() => ({}));
  const models = Array.isArray(data.models) ? data.models : [];
  const toOpenAI = (m) => ({
    id: String(m.id),
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: m.provider || "appzone",
    name: m.name || String(m.id),
    free: !m.is_pro,
    is_pro: !!m.is_pro,
    enabled: m.enabled !== false,
    category: m.category || "model",
    aliases: Array.isArray(m.aliases) ? m.aliases : [],
  });
  return json({
    object: "list",
    data: models.map(toOpenAI),
    free_models: models.filter((m) => !m.is_pro).map((m) => m.id),
  });
}

export async function handleChat(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: { message: "Invalid JSON body", type: "invalid_request_error" } }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: { message: "Body must be a JSON object", type: "invalid_request_error" } }, 400);
  }
  if (!body.model) body.model = DEFAULT_MODEL;
  if (body.stream === undefined) body.stream = true;
  if (body.isSubscribed === undefined) body.isSubscribed = false;
  if (body.web_search === undefined) body.web_search = false;
  if (body.reason === undefined) body.reason = false;
  if (body.study_mode === undefined) body.study_mode = false;

  const res = await upstream(
    "/v1/chat/completions",
    "POST",
    buildHeaders(request),
    JSON.stringify(body)
  );
  return passthrough(res, {
    "X-Proxy-Client-IP": clientIp(request),
    "X-Proxy-Model": String(body.model),
  });
}

export async function handleGeneric(request, path) {
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.text();
  const res = await upstream(path, request.method, buildHeaders(request), body || undefined);
  return passthrough(res);
}

const IP_CHECKERS = [
  { url: "https://checkip.amazonaws.com", parse: (t) => t.trim() },
  { url: "https://ipinfo.io/ip", parse: (t) => t.trim() },
  { url: "https://api.myip.com", parse: (t) => (JSON.parse(t).ip || "").trim() },
  { url: "https://ifconfig.co/ip", parse: (t) => t.trim() },
  { url: "https://ipv4.icanhazip.com", parse: (t) => t.trim() },
  { url: "https://api.ipify.org?format=json", parse: (t) => (JSON.parse(t).ip || "").trim() },
];

async function egressIp() {
  for (const c of IP_CHECKERS) {
    try {
      const r = await fetch(c.url, { headers: { Accept: "application/json, text/plain, */*" } });
      if (!r.ok) continue;
      const ip = c.parse(await r.text());
      if (ip) return { ip, via: c.url };
    } catch {}
  }
  return null;
}

export async function handleIp(request) {
  const n = Math.min(Number(new URL(request.url).searchParams.get("n") || 6), 12);
  const samples = await Promise.all(Array.from({ length: n }, () => egressIp()));
  const ips = samples.map((s) => (s ? s.ip : null));
  const unique = [...new Set(ips.filter(Boolean))];
  return json({
    samples,
    unique_ips: unique,
    unique_count: unique.length,
    rotated: unique.length > 1,
    note: "Vercel Edge egress IPs rotate across requests/regions => per-IP rate limit spreads automatically.",
  });
}

export async function handleHeaders(request) {
  const strip = new URL(request.url).searchParams.get("strip") === "1";
  const targets = ["https://postman-echo.com/headers", "https://httpbin.org/headers"];
  const out = { strip_mode: strip, targets: {} };
  for (const t of targets) {
    const h = new Headers({ Accept: "application/json" });
    if (strip) for (const k of ["Cf-Ray", "Cf-Worker", "Cdn-Loop", "Cf-Visitor", "Cf-Ew-Via", "X-Forwarded-For", "X-Real-Ip", "Cf-Connecting-Ip"]) h.set(k, "");
    try {
      const r = await fetch(t, { headers: h });
      const d = await r.json().catch(() => ({}));
      out.targets[t] = d.headers || d;
    } catch (e) {
      out.targets[t] = "ERR " + e.message;
    }
  }
  const seen = Object.values(out.targets).map((h) => Object.keys(h || {}).filter((k) => /^cf-|cdn-loop|x-forwarded|x-real-ip/i.test(k)));
  out.cf_headers_present = [...new Set(seen.flat())];
  out.verdict = out.cf_headers_present.length
    ? "Cloudflare-style headers present (only if a hop is CF)."
    : "No Cloudflare headers — Vercel Edge does not inject CF-* headers.";
  return json(out);
}

export function info() {
  return json({
    name: "third-ai-proxy",
    platform: "vercel-edge",
    status: "ok",
    upstream: UPSTREAM,
    default_model: DEFAULT_MODEL,
    free_models: FREE_MODELS,
    endpoints: {
      "POST /v1/chat/completions": "OpenAI-compatible chat (streaming SSE)",
      "GET /v1/models": "Model catalog in OpenAI format",
      "GET /v1/chat/models": "Raw model catalog",
      "GET /v1/ip": "Show egress IPs (rotation check)",
      "GET /v1/debug/headers": "Inspect outbound headers",
      "ANY /v1/*": "Generic passthrough with headers injected",
    },
    headers_injected: UPSTREAM_HEADERS,
    note: "X-User-ID auto-generated per request (or pass your own via x-user-id).",
  });
}

export async function route(request) {
  const url = new URL(request.url);
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const seg = p.replace(/^\/api/, "").replace(/^\/v1/, "").replace(/^\/+/, "");
  const parts = seg ? seg.split("/") : [];

  if (parts.length === 0 || parts[0] === "health" || parts[0] === "index") return info();
  if (parts[0] === "ip") return handleIp(request);
  if (parts[0] === "headers" || (parts[0] === "debug" && parts[1] === "headers")) return handleHeaders(request);
  if (parts[0] === "models") return handleModels(request);
  if (parts[0] === "chat" && parts[1] === "models") return handleModels(request);
  if (parts[0] === "chat" && parts[1] === "completions") return handleChat(request);
  if (parts[0] === "completions") return handleChat(request);
  if (parts[0] === "chat" && parts[1] === "generate-title") return handleGeneric(request, "/v1/chat/generate-title");
  if (parts[0] === "extract-text") return handleGeneric(request, "/extract-text");
  if (parts[0] === "transcribe-audio") return handleGeneric(request, "/transcribe-audio");
  if (parts[0] === "report-messages") return handleGeneric(request, "/report-messages");
  if (parts[0] === "submit-rating") return handleGeneric(request, "/submit-rating");
  if (parts[0] === "feedback-event") return handleGeneric(request, "/feedback-event");
  if (parts[0] === "verify-promo-code") return handleGeneric(request, "/verify-promo-code");
  if (parts[0] === "web-search") return handleGeneric(request, "/web-search/" + parts.slice(1).join("/") + url.search);
  return handleGeneric(request, "/v1/" + parts.join("/") + url.search);
}

export function guard(request, env) {
  const secret = env?.PROXY_SECRET || process.env.PROXY_SECRET;
  if (!secret) return null;
  const url = new URL(request.url);
  const provided = request.headers.get("x-proxy-key") || url.searchParams.get("key") || "";
  if (provided !== secret) return json({ error: { message: "Unauthorized proxy key", type: "auth_error" } }, 401);
  return null;
}
