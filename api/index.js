export const config = { runtime: "edge" };

import { info, CORS } from "../lib/proxy.js";

export default async function handler(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  return info();
}
