import {
  type Action,
  action,
  copy,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  replace,
  storage,
} from "@backslash/api";
import {
  compile,
  constructor,
  context,
  explainTokens,
  findMatches,
  FLAGS,
  groupNames,
  highlight,
  LIBRARY,
  literal,
  parseQuery,
  type Query,
  type Recipe,
  replacePreview,
  SAMPLE_TEXT,
} from "../lib.ts";

interface Saved {
  text: string;
  replacement?: string;
}

async function saved(): Promise<Saved> {
  const text = await storage.get<string>("text").catch(() => undefined);
  const replacement = await storage.get<string>("replacement").catch(() => undefined);
  return { text: text ?? SAMPLE_TEXT, replacement: replacement ?? undefined };
}

const fence = (text: string) => {
  const shown = text.length > 8000 ? `${text.slice(0, 8000)}\n…` : text;
  return `\`\`\`\n${shown}\n\`\`\``;
};
const oneLine = (text: string, max = 90) => {
  const line = text.replace(/\n/g, "↵").replace(/\t/g, "→");
  return line.length > max ? `${line.slice(0, max)}…` : line;
};
const plural = (n: number, one: string, many = `${one}es`) => `${n} ${n === 1 ? one : many}`;

function editForm(q: Query | undefined, s: Saved): FormSpec {
  return form({
    title: "Test Text",
    submitTitle: "Test",
    fields: [
      field.text("pattern", "Pattern", { value: q?.pattern ?? "", placeholder: String.raw`\b\w+@\w+\.\w+\b` }),
      field.text("flags", "Flags", { value: q?.flags ?? "g", placeholder: "g, i, m, s, u, y, d, v" }),
      field.textArea("text", "Test text", { value: q?.text ?? s.text, required: true }),
      field.text("replacement", "Replacement", {
        value: q?.replacement ?? s.replacement ?? "",
        placeholder: "Optional: $1, $<name>, $& (empty for no preview)",
      }),
    ],
    async submit(values) {
      const text = String(values.text ?? "");
      const replacement = String(values.replacement ?? "") || undefined;
      await storage.set("text", text);
      if (replacement === undefined) await storage.delete("replacement");
      else await storage.set("replacement", replacement);
      const pattern = String(values.pattern ?? "");
      const next: Query = { pattern, flags: String(values.flags ?? "").trim(), literal: true, text, replacement };
      return replace(pattern ? resultsList(next, { text, replacement }) : home({ text, replacement }));
    },
  });
}

function patternActions(pattern: string, flags: string): Action[] {
  return [
    copy(literal(pattern, flags), "Copy as Regex Literal"),
    copy(pattern, "Copy Pattern", { shortcut: "<Ctrl><Shift>c" }),
    copy(constructor(pattern, flags), "Copy as new RegExp()", { icon: Icons.code, section: "Copy" }),
    copy(JSON.stringify(pattern), "Copy as JSON String", { icon: Icons.braces, section: "Copy" }),
  ];
}

