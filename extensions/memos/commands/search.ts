import { action, type Context, Icons, type Item, list, toast } from "@backslash/api";
import { captureServer, each, memos, type Server, servers, triliumSearch } from "../api.ts";
import { matches, type Note, SERVICE_NAMES, SetupError, setupItem, sortNotes } from "../lib.ts";
import { captureItem, newNoteForm, noteItem } from "../views.ts";

let status = "";

export default (ctx: Context) => {
  // Memos are loaded once and filtered here; Trilium searches its notes itself, on each query.
  const memoCache = new Map<string, Promise<Note[]>>();
  const invalidate = () => memoCache.clear();
  const loadMemos = (s: Server, signal: AbortSignal) => {
    let p = memoCache.get(s.base);
    if (!p) {
      p = memos(s, signal);
      memoCache.set(s.base, p);
      p.catch(() => memoCache.delete(s.base));
    }
    return p;
  };
  let list_: Server[] = [];
  try {
    list_ = servers(ctx.preferences);
  } catch (e) {
    if (!(e instanceof SetupError)) throw e;
  }
  return list({
    placeholder: "Search memos and notes… or type a new memo",
    filter: { options: [{ value: "all", title: "All" }, { value: "pinned", title: "Pinned" }] },
    status: () => status,
    empty: {
      title: "No note found",
      description: "Type to search, or type a memo and press Enter to capture it.",
      icon: Icons.note,
    },
    actions: list_.length
      ? [action("New Memo…", () => newNoteForm(list_, ctx.preferences), { icon: Icons.plus, shortcut: "<Ctrl>n" })]
      : [],
    async search(query, { signal, filter }) {
      let all: Server[];
      try {
        all = servers(ctx.preferences);
      } catch (e) {
        if (e instanceof SetupError) return [setupItem(e)];
        throw e;
      }
      const r = await each(
        all,
        async (s) =>
          s.service === "memos"
            ? (await loadMemos(s, signal)).filter((n) => !query.trim() || matches(n, query))
            : await triliumSearch(s, query, signal),
      );
      if (!r.ok.length) {
        const setup = r.errors.find((e) => e.error instanceof SetupError);
        if (setup) return [setupItem(setup.error as SetupError)];
        throw r.errors[0].error;
      }
      if (r.errors.length) {
        await toast(`${r.errors.map((e) => SERVICE_NAMES[e.server.service]).join(", ")} didn't answer`, {
          style: "failure",
          message: r.errors.map((e) => e.error.message).join(" · "),
        });
      }
      const many = r.ok.length > 1;
      const notes = r.ok.flatMap((x) => x.value.map((n) => ({ server: x.server, note: n })))
        .filter((x) => filter !== "pinned" || x.note.pinned);
      const order = sortNotes(notes.map((x) => x.note));
      const byId = new Map(notes.map((x) => [x.note, x.server]));
      status = `${order.length} note${order.length === 1 ? "" : "s"}${query.trim() ? "" : " · type to search"}`;
      const items: Item[] = order.map((n) => noteItem(byId.get(n)!, n, many, invalidate));
      if (query.trim()) {
        items.push(
          captureItem(all, captureServer(all, ctx.preferences.captureTo), query.trim(), ctx.preferences, invalidate),
        );
      }
      return items;
    },
  });
};
