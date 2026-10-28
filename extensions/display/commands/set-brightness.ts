import { run } from "@backslash/api";
import { brightness } from "../quick.ts";

export default run<{ level: number }>(({ args, preferences }) => brightness(Number(args.level), !!preferences.ddc));
