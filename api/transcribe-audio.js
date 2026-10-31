export const config = { runtime: "edge" };

import { wrap, handleGeneric } from "../lib/proxy.js";

const PATH = "/transcribe-audio";
export default wrap((req) => handleGeneric(req, PATH));
