export const config = { runtime: "edge" };

import { wrap, handleGeneric } from "../lib/proxy.js";

const PATH = "/verify-promo-code";
export default wrap((req) => handleGeneric(req, PATH));
