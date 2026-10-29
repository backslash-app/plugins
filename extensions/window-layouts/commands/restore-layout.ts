import { run } from "@backslash/api";
import { restoreNamed } from "../layout.ts";

export default run<{ name: string }>((ctx) => restoreNamed(String(ctx.args.name ?? ""), ctx));
