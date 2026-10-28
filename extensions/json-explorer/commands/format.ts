import { clipboard, run } from "@backslash/api";
import { parseJson } from "../lib.ts";

// Pretty-prints the JSON in the clipboard, in place.
export default run(async () => {
  const parsed = parseJson(await clipboard.read());
  if (!parsed.ok) {
    const { message, line, column } = parsed.error;
    throw new Error(`The clipboard isn't valid JSON: ${message} (line ${line}, column ${column})`);
  }
  const text = JSON.stringify(parsed.value, null, 2);
  await clipboard.write(text);
  const lines = text.split("\n").length;
  return `Formatted JSON copied: ${lines} line${lines === 1 ? "" : "s"}`;
});
