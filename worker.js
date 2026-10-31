const UPSTREAM = "https://api.appzoneai.com";
const DEFAULT_MODEL = "gpt-5.4-mini";
const FREE_MODELS = ["gpt-5.4-mini", "qwen-3.7-plus"];

const UPSTREAM_HEADERS = {
  Authorization: "Bearer az-chatai-key",
  "X-App-Version": "1.0.22",
  "X-Package-Name": "com.appzone.chatbotai",
  "X-Platform-Type": "android",
  "X-Client-Capabilities": "subscription_limits_v2, free_chat_quota_v3",
  "Content-Type": "application/json",
  Accept: "application/json",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

function buildHeaders(request) {
  const h = new Headers();
  for (const [k, v] of Object.entries(UPSTREAM_HEADERS)) h.set(k, v);
  h.set("X-User-ID", request.headers.get("x-user-id") || crypto.randomUUID());
  h.set("X-Language", request.headers.get("x-language") || "en");
  const promo = request.headers.get("x-promo-code");
  if (promo) h.set("X-Promo-Code", promo);
  return h;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function upstream(path, method, headers, body, retries = 3) {
  let res;
  for (let attempt = 0; attempt <= retries; attempt++) {
    res = await fetch(UPSTREAM + path, {
      method,
      headers,
      body,
      redirect: "follow",
    });
    if (res.status !== 429 || attempt === retries) return res;
    await res.body?.cancel();
    await sleep(250 + attempt * 400);
  }
  return res;
}

const IP_CHECKERS = [
  { url: "https://checkip.amazonaws.com", parse: (t) => t.trim() },
  { url: "https://ipinfo.io/ip", parse: (t) => t.trim() },
  { url: "https://api.myip.com", parse: (t) => (JSON.parse(t).ip || "").trim() },
  { url: "https://ifconfig.co/ip", parse: (t) => t.trim() },
  { url: "https://ipv4.icanhazip.com", parse: (t) => t.trim() },
  { url: "https://ipv6.icanhazip.com", parse: (t) => t.trim() },
  { url: "https://api.ipify.org?format=json", parse: (t) => (JSON.parse(t).ip || "").trim() },
  { url: "https://ifconfig.me/all.json", parse: (t) => (JSON.parse(t).ip_addr || "").trim() },
];

async function egressIpFrom(checker) {
  try {
    const r = await fetch(checker.url, { headers: { Accept: "application/json, text/plain, */*" } });
    if (!r.ok) return null;
    const t = await r.text();
    const ip = checker.parse(t);
    return ip || null;
  } catch {
    return null;
  }
}

async function egressIp() {
  for (const c of IP_CHECKERS) {
    const ip = await egressIpFrom(c);
    if (ip) return { ip, via: c.url };
  }
  return null;
}

function passthrough(res, extra = {}) {
  const headers = new Headers(res.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

async function handleModels(request) {
  const res = await upstream(
    `/v1/chat/models?t=${Date.now()}`,
    "GET",
    buildHeaders(request)
  );
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

async function handleChat(request) {
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

async function handleGeneric(request, url) {
  const path = url.pathname + url.search;
  const method = request.method;
  const body = ["GET", "HEAD"].includes(method) ? undefined : await request.text();
  const res = await upstream(path, method, buildHeaders(request), body || undefined);
  return passthrough(res);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (env.PROXY_SECRET) {
      const provided =
        request.headers.get("x-proxy-key") || url.searchParams.get("key") || "";
      if (provided !== env.PROXY_SECRET) {
        return json({ error: { message: "Unauthorized proxy key", type: "auth_error" } }, 401);
      }
    }

    const p = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (p === "/" || p === "/health" || p === "/index") {
        return json({
          name: "third-ai-proxy",
          status: "ok",
          upstream: UPSTREAM,
          default_model: DEFAULT_MODEL,
          free_models: FREE_MODELS,
          endpoints: {
            "POST /v1/chat/completions": "OpenAI-compatible chat (streaming SSE)",
            "GET /v1/models": "Model catalog in OpenAI format",
            "GET /v1/chat/models": "Raw model catalog",
            "GET /ip": "Show worker egress IPs (rotation check)",
            "* /v1/*": "Generic passthrough with headers injected",
          },
          headers_injected: UPSTREAM_HEADERS,
          note: "X-User-ID is auto-generated per request (or pass your own via x-user-id header).",
        });
      }

      if (p === "/debug/headers") {
        const strip = url.searchParams.get("strip") === "1";
        const tanks = ["https://postman-echo.com/headers", "https://httpbin.org/headers"];
        const out = { strip_mode: strip, targets: {} };
        for (const t of tanks) {
          const h = new Headers({ Accept: "application/json" });
          if (strip) {
            for (const k of [
              "Cf-Ray",
              "Cf-Worker",
              "Cdn-Loop",
              "Cf-Visitor",
              "Cf-Ew-Via",
              "X-Forwarded-For",
              "X-Real-Ip",
              "Cf-Connecting-Ip",
              "True-Client-Ip",
            ]) {
              h.set(k, "");
            }
          }
          try {
            const r = await fetch(t, { headers: h });
            const d = await r.json().catch(() => ({}));
            out.targets[t] = d.headers || d;
          } catch (e) {
            out.targets[t] = "ERR " + e.message;
          }
        }
        const seen = Object.values(out.targets).map((h) =>
          Object.keys(h || {}).filter((k) => /^cf-|cdn-loop|x-forwarded|x-real-ip/i.test(k))
        );
        out.cf_headers_still_present = [...new Set(seen.flat())];
        out.verdict = out.cf_headers_still_present.length
          ? "Cloudflare still injects these regardless of your headers => cannot be removed from a Worker subrequest."
          : "Headers successfully stripped.";
        return json(out);
      }

      if (p === "/ip" || p === "/debug/ip") {
        const results = await Promise.all(Array.from({ length: 6 }, () => egressIp()));
        const ips = results.map((r) => (r ? r.ip : null));
        const unique = [...new Set(ips.filter(Boolean))];
        return json({
          samples: results,
          unique_ips: unique,
          unique_count: unique.length,
          rotated: unique.length > 1,
          note: "Uses non-Cloudflare checkers (AWS/ipinfo/etc) to see the REAL egress IP. Multiple IPs => per-IP rate limit can be spread.",
        });
      }

      if (p === "/v1/models" && request.method === "GET") {
        return await handleModels(request);
      }

      if (p === "/v1/chat/completions" && request.method === "POST") {
        return await handleChat(request);
      }

      if (p.startsWith("/v1/") || p === "/chat" || p === "/completions") {
        const target = p === "/chat" ? "/v1/chat/completions" : p === "/completions" ? "/v1/chat/completions" : p;
        if (target === "/v1/chat/completions" && request.method === "POST") return await handleChat(request);
        return await handleGeneric(request, new URL(UPSTREAM + target + url.search));
      }

      return json({ error: { message: "Not found", type: "invalid_request_error" } }, 404);
    } catch (e) {
      return json({ error: { message: String(e && e.message ? e.message : e), type: "proxy_error" } }, 502);
    }
  },
};