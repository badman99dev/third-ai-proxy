export const config = { runtime: "edge" };

import { wrap, handleChat } from "../../lib/proxy.js";

export default wrap(handleChat);
