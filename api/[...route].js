export const config = { runtime: "edge" };

import { CORS, guard, json, route } from "../lib/proxy.js";

export default async function handler(request, ctx) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const denied = guard(request, ctx?.env || {});
  if (denied) return denied;

  try {
    return await route(request);
  } catch (e) {
    return json(
      { error: { message: String(e && e.message ? e.message : e), type: "proxy_error" } },
      502
    );
  }
}
