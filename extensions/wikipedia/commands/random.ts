import { action, type Context, detail, type DetailSpec, Icons, replace } from "@backslash/api";
import { random } from "../api.ts";
import { extractToMarkdown, languageName } from "../lib.ts";
import { articleView, defaultLanguage, pageActions, pageMetadata, remember } from "../ui.ts";

/** A random article's summary, with "Another One" and "Read Here". */
export async function randomView(lang: string): Promise<DetailSpec> {
  const p = await random(lang);
  await remember(p).catch(() => {});
  const actions = pageActions(p, { readFirst: true });
  return detail({
    title: p.title,
    markdown: `# ${p.title}\n\n${p.description ? `*${p.description}*\n\n` : ""}${extractToMarkdown(p.extract)}`,
    metadata: pageMetadata(p),
    status: `Random · ${languageName(lang)} Wikipedia`,
    actions: [
      actions[0],
      action("Another One", async () => replace(await randomView(lang)), { icon: Icons.shuffle, shortcut: "<Ctrl>n" }),
      ...actions.slice(1),
      action("Read Here", () => articleView(p.lang, p.title), { icon: Icons.book }),
    ].filter((a, i, all) => all.findIndex((b) => b.title === a.title) === i),
  });
}

export default (ctx: Context) => randomView(defaultLanguage(ctx));
