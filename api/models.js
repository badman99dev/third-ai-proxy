export const config = { runtime: "edge" };

import { wrap, handleModels } from "../lib/proxy.js";

export default wrap(handleModels);