function resultItems(q: Query, s: Saved): Item[] {
  const text = q.text ?? s.text;
  const replacement = q.replacement ?? s.replacement;
  const edit = action("Edit Pattern and Test Text…", () => editForm(q, s), { icon: Icons.text, shortcut: "<Ctrl>e" });
  const tokens = explainTokens(q.pattern, q.flags);
  const tokenItems: Item[] = tokens.slice(0, 60).map((t, i) => ({
    id: `token:${i}`,
    title: t.text,
    subtitle: t.description,
    icon: { source: Icons.chevronRight, tint: t.kind === "group" ? "purple" : t.kind === "class" ? "teal" : "gray" },
    section: "Explanation",
    actions: [copy(t.text, "Copy Token"), edit],
  }));
  let re: RegExp;
  try {
    re = compile(q.pattern, q.flags);
  } catch (e) {
    return [{
      id: "error",
      title: (e as Error).message,
      subtitle: literal(q.pattern, q.flags),
      icon: { source: Icons.alert, tint: "red" },
      section: "Result",
      detail: { markdown: `## Invalid pattern\n\n${(e as Error).message}\n\n${fence(literal(q.pattern, q.flags))}` },
      actions: [edit, copy(q.pattern, "Copy Pattern")],
    }, ...tokenItems];
  }
  const { matches, truncated } = findMatches(re, text);
  const groupCount = groupNames(q.pattern).length;
  const all = re.global || re.sticky;
  const shownFlags = q.flags.replace("d", "");
  const flagTags = [...q.flags].map((f) => ({ text: f, color: "blue" as const }));
  const count = `${truncated ? `${matches.length}+` : matches.length}`;
  const items: Item[] = [{
    id: "summary",
    title: matches.length ? `${count} ${matches.length === 1 ? "match" : "matches"}` : "No match",
    subtitle: literal(q.pattern, shownFlags),
    icon: { source: matches.length ? Icons.check : Icons.cross, tint: matches.length ? "green" : "gray" },
    section: "Result",
    accessories: [
      ...(!all && matches.length
        ? [{ tag: "first only", color: "orange" as const, tooltip: "Add the g flag for all" }]
        : []),
      { text: q.text ? "typed text" : "saved text", tooltip: "Test text" },
    ],
    detail: {
      stats: [
        { label: "Matches", value: count, color: matches.length ? "green" : "gray" },
        { label: "Groups", value: groupCount },
        { label: "Characters", value: [...text].length },
      ],
      markdown: `${fence(highlight(text, matches))}${
        !all && matches.length ? "\n\nOnly the first match: add the **g** flag to find them all." : ""
      }`,
      metadata: [
        meta.text("Pattern", literal(q.pattern, shownFlags), { icon: Icons.code }),
        ...(flagTags.length ? [meta.tags("Flags", flagTags)] : []),
        ...[...q.flags].filter((f) => FLAGS[f]).map((f) => meta.text(f, FLAGS[f])),
      ],
    },
    actions: [
      ...patternActions(q.pattern, shownFlags),
      edit,
      ...(matches.length
        ? [copy(matches.map((m) => m.text).join("\n"), "Copy All Matches", { icon: Icons.layers, section: "Copy" })]
        : []),
    ],
  }];
  if (replacement !== undefined) {
    const out = replacePreview(re, text, replacement);
    items.push({
      id: "replace",
      title: oneLine(out) || "(empty)",
      subtitle: `→ ${JSON.stringify(replacement)}`,
      icon: { source: Icons.repeat, tint: "purple" },
      section: "Replace",
      detail: {
        markdown: `${fence(out)}\n\n\`replace(${literal(q.pattern, shownFlags)}, ${JSON.stringify(replacement)})\`${
          all ? "" : "\n\nWithout **g**, only the first match is replaced."
        }`,
      },
      actions: [
        copy(out, "Copy Result"),
        copy(`.replace(${literal(q.pattern, shownFlags)}, ${JSON.stringify(replacement)})`, "Copy replace() Call", {
          icon: Icons.code,
        }),
        edit,
      ],
    });
  }
  matches.slice(0, 100).forEach((m, i) => {
    const groups = m.groups.map((g) => ({
      label: g.name ? `$${g.number} (${g.name})` : `$${g.number}`,
      value: g.value === undefined ? "(not matched)" : g.value === "" ? "(empty)" : oneLine(g.value, 60),
    }));
    const json = JSON.stringify(
      {
        match: m.text,
        index: m.index,
        groups: m.groups.map((g) => g.value ?? null),
        ...(m.groups.some((g) => g.name)
          ? { named: Object.fromEntries(m.groups.filter((g) => g.name).map((g) => [g.name, g.value ?? null])) }
          : {}),
      },
      null,
      2,
    );
    items.push({
      id: `match:${i}`,
      title: m.text === "" ? "(empty match)" : oneLine(m.text),
      subtitle: `${m.index}–${m.end}`,
      icon: { source: Icons.dot, tint: "yellow" },
      section: "Matches",
      keywords: m.groups.map((g) => g.value ?? ""),
      accessories: m.groups.length
        ? [{
          text: plural(m.groups.length, "group", "groups"),
          tooltip: groups.map((g) => `${g.label}: ${g.value}`).join("\n"),
        }]
        : [],
      detail: {
        markdown: fence(context(text, m)),
        metadata: [
          meta.text("Match", oneLine(m.text, 60) || "(empty)", { icon: Icons.search }),
          meta.text("Position", `${m.index} to ${m.end} (${m.end - m.index} chars)`),
          ...(groups.length ? [meta.separator(), ...groups.map((g) => meta.text(g.label, g.value))] : []),
        ],
      },
      actions: [
        copy(m.text, "Copy Match"),
        ...m.groups.filter((g) => g.value).slice(0, 9).map((g) =>
          copy(g.value!, `Copy Group ${g.name ? `“${g.name}”` : g.number}`, { section: "Groups" })
        ),
        copy(json, "Copy as JSON", { icon: Icons.braces, section: "Copy" }),
      ],
    });
  });
  if (matches.length > 100) {
    items.push({
      id: "more",
      title: `${matches.length - 100} more matches`,
      icon: { source: Icons.info, tint: "gray" },
      section: "Matches",
      actions: [copy(matches.map((m) => m.text).join("\n"), "Copy All Matches")],
    });
  }
  items.push(...tokenItems, textItem(q, s));
  return items;
}

