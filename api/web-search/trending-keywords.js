export const config = { runtime: "edge" };

import { wrap, handleGeneric } from "../../lib/proxy.js";

const PATH = "/web-search/trending-keywords";
export default wrap((req) => handleGeneric(req, PATH));
