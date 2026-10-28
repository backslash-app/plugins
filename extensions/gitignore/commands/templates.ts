import {
  type Action,
  action,
  clipboard,
  close,
  type Context,
  copy,
  detail,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  submenu,
  toast,
} from "@backslash/api";
import {
  cachedContent,
  contents,
  findProjects,
  HOME,
  listTemplates,
  prefetch,
  type Project,
  selection,
  setSelection,
  toggleSelection,
  writeGitignore,
} from "../api.ts";
import {
  ALIASES,
  CATEGORY_TITLE,
  combine,
  describe,
  expandHome,
  fence,
  githubUrl,
  mergeMessage,
  patternCount,
  POPULAR,
  suggestFor,
  type Template,
  tilde,
} from "../lib.ts";

interface Prefs {
  folders?: string;
  depth?: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function write(folder: string, templates: Template[], signal?: AbortSignal) {
  const texts = await contents(templates, signal);
  const r = await writeGitignore(folder, texts);
  const where = tilde(r.path, HOME);
  if (r.unchanged.length && r.added) {
    await toast(mergeMessage(r, where, r.created), {
      style: "success",
      message: `Nothing new from ${r.unchanged.join(", ")}`,
    });
  }
  return close(mergeMessage(r, where, r.created));
}

function otherFolderForm(templates: Template[]) {
  return form({
    title: `Add ${templates.length === 1 ? templates[0].name : plural(templates.length, "template")} to .gitignore`,
    submitTitle: "Write .gitignore",
    fields: [field.text("folder", "Project folder", { required: true, placeholder: "~/Projects/my-app" })],
    async submit(values, { signal }) {
      const folder = expandHome(String(values.folder ?? ""), HOME).replace(/\/+$/, "");
      if (!folder.startsWith("/")) throw new Error("Type the full path of the folder, e.g. ~/Projects/my-app");
      const info = await Deno.stat(folder).catch(() => undefined);
      if (!info) throw new Error(`${tilde(folder, HOME)} doesn't exist`);
      if (!info.isDirectory) throw new Error(`${tilde(folder, HOME)} is not a folder`);
      return await write(folder, templates, signal);
    },
  });
}

/** "Write to Project ›": recent projects first, the ones the templates suit marked. */
function writeMenu(templates: Template[], prefs: Prefs, title: string, options: { shortcut?: string } = {}): Action {
  return submenu(title, async () => {
    const projects = await findProjects(prefs.folders, Math.max(1, Math.min(5, Number(prefs.depth ?? 2))));
    const label = (p: Project) => {
      const suits = templates.some((t) => suggestFor(p.files).includes(t.path));
      const state = p.gitignoreLines === undefined ? "no .gitignore" : `.gitignore ${plural(p.gitignoreLines, "line")}`;
      return `${p.path.split("/").pop()} · ${tilde(p.path, HOME)} · ${state}${suits ? " · suggested" : ""}`;
    };
    return [
      ...projects.slice(0, 40).map((p) =>
        action(label(p), ({ signal }) => write(p.path, templates, signal), {
          icon: suggestFor(p.files).some((s) => templates.some((t) => t.path === s)) ? Icons.star : Icons.folder,
        })
      ),
      action("Other Folder…", () => otherFolderForm(templates), { icon: Icons.plus }),
    ];
  }, { icon: Icons.file, ...options });
}

async function selectionView(all: Template[], prefs: Prefs, signal: AbortSignal) {
  const paths = await selection();
  const chosen = paths.map((p) => all.find((t) => t.path === p)).filter((t): t is Template => !!t);
  if (!chosen.length) throw new Error("Nothing selected: press Ctrl+Enter on templates to add them");
  const texts = await contents(chosen, signal);
  const text = combine(texts);
  return detail({
    title: `${chosen.map((t) => t.name).join(" + ")}`,
    markdown: fence(text),
    metadata: [
      meta.tags("Templates", chosen.map((t) => ({ text: t.name, color: "blue" as const }))),
      meta.text("Patterns", String(patternCount(text))),
      meta.text("Lines", String(text.split("\n").length)),
    ],
    actions: [
      copy(text, "Copy Combined .gitignore"),
      writeMenu(chosen, prefs, "Write to Project…", { shortcut: "<Ctrl>w" }),
      action("Clear Selection", async () => {
        await setSelection([]);
        return close("Selection cleared");
      }, { icon: Icons.trash, destructive: true, section: "Selection" }),
    ],
  });
}

function templateItem(
  t: Template,
  content: string | undefined,
  selected: string[],
  all: Template[],
  prefs: Prefs,
): Item {
  const isSelected = selected.includes(t.path);
  const patterns = content === undefined ? undefined : patternCount(content);
  const others = selected.filter((p) => p !== t.path).map((p) => all.find((x) => x.path === p)).filter((
    x,
  ): x is Template => !!x);
  const withThis = isSelected ? others.concat(t) : [...others, t];
  const actions: Action[] = [
    action("Copy Template", async ({ signal }) => {
      const [text] = await contents([t], signal);
      await clipboard.write(text.content);
      return close(`${t.name}.gitignore copied`);
    }, { icon: Icons.copy }),
    action(isSelected ? "Remove from Selection" : "Add to Selection", async () => {
      const on = await toggleSelection(t.path);
      await toast(on ? `${t.name} selected` : `${t.name} removed`, {
        message: `${plural((await selection()).length, "template")} selected`,
      });
      return refresh();
    }, { icon: isSelected ? Icons.minus : Icons.plus, shortcut: "<Ctrl>space" }),
    writeMenu([t], prefs, "Write to Project…", { shortcut: "<Ctrl>w" }),
    open(githubUrl(t.path), "Open on GitHub", { shortcut: "<Ctrl>o" }),
    copy(
      `curl -fsSL ${
        githubUrl(t.path).replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/")
      } >> .gitignore`,
      "Copy curl Command",
      {
        icon: Icons.terminal,
        section: "Copy",
      },
    ),
  ];
  if (others.length) {
    actions.splice(
      3,
      0,
      action(`Copy ${withThis.map((x) => x.name).join(" + ")}`, async ({ signal }) => {
        await clipboard.write(combine(await contents(withThis, signal)));
        return close(`${plural(withThis.length, "template")} copied`);
      }, { icon: Icons.layers, section: "Selection", shortcut: "<Ctrl><Shift>c" }),
      writeMenu(withThis, prefs, `Write ${plural(withThis.length, "Template")} to Project…`, {
        shortcut: "<Ctrl><Shift>w",
      }),
    );
  }
  if (selected.length) {
    actions.push(
      action("Show Selection", ({ signal }) => selectionView(all, prefs, signal), {
        icon: Icons.eye,
        section: "Selection",
        shortcut: "<Ctrl>p",
      }),
      action("Clear Selection", async () => {
        await setSelection([]);
        return refresh();
      }, { icon: Icons.trash, section: "Selection", destructive: true, confirm: "Clear the selection?" }),
    );
  }
  const where = t.category === "community" ? `community/${t.group ?? ""}` : CATEGORY_TITLE[t.category];
  return {
    id: t.path,
    title: t.name,
    subtitle: content && describe(content).split(" ").length >= 4 ? describe(content) : where,
    icon: isSelected ? { source: Icons.squareCheck, tint: "green" } : {
      source: t.category === "global" ? Icons.monitor : t.category === "community" ? Icons.person : Icons.file,
      tint: t.category === "language" ? "blue" : t.category === "global" ? "purple" : "teal",
    },
    section: isSelected ? "Selected" : POPULAR.includes(t.path) ? "Popular" : CATEGORY_TITLE[t.category],
    keywords: [...(ALIASES[t.path] ?? []), t.group ?? "", t.path],
    accessories: [
      ...(t.group ? [{ tag: t.group }] : []),
      ...(patterns !== undefined ? [{ text: plural(patterns, "pattern") }] : []),
    ],
    detail: {
      markdown: content === undefined ? `## ${t.name}\n\n_Loading the template…_` : fence(content),
      metadata: [
        meta.text("Path", t.path, { icon: Icons.file }),
        meta.text("Kind", where),
        ...(patterns !== undefined ? [meta.text("Patterns", String(patterns))] : []),
        ...(isSelected ? [meta.tags("Selection", [{ text: "Selected", color: "green" }])] : []),
        meta.link("Source", `github/gitignore`, githubUrl(t.path)),
      ],
    },
    actions,
  };
}

const FILTERS: Record<string, (t: Template, selected: string[]) => boolean> = {
  all: () => true,
  selected: (t, s) => s.includes(t.path),
  language: (t) => t.category === "language",
  global: (t) => t.category === "global",
  community: (t) => t.category === "community",
};

export default (ctx: Context) => {
  const prefs = ctx.preferences as Prefs;
  return list({
    placeholder: "Search templates: Node, Python, macOS, JetBrains…",
    filter: {
      options: [
        { value: "all", title: "All" },
        { value: "selected", title: "Selected" },
        { value: "language", title: "Languages" },
        { value: "global", title: "Editors & OS" },
        { value: "community", title: "Community" },
      ],
    },
    empty: {
      title: "No template here",
      description: "Pick templates with Ctrl+Space, then write them to a project with Ctrl+Shift+W",
      icon: Icons.file,
    },
    status: (items) => {
      const selected = items.filter((i) => i.section === "Selected").length;
      return `${plural(items.length, "template")}${selected ? ` · ${selected} selected` : ""} · github/gitignore`;
    },
    actions: [
      action("Refresh Template List", async ({ signal }) => {
        await listTemplates(signal, true);
        return refresh();
      }, { icon: Icons.refresh }),
    ],
    async *items({ filter, signal }) {
      const [templates, selected] = await Promise.all([listTemplates(signal), selection()]);
      const keep = FILTERS[filter ?? "all"] ?? FILTERS.all;
      const shown = templates.filter((t) => keep(t, selected));
      const order = [
        ...selected,
        ...POPULAR,
        ...shown.map((t) => t.path),
      ].filter((p, i, a) => a.indexOf(p) === i && shown.some((t) => t.path === p));
      const build = async () => {
        const texts = await Promise.all(shown.map((t) => cachedContent(t.path)));
        const items = shown.map((t, i) => templateItem(t, texts[i], selected, templates, prefs));
        const rank = (item: Item) => ["Selected", "Popular"].indexOf(item.section ?? "");
        return [
          ...items.filter((i) => rank(i) >= 0).sort((a, b) =>
            rank(a) - rank(b) || order.indexOf(a.id!) - order.indexOf(b.id!)
          ),
          ...items.filter((i) => rank(i) < 0),
        ];
      };
      yield await build();
      // Texts come from raw.githubusercontent.com once, then from the cache.
      const chunk = 30;
      for (let i = 0; i < order.length && !signal.aborted; i += chunk) {
        const slice = order.slice(i, i + chunk);
        const before = await Promise.all(slice.map(cachedContent));
        if (before.every((t) => t !== undefined)) continue;
        await prefetch(slice, signal, () => {}, chunk);
        yield await build();
      }
    },
  });
};
