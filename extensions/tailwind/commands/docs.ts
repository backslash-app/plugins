import { copy, list, meta, open } from "@backslash/api";
import data from "../utilities.json" with { type: "json" };
import { DOCS, docUrl } from "../docs.ts";
import { type Data, docFor, expand, groupStyle, naturalCompare } from "../lib.ts";

const DATA = data as Data;

export default list({
  placeholder: "Search the Tailwind CSS docs…",
  status: (items) => `${items.length} pages · Tailwind CSS v${DATA.version}`,
  items: () => {
    // A few classes of each utility page, so typing "rounded" finds border-radius.
    const examples = new Map<string, string[]>();
    for (const u of expand(DATA)) {
      if (u.color) continue;
      const slug = docFor(u)?.slug;
      if (!slug) continue;
      const list = examples.get(slug) ?? [];
      if (list.length < 40) list.push(u.cls);
      examples.set(slug, list);
    }
    return DOCS.map((d) => {
      const style = groupStyle(d.group);
      const classes = (examples.get(d.slug) ?? []).sort(naturalCompare);
      const prefixes = [...new Set(classes.map((c) => c.replace(/-[^-]+$/, "")))].slice(0, 6);
      return {
        id: d.slug,
        title: d.title,
        subtitle: classes.slice(0, 4).join(" · ") || undefined,
        icon: { source: style.icon, tint: style.tint },
        section: d.group,
        keywords: [...(d.keywords ?? []), ...prefixes, d.slug],
        detail: {
          markdown: classes.length
            ? ["**Classes**", "", "```", classes.slice(0, 16).join("\n"), "```"].join("\n")
            : `**${d.title}**`,
          metadata: [
            meta.text("Section", d.group, { icon: style.icon, color: style.tint }),
            ...(classes.length ? [meta.text("Utilities", classes.length >= 40 ? "40+" : String(classes.length))] : []),
            meta.link("Page", `tailwindcss.com/docs/${d.slug}`, docUrl(d.slug)),
          ],
        },
        actions: [
          open(docUrl(d.slug), "Open in Browser"),
          copy(docUrl(d.slug), "Copy URL", { shortcut: "<Ctrl><Shift>c" }),
        ],
      };
    });
  },
});
