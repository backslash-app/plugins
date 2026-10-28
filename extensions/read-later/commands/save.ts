import { clipboard, run } from "@backslash/api";
import { backendOf, SetupError } from "../api.ts";
import { domainOf, linkIn } from "../lib.ts";

export default run<{ url?: string }>(async ({ args, preferences, launchType }) => {
  let text = String(args.url ?? "").trim();
  if (!text && launchType !== "background") text = await clipboard.read().catch(() => "");
  const url = linkIn(text);
  if (!url) {
    throw new Error(text ? "That's not a link: https://example.com/article" : "Type a link, or copy one first");
  }
  try {
    const b = backendOf(preferences);
    await b.add(url);
    return `Saved ${domainOf(url)} to ${b.name}`;
  } catch (e) {
    if (e instanceof SetupError) throw new Error(`${e.message}: open Saved Articles to see how`);
    throw e;
  }
});
