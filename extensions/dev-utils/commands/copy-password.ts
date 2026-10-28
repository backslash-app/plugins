import { clipboard, run } from "@backslash/api";
import { password } from "../lib.ts";

export default run<{ length?: number }>(async ({ args }) => {
  const length = Math.min(256, Math.max(8, Number(args.length) || 20));
  await clipboard.write(password(length, true), { concealed: true });
  return `Copied a ${length}-character password`;
});