function textItem(q: Query | undefined, s: Saved): Item {
  const text = q?.text ?? s.text;
  return {
    id: "text",
    title: oneLine(text),
    subtitle: q?.text ? "Typed after the pattern" : text === SAMPLE_TEXT ? "Sample text: Enter to use yours" : "Saved",
    icon: { source: Icons.text, tint: "blue" },
    section: "Test Text",
    accessories: [{ text: plural(text.split("\n").length, "line", "lines") }],
    detail: { markdown: fence(text) },
    actions: [
      action("Edit Test Text…", () => editForm(q, s), { icon: Icons.text }),
      copy(text, "Copy Test Text"),
      action("Reset to Sample Text", async () => {
        await storage.delete("text");
        await storage.delete("replacement");
        return replace(home({ text: SAMPLE_TEXT }));
      }, { icon: Icons.refresh, section: "Danger", destructive: true, confirm: "Forget your test text?" }),
    ],
  };
}

function recipeItem(r: Recipe, s: Saved): Item {
  const re = compile(r.pattern, r.flags);
  const { matches } = findMatches(re, r.examples);
  const q: Query = { pattern: r.pattern, flags: r.flags, literal: true };
  return {
    id: `recipe:${r.id}`,
    title: r.name,
    subtitle: oneLine(r.pattern, 60),
    icon: { source: Icons.braces, tint: "purple" },
    section: "Library",
    keywords: [r.description, r.id, ...(r.keywords ?? [])],
    accessories: [{ text: `/${r.flags}`, tooltip: [...r.flags].map((f) => FLAGS[f]).join("\n") }],
    detail: {
      markdown: [
        `## ${r.name}`,
        "",
        r.description,
        "",
        fence(literal(r.pattern, r.flags)),
        "",
        "**Examples**",
        "",
        fence(highlight(r.examples, matches)),
      ].join("\n"),
    },
    actions: [
      ...patternActions(r.pattern, r.flags),
      action("Test on the Examples", () => resultsList({ ...q, text: r.examples }, s), {
        icon: Icons.search,
        shortcut: "<Ctrl>t",
        section: "Test",
      }),
      action("Test on My Text", () => resultsList(q, s), { icon: Icons.text, section: "Test" }),
    ],
  };
}

const library = (s: Saved, filter = "") => {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  return LIBRARY.filter((r) => {
    const hay = `${r.name} ${r.id} ${r.description} ${(r.keywords ?? []).join(" ")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  }).map((r) => recipeItem(r, s));
};

const status = (items: Item[]) => {
  const summary = items.find((i) => i.id === "summary" || i.id === "error");
  if (summary) return `${summary.id === "error" ? "Invalid pattern" : summary.title} · ${summary.subtitle}`;
  return `${items.filter((i) => i.section === "Library").length} patterns in the library`;
};

function resultsList(q: Query, s: Saved): ListSpec {
  return list({ title: literal(q.pattern, q.flags), items: resultItems(q, s), status });
}

function home(s: Saved): ListSpec {
  return list({ title: "Regex Tester", items: [textItem(undefined, s), ...library(s)], status });
}

export default list({
  placeholder: "/pattern/flags test text, s/pattern/replacement/g, or a pattern…",
  status,
  async search(query) {
    const s = await saved();
    const q = parseQuery(query);
    if (!q) return [textItem(undefined, s), ...library(s)];
    const items = resultItems(q, s);
    // Plain words also look up the library ("email", "uuid").
    if (!q.literal && /^[a-z][a-z0-9 .-]*$/i.test(q.pattern)) items.splice(1, 0, ...library(s, q.pattern));
    return items;
  },
});
