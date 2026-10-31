import {
  type Action,
  action,
  close,
  copy,
  field,
  form,
  type FormSpec,
  type FormValues,
  Icons,
  type Item,
  list,
  meta,
  open,
  openExternal,
  pop,
  refresh,
  toast,
} from "@backslash/api";
import {
  answers,
  checkFolderName,
  cookiecutterArgv,
  cookiecutterQuestions,
  copierArgv,
  copierQuestions,
  gitScript,
  KINDS,
  parseTemplate,
  parseTemplateList,
  type Question,
  questionFields,
  shellLine,
  type Template,
  terminalScript,
  tilde,
} from "../lib.ts";
import {
  added,
  addTemplate,
  copyGit,
  created,
  detect,
  type Detected,
  entries,
  exists,
  findTool,
  forget,
  gitInit,
  HOME,
  parentFolder,
  removeTemplate,
  runTool,
  SUGGESTIONS,
  usedBefore,
} from "../scaffold.ts";
import { runInTerminal } from "../terminal.ts";

interface Prefs {
  templates?: string;
  folder?: string;
  suggestions?: boolean;
  terminal?: string;
}

interface Entry {
  template: Template;
  /** A local copy to read the questions from (Cookiecutter's cache). */
  local?: string;
  section: string;
  removable?: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function questionsOf(d: Detected): { questions: Question[]; needsTrust: boolean; unreadable: boolean } {
  if (d.kind === "cookiecutter" && d.config) {
    const questions = cookiecutterQuestions(d.config);
    return {
      questions,
      needsTrust: false,
      unreadable: !questions.length && !!d.config.trim() && d.config.trim() !== "{}",
    };
  }
  if (d.kind === "copier" && d.config) {
    const info = copierQuestions(d.config);
    return { questions: info.questions, needsTrust: info.needsTrust, unreadable: !!info.unreadable };
  }
  return { questions: [], needsTrust: false, unreadable: false };
}

async function toolFor(kind: "cookiecutter" | "copier"): Promise<string[]> {
  const tool = await findTool(kind);
  if (!tool) {
    throw new Error(`Install ${kind} (pipx install ${kind}) or uv, which runs it without installing`);
  }
  return tool;
}

function projectForm(e: Entry, d: Detected, prefs: Prefs): FormSpec {
  const t = e.template;
  const { questions, needsTrust, unreadable } = questionsOf(d);
  const named = d.kind !== "cookiecutter";
  const fields = [
    ...(named ? [field.text("name", "Folder name", { required: true, placeholder: "my-project" })] : []),
    field.text("parent", "Create in", { value: prefs.folder || "~/Projects", required: true }),
    ...questionFields(questions),
    ...(needsTrust ? [field.checkbox("trust", "Trust the template (it runs its own tasks)", { value: false })] : []),
    field.checkbox("git", "Start a git repository", { value: d.kind === "git" }),
    field.checkbox("terminal", "Run in a terminal (and answer the rest there)", { value: unreadable || !!d.error }),
    field.checkbox("open", "Open the new folder", { value: true }),
  ];
  return form({
    title: `New ${t.name} Project`,
    submitTitle: "Create Project",
    fields,
    async submit(values: FormValues) {
      const parent = await parentFolder(values.parent);
      const name = named ? checkFolderName(String(values.name ?? "")) : "";
      if (named && (await exists(`${parent}/${name}`))) {
        throw new Error(`${name} already exists in ${tilde(parent, HOME)}`);
      }
      const given = answers(questions, values, d.kind);
      const trust = values.trust === true;
      if (values.terminal) {
        const lines = d.kind === "git"
          ? gitScript(t, name)
          : d.kind === "cookiecutter"
          ? [shellLine(cookiecutterArgv(t, ".", given, { tool: await toolFor("cookiecutter"), interactive: true }))]
          : [shellLine(copierArgv(t, name, given, { tool: await toolFor("copier"), interactive: true, trust }))];
        if (values.git && named) lines.push(`git -C ${shellLine([name])} init --quiet`);
        runInTerminal(
          ["bash", "-c", terminalScript(`New project from ${t.name}`, parent, lines)],
          prefs.terminal || undefined,
        );
        return close();
      }
      let dest: string | undefined;
      if (d.kind === "git") {
        dest = await copyGit(t, parent, name);
      } else if (d.kind === "cookiecutter") {
        const before = await entries(parent);
        const argv = cookiecutterArgv(t, parent, given, { tool: await toolFor("cookiecutter"), interactive: false });
        await runTool("cookiecutter", argv, parent);
        dest = await created(parent, before);
      } else {
        dest = `${parent}/${name}`;
        await runTool(
          "copier",
          copierArgv(t, dest, given, { tool: await toolFor("copier"), interactive: false, trust }),
          parent,
        );
      }
      if (dest && values.git) await gitInit(dest);
      if (dest && values.open) await openExternal(dest);
      return close(dest ? `Created ${tilde(dest, HOME)}` : `Created in ${tilde(parent, HOME)}`);
    },
  });
}

function terminalAction(e: Entry, d: Detected | undefined, prefs: Prefs): Action {
  return action("Create in Terminal", async () => {
    const t = e.template;
    const kind = d?.kind ?? t.kind ?? "git";
    const parent = await parentFolder(prefs.folder);
    const name = `${t.name}-project`;
    const lines = kind === "git"
      ? gitScript(t, name)
      : kind === "cookiecutter"
      ? [shellLine(cookiecutterArgv(t, ".", [], { tool: await toolFor("cookiecutter"), interactive: true }))]
      : [
        `read -r -p 'Folder name: ' name && [ -n "$name" ]`,
        `${shellLine(copierArgv(t, "DEST", [], { tool: await toolFor("copier"), interactive: true }))}`.replace(
          / DEST$/,
          ' "$name"',
        ),
      ];
    if (kind === "git") lines.unshift(`printf 'Copying into %s\\n' ${shellLine([`${tilde(parent, HOME)}/${name}`])}`);
    runInTerminal(
      ["bash", "-c", terminalScript(`New project from ${t.name}`, parent, lines)],
      prefs.terminal || undefined,
    );
    return close();
  }, { icon: Icons.terminal });
}

function entryItem(e: Entry, d: Detected | undefined, prefs: Prefs): Item {
  const t = e.template;
  const kind = d?.kind ?? t.kind;
  const { questions } = d ? questionsOf(d) : { questions: [] as Question[] };
  const where = t.host === "local"
    ? tilde(t.path ?? "", HOME)
    : t.raw.replace(/^(cookiecutter|copier|degit|git):/i, "");
  const markdown = [
    `**${t.name}**${kind ? ` · ${KINDS[kind].title}` : ""}`,
    "",
    d?.error ? `_${d.error}._` : "",
    questions.length
      ? [
        "### Questions",
        "",
        ...questions.map((q) => `- **${q.title}**${q.default !== "" ? ` · \`${q.default}\`` : ""}`),
      ]
        .join("\n")
      : d && kind === "git"
      ? "Copies the files of the repository, without its history (like degit)."
      : "",
  ].filter(Boolean).join("\n");
  return {
    id: `${e.section}:${t.raw}`,
    title: t.name,
    subtitle: where,
    icon: { source: Icons.rocket, tint: kind === "copier" ? "purple" : kind === "cookiecutter" ? "orange" : "blue" },
    section: e.section,
    keywords: [t.raw, t.owner ?? "", t.repo ?? "", kind ?? "", t.subdir ?? ""],
    accessories: [
      ...(questions.length ? [{ text: plural(questions.length, "question") }] : []),
      ...(d?.error ? [{ icon: { source: Icons.alert, tint: "orange" as const }, tooltip: d.error }] : []),
      kind ? { tag: KINDS[kind].title } : { text: "…", tooltip: "Reading the template" },
    ],
    detail: {
      markdown,
      metadata: [
        meta.text("Kind", kind ? KINDS[kind].title : "Reading…", { icon: Icons.layers }),
        meta.text("Source", where, { icon: t.host === "local" ? Icons.folder : Icons.repository }),
        ...(t.subdir ? [meta.text("Folder", t.subdir)] : []),
        ...(t.ref ? [meta.text("Version", t.ref, { icon: Icons.tag })] : []),
        ...(e.local ? [meta.text("Cached copy", tilde(e.local, HOME))] : []),
        meta.text("Created in", prefs.folder || "~/Projects", { icon: Icons.folder }),
      ],
    },
    actions: [
      action("Create Project…", async ({ signal }) => projectForm(e, d ?? (await detect(t, e.local, signal)), prefs), {
        icon: Icons.plus,
      }),
      terminalAction(e, d, prefs),
      ...(t.webUrl
        ? [open(t.webUrl, "Open Template Page", { icon: Icons.globe, shortcut: "<Ctrl>o" })]
        : t.path
        ? [open(t.path, "Open Template Folder", { icon: Icons.folder, shortcut: "<Ctrl>o" })]
        : []),
      copy(t.raw, "Copy Source", { shortcut: "<Ctrl><Shift>c" }),
      ...(kind && kind !== "git"
        ? [open(KINDS[kind].site, `${KINDS[kind].title} Documentation`, { section: "More" })]
        : []),
      action("Read the Template Again", async () => {
        await forget(t);
        return refresh();
      }, { icon: Icons.refresh, section: "More" }),
      ...(e.removable
        ? [action("Remove Template", async () => {
          await removeTemplate(t.raw);
          await forget(t);
          return refresh();
        }, { icon: Icons.trash, destructive: true, confirm: `Remove ${t.name} from your templates?`, section: "More" })]
        : []),
    ],
  };
}

const addForm = form({
  title: "Add Template",
  submitTitle: "Add",
  fields: [
    field.text("source", "Source", {
      required: true,
      placeholder: "gh:owner/repo, owner/repo/folder#branch, ~/templates/x",
    }),
    field.dropdown("kind", "Kind", [
      { value: "", title: "Find out" },
      { value: "cookiecutter", title: "Cookiecutter" },
      { value: "copier", title: "Copier" },
      { value: "degit", title: "Git copy (degit)" },
    ], { value: "" }),
  ],
  async submit(values) {
    const raw = `${values.kind ? `${values.kind}:` : ""}${String(values.source).trim()}`;
    if (!parseTemplate(raw, HOME)) throw new Error(`“${values.source}” isn't a template source Backslash understands`);
    await addTemplate(raw);
    await toast("Template added", { style: "success" });
    return pop();
  },
});

let summary = "";

export default list({
  placeholder: "Pick a template…",
  empty: {
    title: "No template",
    description: "Add one with Ctrl+N, or list yours in the preferences.",
    icon: Icons.rocket,
  },
  status: () => summary,
  actions: [
    action("Add Template…", () => addForm, { icon: Icons.plus, shortcut: "<Ctrl>n" }),
    action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
  ],
  async *items({ preferences, signal }) {
    const prefs = preferences as Prefs;
    const seen = new Set<string>();
    const list: Entry[] = [];
    const push = (e: Entry) => {
      const key = e.template.cloneUrl.replace(/\.git$/, "").toLowerCase() + (e.template.subdir ?? "");
      if (seen.has(key)) return;
      seen.add(key);
      list.push(e);
    };
    for (const t of parseTemplateList(prefs.templates, HOME)) push({ template: t, section: "Your Templates" });
    for (const raw of await added()) {
      const t = parseTemplate(raw, HOME);
      if (t) push({ template: t, section: "Your Templates", removable: true });
    }
    for (const { template, local } of await usedBefore()) push({ template, local, section: "Used Before" });
    if (prefs.suggestions !== false) {
      for (const raw of SUGGESTIONS) push({ template: parseTemplate(raw, HOME)!, section: "Suggestions" });
    }
    summary = plural(list.length, "template");
    const known = new Map<Entry, Detected>();
    yield list.map((e) => entryItem(e, undefined, prefs));
    await Promise.all(list.map(async (e) => {
      try {
        known.set(e, await detect(e.template, e.local, signal));
      } catch (err) {
        if (signal.aborted) throw err;
      }
    }));
    yield list.map((e) => entryItem(e, known.get(e), prefs));
  },
});
