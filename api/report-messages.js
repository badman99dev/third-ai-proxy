export const config = { runtime: "edge" };

import { wrap, handleGeneric } from "../lib/proxy.js";

const PATH = "/report-messages";
export default wrap((req) => handleGeneric(req, PATH));
