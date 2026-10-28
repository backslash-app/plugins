import {
  type Action,
  action,
  copy,
  detail,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  refresh,
  toast,
} from "@backslash/api";
import {
  age,
  appendMissing,
  assignment,
  describe,
  type Entry,
  expand,
  exportLines,
  extraKeys,
  isExample,
  mask,
  missingKeys,
  parseFolders,
  purpose,
  tilde,
} from "../lib.ts";
import { type Folder, type Found, HOME, readFolder, scan } from "../scan.ts";

interface Prefs {
  folders?: string;
  depth?: number;
  examples?: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The example to compare a file with (none for the example itself). */
const exampleFor = (f: Found, folder: Folder) => isExample(f.name) ? undefined : folder.example;

async function addMissing(f: Found, example: Found): Promise<number> {
  const current = await Deno.readTextFile(f.path);
  const missing = missingKeys(f.parsed.entries, example.parsed.entries);
  if (!missing.length) return 0;
  const entries = example.parsed.entries.filter((e) => missing.includes(e.key));
  const today = new Date().toISOString().slice(0, 10);
  await Deno.writeTextFile(f.path, appendMissing(current, entries, example.name, today));
  return missing.length;
}

function addMissingAction(f: Found, example: Found, missing: string[]): Action {
  return action(`Add ${plural(missing.length, "Missing Key")} from ${example.name}`, async () => {
    const n = await addMissing(f, example);
    await toast(n ? `Added ${plural(n, "key")} to ${f.name}` : `${f.name} already has every key`, {
      style: "success",
      message: n ? "With the example's placeholder values: fill them in" : undefined,
    });
    return refresh();
  }, {
    icon: Icons.plus,
    shortcut: "<Ctrl><Shift>a",
    section: "File",
    confirm: `Append ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "…" : ""} to ${f.name}?`,
  });
}

function revealed(e: Entry, value: string, f: Found): ReturnType<typeof detail> {
  const longest = Math.max(2, ...(value.match(/`+/g) ?? []).map((t) => t.length));
  const fence = "`".repeat(longest + 1);
  return detail({
    title: `${e.key} · ${f.name}`,
    markdown: `## ${e.key}\n\n${fence}\n${value}\n${fence}${
      value !== e.value ? `\n\nAs written:\n\n${fence}\n${e.value}\n${fence}` : ""
    }`,
    metadata: [
      meta.text("File", tilde(f.path, HOME), { icon: Icons.file }),
      meta.text("Line", e.line),
      meta.text("Length", `${value.length} characters`),
    ],
    actions: [
      copy(value, "Copy Value", { concealed: true }),
      copy(`${e.key}=`, `Copy ${e.key}=`),
      open(f.path, "Open File", { shortcut: "<Ctrl>o" }),
    ],
  });
}

function variablesView(f: Found, folder: Folder): ListSpec {
  return list({
    title: `${f.name} · ${tilde(f.dir, HOME)}`,
    placeholder: `Filter the variables of ${f.name}…`,
    empty: { title: `${f.name} is empty`, description: "No KEY=value line in this file", icon: Icons.key },
    status: (items) => plural(items.filter((i) => i.section === "Variables").length, "variable"),
    async items() {
      // Read again: the file may have changed since the list was shown.
      const fresh = (await readFolder(
        folder.dir,
        folder.files.map((x) => x.name),
      )).files.find((x) => x.name === f.name) ?? f;
      const entries = fresh.parsed.entries;
      const values = expand(entries);
      const example = exampleFor(fresh, folder);
      const missing = example ? missingKeys(entries, example.parsed.entries) : [];
      const rows: Item[] = entries.map((e) => {
        const v = values.get(e.key) ?? { value: e.value, unresolved: [] };
        const tags = describe(e);
        return {
          id: e.key,
          title: e.key,
          subtitle: mask(v.value),
          section: "Variables",
          icon: { source: Icons.key, tint: v.value ? "yellow" : "gray" },
          keywords: e.comment ? [e.comment] : undefined,
          accessories: [
            ...tags.map((t) => ({ tag: t })),
            ...(v.unresolved.length
              ? [{
                icon: { source: Icons.alert, tint: "orange" as const },
                tooltip: `Not set in this file: ${v.unresolved.join(", ")}`,
              }]
              : []),
            { text: `line ${e.line}` },
          ],
          detail: {
            markdown: e.comment ? `> ${e.comment}` : undefined,
            metadata: [
              meta.text("Value", mask(v.value), { icon: Icons.eyeOff }),
              meta.text("Length", `${v.value.length} characters`),
              meta.text("Quoting", e.quote ? `${e.quote}…${e.quote}` : "None"),
              ...(e.refs.length
                ? [
                  meta.tags(
                    "References",
                    e.refs.map((r) => ({
                      text: r,
                      color: v.unresolved.includes(r) ? "orange" as const : "blue" as const,
                    })),
                  ),
                ]
                : []),
              ...(e.exported ? [meta.text("Exported", "Yes")] : []),
              meta.text("Line", e.lines > 1 ? `${e.line}–${e.line + e.lines - 1}` : e.line),
            ],
          },
          actions: [
            copy(v.value, "Copy Value", { concealed: true }),
            copy(`${e.key}=`, `Copy ${e.key}=`, { icon: Icons.text }),
            action("Show Value", () => revealed(e, v.value, fresh), { icon: Icons.eye, shortcut: "<Ctrl>r" }),
            copy(assignment(e.key, v.value), "Copy KEY=value Line", {
              concealed: true,
              section: "Copy",
              shortcut: "<Ctrl><Shift>c",
            }),
            copy(exportLines([{ ...e, value: v.value, refs: [] }]), "Copy as export Line", {
              concealed: true,
              section: "Copy",
            }),
            ...(v.value !== e.value
              ? [copy(e.value, "Copy Value as Written", { concealed: true, section: "Copy" })]
              : []),
            copy(e.key, "Copy Key", { section: "Copy" }),
            open(fresh.path, "Open File", { shortcut: "<Ctrl>o", section: "File" }),
            ...(example && missing.length ? [addMissingAction(fresh, example, missing)] : []),
          ],
        };
      });
      if (example) {
        for (const key of missing) {
          const ex = example.parsed.entries.find((e) => e.key === key)!;
          rows.push({
            id: `missing:${key}`,
            title: key,
            subtitle: `In ${example.name}, not in ${fresh.name}`,
            section: `Missing (from ${example.name})`,
            icon: { source: Icons.alert, tint: "orange" },
            accessories: [{ tag: "missing", color: "orange" }],
            detail: {
              markdown: ex.comment ? `> ${ex.comment}` : undefined,
              metadata: [
                meta.text("Example value", ex.value ? ex.value : "(empty)"),
                meta.text("Example line", ex.line),
              ],
            },
            actions: [
              addMissingAction(fresh, example, missing),
              copy(`${key}=`, `Copy ${key}=`, { icon: Icons.text }),
              open(fresh.path, "Open File", { shortcut: "<Ctrl>o" }),
              open(example.path, `Open ${example.name}`),
            ],
          });
        }
      }
      for (const issue of fresh.parsed.issues) {
        rows.push({
          id: `issue:${issue.line}`,
          title: issue.message,
          subtitle: `line ${issue.line}`,
          section: "Problems",
          icon: { source: Icons.alert, tint: "red" },
          actions: [open(fresh.path, "Open File")],
        });
      }
      return rows;
    },
  });
}

function fileItem(f: Found, folder: Folder, now: number): Item {
  const entries = f.parsed.entries;
  const example = exampleFor(f, folder);
  const missing = example ? missingKeys(entries, example.parsed.entries) : [];
  const extra = example ? extraKeys(entries, example.parsed.entries) : [];
  const empty = entries.filter((e) => !e.value).map((e) => e.key);
  const values = expand(entries);
  const kind = purpose(f.name);
  const ex = isExample(f.name);
  return {
    id: f.path,
    title: f.name,
    subtitle: tilde(f.dir, HOME),
    section: tilde(folder.dir, HOME),
    icon: ex ? { source: Icons.file, tint: "gray" } : { source: Icons.key, tint: missing.length ? "orange" : "yellow" },
    keywords: [folder.dir.split("/").pop() ?? "", ...(kind ? [kind] : []), ...entries.map((e) => e.key)],
    accessories: [
      ...(missing.length
        ? [{ tag: `${missing.length} missing`, color: "orange" as const, tooltip: missing.join(", ") }]
        : example
        ? [{ icon: { source: Icons.check, tint: "green" as const }, tooltip: `Every key of ${example.name}` }]
        : []),
      ...(f.parsed.issues.length ? [{ tag: plural(f.parsed.issues.length, "problem"), color: "red" as const }] : []),
      { text: plural(entries.length, "var") },
      { text: age(f.modified, now), tooltip: new Date(f.modified).toLocaleString("en") },
    ],
    detail: {
      stats: [
        { label: "Variables", value: entries.length },
        ...(example
          ? [{ label: "Missing", value: missing.length, color: missing.length ? "orange" as const : "green" as const }]
          : []),
        ...(empty.length ? [{ label: "Empty", value: empty.length, color: "gray" as const }] : []),
      ],
      markdown: entries.length
        ? entries.slice(0, 40).map((e) => `- \`${e.key}\` ${mask(values.get(e.key)?.value ?? e.value)}`).join("\n") +
          (entries.length > 40 ? `\n- … and ${entries.length - 40} more` : "")
        : "_No variables._",
      metadata: [
        ...(kind ? [meta.text("Purpose", kind)] : []),
        meta.text("Folder", tilde(f.dir, HOME), { icon: Icons.folder }),
        ...(example ? [meta.text("Compared with", example.name, { icon: Icons.file })] : []),
        ...(missing.length
          ? [meta.tags("Missing", missing.slice(0, 12).map((k) => ({ text: k, color: "orange" as const })))]
          : []),
        ...(extra.length ? [meta.tags("Not in example", extra.slice(0, 12))] : []),
        ...(empty.length ? [meta.tags("Empty", empty.slice(0, 12))] : []),
        ...(f.parsed.issues.length
          ? [meta.text("Problems", f.parsed.issues.map((i) => `line ${i.line}`).join(", "), { color: "red" })]
          : []),
        meta.text("Modified", new Date(f.modified).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }), {
          icon: Icons.clock,
        }),
      ],
    },
    actions: [
      action("Show Variables", () => variablesView(f, folder), { icon: Icons.key }),
      open(f.path, "Open File", { icon: Icons.file }),
      ...(example && missing.length ? [addMissingAction(f, example, missing)] : []),
      copy(exportLines(entries), "Copy as export Lines", {
        concealed: true,
        icon: Icons.terminal,
        shortcut: "<Ctrl><Shift>e",
        section: "Copy",
      }),
      copy(entries.map((e) => `${e.key}=`).join("\n"), "Copy Keys Only (KEY=)", {
        icon: Icons.text,
        shortcut: "<Ctrl><Shift>k",
        section: "Copy",
      }),
      copy(f.path, "Copy Path", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
      open(f.dir, "Open Folder", { icon: Icons.folder, shortcut: "<Ctrl>o", section: "File" }),
      ...(example ? [open(example.path, `Open ${example.name}`, { section: "File" })] : []),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "File" }),
    ],
  };
}

export default list({
  placeholder: "Filter .env files by project, name or key…",
  empty: {
    title: "No .env file found",
    description: "Set the folders to scan in Settings → Extensions → Env Files",
    icon: Icons.key,
  },
  status: (items) => {
    const files = items.filter((i) => i.id?.startsWith("/"));
    const missing = files.filter((i) => i.accessories?.some((a) => a.tag?.endsWith(" missing"))).length;
    return `${plural(files.length, "file")}${missing ? ` · ${missing} with missing keys` : ""}`;
  },
  async items({ preferences, signal }) {
    const prefs = preferences as Prefs;
    const roots = parseFolders(prefs.folders, HOME);
    const depth = Math.max(1, Math.min(8, Math.round(Number(prefs.depth) || 3)));
    const result = await scan(roots, depth, signal);
    const now = Date.now();
    const items: Item[] = [];
    for (const folder of result.folders) {
      for (const f of folder.files) {
        if (prefs.examples === false && isExample(f.name)) continue;
        items.push(fileItem(f, folder, now));
      }
    }
    for (const root of result.denied) {
      items.push({
        id: `denied:${root}`,
        title: `${tilde(root, HOME)} can't be read`,
        subtitle: "Only the usual code folders of your home can be scanned",
        section: "Folders",
        icon: { source: Icons.lock, tint: "orange" },
        detail: {
          markdown:
            "For your privacy this extension may only read **~/Projects, ~/projects, ~/code, ~/Code, ~/src, ~/dev, ~/Developer, ~/git, ~/repos, ~/workspace, ~/work** and ~/Work.\n\nMove the project there, or remove this folder from the preferences.",
        },
      });
    }
    return items;
  },
});
