import { run } from "@backslash/api";
import { block } from "../forms.ts";

export default run<{ domain: string }>(({ args }) => block(String(args.domain ?? ""), true));
