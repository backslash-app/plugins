import { type Context, Icons, type Item, list, open } from "@backslash/api";
import { hasPassOtp, installedBackends, load, type Loaded, nextChange } from "../backends.ts";
import { type BackendId, sortEntries } from "../lib.ts";
import { backendOf, entryItem, stateItem } from "../ui.ts";

let footer = "";

export default async (ctx: Context) => {
  const ids = await installedBackends();
  const several = ids.length > 1;
  return list({
    placeholder: "Search passwords by name, username or website…",
    filter: several
      ? { options: [{ value: "all", title: "All" }, ...ids.map((id) => ({ value: id, title: backendOf(id).name }))] }
      : undefined,
    empty: ids.length ? { title: "No matching entry", icon: Icons.key } : {
      title: "No password manager found",
      description: "Install pass, the Bitwarden CLI (bw), the 1Password CLI (op) or KeePassXC (keepassxc-cli)",
      icon: Icons.key,
    },
    actions: ids.length ? [] : [open("https://www.passwordstore.org", "About pass")],
    status: () => footer,
    // Each manager shows up as soon as it answers (Bitwarden takes a few seconds);
    // unlocking one reloads the list.
    async *items({ filter, preferences, signal }) {
      const shown: BackendId[] = filter && filter !== "all" ? ids.filter((id) => id === filter) : ids;
      const many = shown.length > 1;
      const passOtp = shown.includes("pass") ? await hasPassOtp() : false;
      while (!signal.aborted) {
        const results = new Map<BackendId, Loaded>();
        const render = (): Item[] => {
          const items: Item[] = [];
          let count = 0;
          for (const id of shown) {
            const r = results.get(id);
            if (!r) continue;
            if (r.state !== "ready") {
              items.push(stateItem(r, { ...ctx, preferences }, many));
              continue;
            }
            count += r.entries.length;
            for (const e of sortEntries(r.entries)) {
              items.push(
                entryItem(e, {
                  prefs: preferences,
                  several: many,
                  passOtp,
                  section: e.favorite ? "Favorites" : many ? backendOf(id).name : undefined,
                }),
              );
            }
          }
          const waiting = shown.filter((id) => !results.has(id)).map((id) => backendOf(id).name);
          const states = shown.map((id) => results.get(id)).filter((r) => r && r.state !== "ready")
            .map((r) =>
              `${backendOf(r!.backend).name} ${r!.state === "error" ? "failed" : r!.state.replace("-", " ")}`
            );
          footer = [
            `${count} entr${count === 1 ? "y" : "ies"}`,
            ...states,
            ...(waiting.length ? [`loading ${waiting.join(", ")}…`] : []),
          ].join(" · ");
          // Favorites first, whatever the manager.
          return [...items.filter((i) => i.section === "Favorites"), ...items.filter((i) => i.section !== "Favorites")];
        };
        const pending = new Map(shown.map((id) => [id, load(id, preferences, signal).then((r) => results.set(id, r))]));
        // Fast managers answer together (no flicker), slow ones (Bitwarden) follow.
        await Promise.race([Promise.all(pending.values()), new Promise((r) => setTimeout(r, 400))]);
        for (const id of [...pending.keys()]) if (results.has(id)) pending.delete(id);
        yield render();
        while (pending.size) {
          const done = await Promise.race([...pending].map(([id, p]) => p.then(() => id)));
          pending.delete(done);
          yield render();
        }
        if (!shown.length) yield [];
        await nextChange(signal);
      }
    },
  });
};
