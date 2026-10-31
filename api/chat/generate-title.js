export const config = { runtime: "edge" };

import { wrap, handleGeneric } from "../../lib/proxy.js";

const PATH = "/v1/chat/generate-title";
export default wrap((req) => handleGeneric(req, PATH));
