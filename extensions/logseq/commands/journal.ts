import { run } from "@backslash/api";
import { openToday } from "../graph.ts";

export default run(async (ctx) => await openToday(ctx));
