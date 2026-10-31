export const config = { runtime: "edge" };

import { wrap, handleIp } from "../lib/proxy.js";

export default wrap(handleIp);
