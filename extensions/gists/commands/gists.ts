import { action, type Context, Icons, type Item, list, open } from "@backslash/api";
import { AuthError, github, setupItems, token } from "../api.ts";
import { createForm, gistActions, nextChange, withContent } from "../gists.ts";
import { type Gist, gistItem } from "../lib.ts";

/** Contents come from one call per gist: only for the most recent ones. */
const WITH_CONTENT = 30;

let counts = { total: 0, secret: 0 };
let current = "all";

async function load(t: string, filter: string, signal: AbortSignal): Promise<Gist[]> {
  if (filter === "starred") return await github<Gist[]>(t, "/gists/starred?per_page=100", { signal });
  const pages = await Promise.all(
    [1, 2, 3].map((page) => github<Gist[]>(t, `/gists?per_page=100&page=${page}`, { signal }).catch(() => [])),
  );
  const all = pages.flat();
  counts = { total: all.length, secret: all.filter((g) => !g.public).length };
  if (filter === "public") return all.filter((g) => g.public);
  if (filter === "secret") return all.filter((g) => !g.public);
  return all;
}

export default (_ctx: Context) =>
  list({
    placeholder: "Search gists by description, file name, language…",
    filter: {
      options: [
        { value: "all", title: "All" },
        { value: "public", title: "Public" },
        { value: "secret", title: "Secret" },
        { value: "starred", title: "Starred" },
      ],
    },
    empty: {
      title: "No gists here",
      description: "Press Ctrl+N to create one from the clipboard.",
      icon: Icons.code,
    },
    status: (items) =>
      items[0]?.id === "setup"
        ? "Not connected"
        : `${items.length} gist${items.length === 1 ? "" : "s"}${
          current !== "starred" && counts.secret ? ` · ${counts.secret} secret` : ""
        }`,
    actions: [
      action(
        "Create Gist from Clipboard",
        async ({ preferences }) => createForm(await token(preferences), { standalone: false }),
        { icon: Icons.plus, shortcut: "<Ctrl>n" },
      ),
      open("https://gist.github.com/", "Open gist.github.com"),
    ],
    // Reloads after a gist is created, deleted or unstarred from this command.
    async *items({ preferences, signal, filter }) {
      let t: string;
      try {
        t = await token(preferences);
      } catch (e) {
        if (e instanceof AuthError) return yield setupItems(e);
        throw e;
      }
      const view = filter ?? "all";
      current = view;
      const options = { own: view !== "starred", starred: view === "starred" };
      while (!signal.aborted) {
        let gists: Gist[];
        try {
          gists = await load(t, view, signal);
        } catch (e) {
          if (e instanceof AuthError) return yield setupItems(e);
          throw e;
        }
        const now = new Date();
        const items = (list: Gist[]): Item[] => list.map((g) => gistItem(g, gistActions(t, g, options), now));
        yield items(gists);
        // Then the files' contents, for the previews.
        const full = await Promise.all(
          gists.map((g, i) => (i < WITH_CONTENT ? withContent(t, g, signal).catch(() => g) : g)),
        );
        if (signal.aborted) return;
        yield items(full);
        await nextChange(signal);
      }
    },
  });
