import { clipboard, run } from "@backslash/api";
import { serviceOf, SetupError } from "../api.ts";
import { domainOf, linkIn, parseTags } from "../lib.ts";
import { saveOnce } from "../views.ts";

export default run<{ url?: string; tags?: string }>(async ({ args, preferences, launchType }) => {
  let text = String(args.url ?? "").trim();
  if (!text && launchType !== "background") text = await clipboard.read().catch(() => "");
  const url = linkIn(text);
  if (!url) throw new Error(text ? "That's not a link: https://example.com/page" : "Type a link, or copy one first");
  try {
    const s = serviceOf(preferences);
    const { existed } = await saveOnce(s, { url, tags: parseTags(String(args.tags ?? ""), s.id === "linkwarden") });
    return existed ? `${domainOf(url)} is already in ${s.name}` : `Saved ${domainOf(url)} to ${s.name}`;
  } catch (e) {
    if (e instanceof SetupError) throw new Error(`${e.message}: open Search Bookmarks to see how`);
    throw e;
  }
});
