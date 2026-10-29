import { run } from "@backslash/api";
import { saveCurrent } from "../layout.ts";
import { summary } from "../lib.ts";

export default run<{ name: string }>(async ({ args }) => {
  const layout = await saveCurrent(String(args.name ?? ""));
  return `${layout.name} saved: ${summary(layout.windows)}`;
});
