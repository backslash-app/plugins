import { clipboard, run } from "@backslash/api";
import { config, defaultTarget, send } from "../api.ts";
import { clip, soleUrl } from "../lib.ts";

export default run(async ({ preferences }) => {
  const text = (await clipboard.read()).trim();
  if (!text) throw new Error("The clipboard has no text");
  const c = config(preferences);
  const url = soleUrl(text);
  const where = await send(c, defaultTarget(c), {
    message: clip(text),
    title: url ? "Link from your computer" : "Clipboard",
    tags: [url ? "link" : "clipboard"],
    click: url,
  });
  return `Clipboard sent to ${where}`;
});
