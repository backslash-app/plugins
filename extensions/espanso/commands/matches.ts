import {
  type Action,
  action,
  clipboard,
  close,
  copy,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  open,
  paste,
  refresh,
  toast,
} from "@backslash/api";
import { espanso, loadMatches, NotInstalled, type Paths, running } from "../api.ts";
import { formFields, type Match, matchKind, matchTitle, oneLine, removeMatch, resolve, type Var } from "../lib.ts";
import { addForm } from "../views.ts";

let status = "";

const KIND_ICON = {
  text: { source: Icons.text, tint: "blue" as const },
  form: { source: Icons.squareCheck, tint: "purple" as const },
  image: { source: Icons.image, tint: "teal" as const },
  markdown: { source: Icons.note, tint: "orange" as const },
  html: { source: Icons.code, tint: "orange" as const },
};

function fillForm(m: Match, globals: Var[]) {
  const fields = formFields(m);
  return form({
    title: matchTitle(m),
    submitTitle: "Paste",
    fields: fields.map((f) =>
      f.kind === "dropdown"
        ? field.dropdown(f.id, f.title, f.options, { value: f.value ?? f.options[0] })
        : f.kind === "textArea"
        ? field.textArea(f.id, f.title, { value: f.value })
        : field.text(f.id, f.title, { value: f.value })
    ),
    async submit(values) {
      const filled = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]));
      await clipboard.paste(resolve(m, globals, { values: filled }).text);
      return close();
    },
  });
}

function controls(p: Paths, on: boolean): Action[] {
  const run = (title: string, args: string[], done: string, icon: string) =>
    action(title, async () => {
      await espanso(args);
      await toast(done, { style: "success" });
      return refresh();
    }, { icon, section: "Espanso" });
  return [
    action("Add Match", ({ preferences }) => addForm(preferences), {
      icon: Icons.plus,
      shortcut: "<Ctrl>n",
      section: "Espanso",
    }),
    ...(on
      ? [
        run("Disable Espanso", ["cmd", "disable"], "Espanso disabled", Icons.pause),
        run("Enable Espanso", ["cmd", "enable"], "Espanso enabled", Icons.play),
        run("Restart Espanso", ["restart"], "Espanso restarted", Icons.refresh),
      ]
      : [run("Start Espanso", ["start"], "Espanso started", Icons.play)]),
    open(p.match, "Open Match Folder", { icon: Icons.folder, shortcut: "<Ctrl><Shift>o", section: "Espanso" }),
    open(`${p.config}/config/default.yml`, "Open default.yml", { icon: Icons.settings, section: "Espanso" }),
  ];
}

