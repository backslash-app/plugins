import { clipboard, run } from "@backslash/api";
import { formatBytes, parseJson, utf8Bytes } from "../lib.ts";

// Minifies the JSON in the clipboard, in place.
export default run(async () => {
  const input = await clipboard.read();
  const parsed = parseJson(input);
  if (!parsed.ok) {
    const { message, line, column } = parsed.error;
    throw new Error(`The clipboard isn't valid JSON: ${message} (line ${line}, column ${column})`);
  }
  const text = JSON.stringify(parsed.value);
  await clipboard.write(text);
  return `Minified JSON copied: ${formatBytes(utf8Bytes(text))} (was ${formatBytes(utf8Bytes(input))})`;
});
