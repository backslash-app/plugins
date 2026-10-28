import { clipboard, run } from "@backslash/api";
import { client, type Prefs, SetupError } from "../api.ts";
import { parseAddInput } from "../lib.ts";

export default run<{ link?: string }>(async ({ args, preferences, launchType }) => {
  let text = String(args.link ?? "").trim();
  let fromClipboard = false;
  if (!text && launchType !== "background") {
    text = (await clipboard.read().catch(() => "")).trim();
    fromClipboard = true;
  }
  const input = parseAddInput(text);
  if (!input) {
    throw new Error(
      fromClipboard
        ? "Type a magnet link or a .torrent URL, or copy one first: the clipboard holds none"
        : `“${text.slice(0, 60)}” is not a magnet link, a .torrent URL or an info hash`,
    );
  }
  let c;
  try {
    c = await client(preferences as Prefs);
  } catch (e) {
    if (e instanceof SetupError) throw new Error(`${e.message}: set the client in Settings → Extensions → Torrents`);
    throw e;
  }
  const name = (await c.add(input.link)) ?? input.name;
  return `Added to ${c.title}${name ? `: ${name}` : ""}`;
});