function matchItem(m: Match, globals: Var[], p: Paths, on: boolean): Item {
  const kind = matchKind(m);
  const preview = resolve(m, globals, { preview: true });
  const text = resolve(m, globals).text;
  const file = m.file.startsWith(`${p.match}/`) ? m.file.slice(p.match.length + 1) : m.file;
  const mine = !m.package;
  const actions: Action[] = [];
  if (kind === "form") {
    actions.push(action("Fill In and Paste", () => fillForm(m, globals), { icon: Icons.paste }));
  } else if (kind === "image" && m.imagePath) {
    const path = m.imagePath.replace("$CONFIG", p.config);
    actions.push(open(path, "Open Image"), copy(path, "Copy Image Path"));
  } else {
    actions.push(paste(text, "Paste Expansion"), copy(text, "Copy Expansion"));
  }
  actions.push(
    ...(m.triggers[0] ? [copy(m.triggers[0], "Copy Trigger", { shortcut: "<Ctrl>period", section: "Match" })] : []),
    open(m.file, mine ? "Edit File" : "Open Package File", { icon: Icons.file, shortcut: "<Ctrl>o", section: "Match" }),
    ...(mine
      ? [action("Delete Match", async () => {
        const updated = removeMatch(await Deno.readTextFile(m.file), m.index);
        await Deno.writeTextFile(m.file, updated);
        await toast(`${matchTitle(m)} deleted`, { message: file });
        return refresh();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Delete ${matchTitle(m)} from ${file}?`,
        shortcut: "<Ctrl><Shift>x",
        section: "Match",
      })]
      : []),
    ...controls(p, on),
  );
  const varTypes = [...new Set(m.vars.map((v) => v.type))];
  return {
    id: `${m.file}#${m.index}`,
    title: matchTitle(m),
    subtitle: m.label ?? (kind === "image" ? "image" : oneLine(preview.text)),
    icon: KIND_ICON[kind],
    section: m.package ? `Package · ${m.package}` : file,
    keywords: [m.label ?? "", ...m.searchTerms, oneLine(text, 200), ...varTypes].filter(Boolean),
    accessories: [
      ...(m.word ? [{ tag: "word", tooltip: "Expands only as a whole word" }] : []),
      ...varTypes.slice(0, 2).map((t) => ({
        tag: t,
        color: t === "shell" || t === "script" ? "orange" as const : undefined,
      })),
      ...(kind !== "text" ? [{ tag: kind, color: "purple" as const }] : []),
    ],
    detail: {
      ...(kind === "image" && m.imagePath ? { image: m.imagePath.replace("$CONFIG", p.config) } : {}),
      markdown: kind === "image" ? undefined : ["```", preview.text.replace(/```/g, "ˋˋˋ"), "```"].join("\n"),
      metadata: [
        ...(m.triggers.length ? [meta.tags("Triggers", m.triggers)] : []),
        ...(m.regex ? [meta.text("Regex", m.regex, { icon: Icons.code })] : []),
        ...(m.label ? [meta.text("Label", m.label, { icon: Icons.tag })] : []),
        ...(m.vars.length ? [meta.tags("Variables", m.vars.map((v) => `${v.name}: ${v.type}`))] : []),
        ...(preview.unresolved.length
          ? [meta.text("Computed by espanso", preview.unresolved.join(", "), { icon: Icons.info, color: "orange" })]
          : []),
        ...(m.word ? [meta.text("Word", "Whole words only")] : []),
        ...(m.propagateCase ? [meta.text("Case", "Follows the trigger's case")] : []),
        meta.separator(),
        meta.text(m.package ? "Package" : "File", m.package ?? file, { icon: m.package ? Icons.package : Icons.file }),
      ],
    },
    actions,
  };
}

export default list({
  placeholder: "Search triggers, labels and expansions…",
  empty: { title: "No match yet", description: "Ctrl+N adds one to your match folder", icon: Icons.keyboard },
  status: (items) => items[0]?.id === "setup" ? "Espanso is not installed" : status,
  actions: [
    action("Add Match", ({ preferences }) => addForm(preferences), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
  ],
  async items() {
    status = "";
    let loaded, on;
    try {
      [loaded, on] = await Promise.all([loadMatches(), running()]);
    } catch (e) {
      if (!(e instanceof NotInstalled)) throw e;
      return [{
        id: "setup",
        title: e.message,
        icon: { source: Icons.download, tint: "orange" },
        detail: {
          markdown: [
            "## Install espanso",
            "",
            "Espanso is a text expander: type `:date` anywhere and it becomes today's date.",
            "Install it from **espanso.org/install** (packages for Debian/Ubuntu, Fedora, Arch, an AppImage",
            "and Wayland builds), run `espanso service register` then `espanso start`.",
          ].join("\n"),
        },
        actions: [open("https://espanso.org/install/", "Open espanso.org/install")],
      }];
    }
    const { matches, globals, errors, paths } = loaded;
    const files = new Set(matches.filter((m) => !m.package).map((m) => m.file)).size;
    const packages = new Set(matches.map((m) => m.package).filter(Boolean)).size;
    status = [
      on ? "Espanso running" : "Espanso stopped",
      `${matches.length} matches`,
      `${files} file${files === 1 ? "" : "s"}`,
      ...(packages ? [`${packages} package${packages === 1 ? "" : "s"}`] : []),
      ...errors.map((e) => `Error in ${e}`),
    ].join(" · ");
    const items = matches.map((m) => matchItem(m, globals, paths, on));
    if (!on) {
      items.unshift({
        id: "stopped",
        title: "Espanso is not running",
        subtitle: "Enter starts it",
        icon: { source: Icons.pause, tint: "orange" },
        actions: [
          action("Start Espanso", async () => {
            await espanso(["start"]);
            await toast("Espanso started", { style: "success" });
            return refresh();
          }, { icon: Icons.play }),
          ...controls(paths, on),
        ],
      });
    }
    return items;
  },
});
