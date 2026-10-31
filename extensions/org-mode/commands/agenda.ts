import { action, type Context, Icons, type Item, list, open, toast, updateCommandMetadata } from "@backslash/api";
import { agenda, agendaSummary, openTodos, tildify } from "../lib.ts";
import { ALLOWED, capture, config, headingItem, HOME, load } from "../org.ts";

let footer = "";

export default (ctx: Context) => {
  const cfg = config(ctx);
  const query = ctx.query.trim();
  return list({
    placeholder: "Filter by title, keyword, tag or file…",
    filter: {
      options: [
        { value: "agenda", title: "Agenda" },
        { value: "todo", title: "All TODOs" },
        ...cfg.keywords.todo.slice(1).map((k) => ({ value: `kw:${k}`, title: k })),
        { value: "a", title: "Priority A" },
      ],
    },
    empty: {
      title: "Nothing on the agenda",
      description: "No overdue, scheduled or deadline item for the next days. Tab shows all TODOs; Ctrl+N captures one",
      icon: Icons.calendar,
    },
    status: () => footer,
    actions: [
      action(query ? `Capture “${query}”` : "Capture to Inbox", async () => {
        if (!query) throw new Error("Type the entry in the search field first, or use the Capture to Org command");
        await toast(await capture(cfg, query), { style: "success" });
      }, { icon: Icons.plus, shortcut: "<Ctrl>n" }),
      open(cfg.inbox, "Open Inbox", { icon: Icons.inbox }),
    ],
    async items({ filter }): Promise<Item[]> {
      const now = new Date();
      const loaded = await load(cfg);
      const where = cfg.paths.map((p) => tildify(p, HOME)).join(", ");
      if (!loaded.files.length) {
        footer = "";
        return [{
          id: "setup",
          title: `No Org file in ${where}`,
          subtitle: "Settings → Extensions → Org Mode",
          icon: { source: Icons.alert, tint: "orange" },
          detail: {
            markdown: [
              "## Where are your Org files?",
              "",
              "Set **Org files and folders** to your agenda files or the folders that hold them, separated by",
              "commas (folders are searched three levels deep).",
              "",
              "Org Mode may read and write these folders only:",
              "",
              ...ALLOWED.map((a) => `- \`${a}\``),
            ].join("\n"),
          },
          actions: [],
        }];
      }
      const entries = agenda(loaded.headings, now, cfg.lookahead);
      const summary = agendaSummary(entries);
      updateCommandMetadata({ subtitle: summary ?? null }).catch(() => {});
      const kw = (file: string) => loaded.keywords.get(file) ?? cfg.keywords;
      const files = `${loaded.files.length} file${loaded.files.length === 1 ? "" : "s"}`;
      if (!filter || filter === "agenda") {
        footer = [summary ?? "Nothing pressing", files].join(" · ");
        return entries.map((e) => headingItem(e.heading, { cfg, keywords: kw(e.heading.file), entry: e, now }));
      }
      const todos = filter === "a"
        ? openTodos(loaded.headings).filter((h) => h.priority === "A")
        : openTodos(loaded.headings, filter.startsWith("kw:") ? filter.slice(3) : undefined);
      footer = `${todos.length} open · ${files}`;
      return todos.map((h) => headingItem(h, { cfg, keywords: kw(h.file), now }));
    },
  });
};
