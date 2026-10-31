export const config = { runtime: "edge" };

import { wrap, handleGeneric } from "../../lib/proxy.js";

export default wrap((req) => {
  const u = new URL(req.url);
  const rest = u.pathname.replace(/^\/api\/web-search\/?/, "");
  return handleGeneric(req, "/web-search/" + rest + u.search);
});
