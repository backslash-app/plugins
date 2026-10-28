import { copy, Icons, type Item, list, meta, paste } from "@backslash/api";
import { gitmojiKeywords, GITMOJIS, TYPES } from "../lib.ts";

const SEMVER = { major: "red", minor: "orange", patch: "green" } as const;

export default list({
  placeholder: "Search gitmojis by meaning, code or commit type…",
  status: (items) => `${items.length} of ${GITMOJIS.length} gitmojis · Enter copies the emoji`,
  items: GITMOJIS.map((g): Item => {
    const types = TYPES.filter((t) => t.gitmoji === g.code || t.alsoGitmojis.includes(g.code)).map((t) => t.type);
    return {
      id: g.code,
      title: g.description,
      subtitle: `:${g.code}:`,
      // The emoji is the content itself.
      icon: g.emoji,
      keywords: gitmojiKeywords(g),
      accessories: [
        ...types.slice(0, 2).map((t) => ({ text: t })),
        ...(g.semver ? [{ tag: g.semver, color: SEMVER[g.semver], tooltip: "Version bump" }] : []),
      ],
      detail: {
        markdown: [`# ${g.emoji}`, "", g.description, "", "```", `${g.emoji} ${types[0] ?? "chore"}: …`, "```"].join(
          "\n",
        ),
        metadata: [
          meta.text("Code", `:${g.code}:`, { icon: Icons.hash }),
          ...(types.length ? [meta.tags("Commit types", types)] : []),
          ...(g.semver ? [meta.tags("Semver", [{ text: g.semver, color: SEMVER[g.semver] }])] : []),
          meta.link("Gitmoji", "gitmoji.dev", "https://gitmoji.dev"),
        ],
      },
      actions: [
        copy(g.emoji, "Copy Emoji"),
        copy(`:${g.code}:`, "Copy Code"),
        paste(g.emoji, "Paste Emoji", { section: "Paste" }),
        paste(`:${g.code}:`, "Paste Code", { section: "Paste" }),
      ],
    };
  }),
});
