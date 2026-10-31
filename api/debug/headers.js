export const config = { runtime: "edge" };

import { wrap, handleHeaders } from "../../lib/proxy.js";

export default wrap(handleHeaders);
