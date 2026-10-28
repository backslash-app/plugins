import { run } from "@backslash/api";
import { save } from "../api.ts";
import { AuthError, linkIn, tokenOf } from "../lib.ts";

export default run<{ url: string }>(async (ctx) => {
  const link = linkIn(String(ctx.args.url ?? ""));
  if (!link) throw new Error("That's not a link: https://example.com/page");
  let token: string;
  try {
    token = tokenOf(ctx.preferences);
  } catch (e) {
    if (e instanceof AuthError) throw new Error(`${e.message}: open Search Raindrop Bookmarks to see how`);
    throw e;
  }
  await save(token, { link });
  return `Saved ${new URL(link).host.replace(/^www\./, "")} to Unsorted`;
});
