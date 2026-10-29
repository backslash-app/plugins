import { action, type Context, Icons, type Item, list, meta, submenu } from "@backslash/api";
import { type Accounts, accounts, networksOf, SetupError } from "../api.ts";
import { counts, countText, LIMITS, NETWORK_NAMES, richText, VISIBILITIES } from "../lib.ts";
import { composeForm, NETWORK_TINT, publish, setupItems, targetNetworks, TARGETS } from "../views.ts";

// The search field is the composer: every keystroke recounts the text as
// each network does, and Enter posts it. Ctrl+Enter opens the form for
// several lines, a content warning or another visibility.
export default (ctx: Context<{ text?: string }>) =>
  list({
    title: "New Post",
    placeholder: "What's on your mind?",
    empty: { title: "Type your post", icon: Icons.comment },
    search(query, { preferences }) {
      let a: Accounts;
      try {
        a = accounts(preferences);
      } catch (e) {
        if (e instanceof SetupError) return setupItems(e);
        throw e;
      }
      const text = (query || String(ctx.args.text ?? "")).trim();
      const nets = networksOf(a);
      if (!text) {
        return [{
          id: "hint",
          title: "Type your post in the search field",
          subtitle: nets.map((n) => `${NETWORK_NAMES[n]} ${LIMITS[n]}`).join(" · ") + " characters",
          icon: { source: Icons.text, tint: "gray" },
          actions: [action("Write in a Form", () => composeForm(a), { icon: Icons.text })],
        }];
      }
      const rich = richText(text);
      const found = rich.segments.map((s) =>
        s.kind === "link" ? s.value : s.kind === "mention" ? `@${s.value}` : `#${s.value}`
      );
      return TARGETS(a).map((t): Item => {
        const networks = targetNetworks(a, t.value);
        const c = counts(text, networks);
        const over = c.filter((x) => x.over);
        return {
          id: t.value,
          title: over.length
            ? `Too long for ${over.map((x) => NETWORK_NAMES[x.network]).join(" and ")}`
            : `Post to ${t.title}`,
          subtitle: text,
          icon: over.length
            ? { source: Icons.alert, tint: "red" }
            : { source: Icons.arrowRight, tint: networks.length === 2 ? "green" : NETWORK_TINT[networks[0]] },
          accessories: c.map((x) => ({
            tag: countText(x),
            color: x.over ? "red" as const : x.used > x.limit * 0.9 ? "orange" as const : NETWORK_TINT[x.network],
            tooltip: `${NETWORK_NAMES[x.network]}: ${x.limit - x.used} left`,
          })),
          detail: {
            stats: c.map((x) => ({
              label: NETWORK_NAMES[x.network],
              value: countText(x),
              color: x.over ? "red" as const : undefined,
            })),
            markdown: [
              text,
              ...(networks.includes("bluesky") && rich.text !== text
                ? ["", "**On Bluesky, links are shortened:**", "", rich.text]
                : []),
            ].join("\n"),
            metadata: [
              ...(a.mastodon && networks.includes("mastodon")
                ? [
                  meta.text(
                    "Mastodon visibility",
                    VISIBILITIES.find((v) => v.value === a.mastodon!.visibility)!.title,
                    { icon: Icons.eye },
                  ),
                ]
                : []),
              ...(found.length ? [meta.tags("Links, mentions and tags", found)] : []),
            ],
          },
          actions: over.length
            ? [action("Edit in a Form", () => composeForm(a, text, t.value), { icon: Icons.text })]
            : [
              action(`Post to ${t.title}`, () => publish(a, networks, text), { icon: Icons.arrowRight }),
              action("Edit in a Form", () => composeForm(a, text, t.value), { icon: Icons.text }),
              ...(networks.includes("mastodon")
                ? [submenu(
                  "Post with Visibility",
                  VISIBILITIES.map((v) =>
                    action(v.title, () => publish(a, networks, text, { visibility: v.value }), { icon: Icons.eye })
                  ),
                  { icon: Icons.lock },
                )]
                : []),
            ],
        };
      });
    },
  });
