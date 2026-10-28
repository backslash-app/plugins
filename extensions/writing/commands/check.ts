import {
  type Action,
  action,
  clipboard,
  close,
  type Context,
  copy,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  open,
  pop,
  submenu,
  toast,
} from "@backslash/api";
import {
  applyAll,
  applyFix,
  type CheckResult,
  fixTitle,
  highlight,
  highlightAll,
  type Issue,
  issueLook,
  LT_LOCAL_DOCS,
  LT_PUBLIC,
  ltSettings,
  mdEscape,
  preview,
  words,
} from "../lib.ts";
import { live, notifyChanged } from "../live.ts";
import { check, clipboardText, selection } from "../services.ts";

type Source = "Typed" | "Selection" | "Clipboard";

/** The text being corrected; fixes change it, then it is checked again. */
const state = { text: "", source: "Typed" as Source, ignored: new Set<string>() };
let status = "";

function setText(text: string, message?: string) {
  state.text = text;
  notifyChanged();
  if (message) toast(message, { style: "success" }).catch(() => {});
}

/** Paste replaces the selection when the text came from it, so it reads "Replace Selection". */
function outActions(text: string, section?: string, what = "Corrected Text"): Action[] {
  return [
    action(state.source === "Selection" ? "Replace Selection" : `Paste ${what}`, async () => {
      await clipboard.paste(text);
    }, { icon: Icons.paste, section }),
    action(`Copy ${what}`, async () => {
      await clipboard.write(text);
      return close("Copied");
    }, { icon: Icons.copy, shortcut: "<Ctrl><Shift>c", section: section ?? "Copy" }),
  ];
}

function otherTextAction(): Action {
  return action("Check Other Text…", () =>
    form({
      title: "Check text",
      submitTitle: "Check",
      fields: [field.textArea("text", "Text", { required: true, value: state.text })],
      submit(values) {
        state.source = "Typed";
        state.ignored.clear();
        setText(String(values.text));
        return pop();
      },
    }), { icon: Icons.text, shortcut: "<Ctrl>n", section: "Text" });
}

function summaryItem(result: CheckResult, issues: Issue[]): Item {
  const fixable = issues.filter((i) => i.replacements.length).length;
  const counts = new Map<string, number>();
  for (const i of issues) counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
  const all = applyAll(state.text, issues);
  return {
    id: "summary",
    title: issues.length
      ? `${issues.length} issue${issues.length === 1 ? "" : "s"} in “${preview(state.text, 50)}”`
      : "No issues found",
    subtitle: issues.length ? undefined : preview(state.text, 70),
    icon: issues.length ? { source: Icons.alert, tint: "orange" } : { source: Icons.done, tint: "green" },
    section: "Text",
    detail: {
      stats: [
        { label: "Issues", value: issues.length, color: issues.length ? "orange" : "green" },
        { label: "Words", value: words(state.text) },
      ],
      markdown: highlightAll(state.text, issues),
      metadata: [
        meta.text("Language", result.language || "Unknown", { icon: Icons.globe }),
        meta.text("Text from", state.source),
        meta.text("Characters", [...state.text].length),
        ...(counts.size ? [meta.tags("Issues", [...counts].map(([c, n]) => `${c} · ${n}`))] : []),
      ],
    },
    actions: [
      ...(fixable
        ? [
          action(`Apply All Suggestions (${all.applied})`, () => {
            setText(all.text, `Applied ${all.applied} suggestion${all.applied === 1 ? "" : "s"}, checking again`);
          }, { icon: Icons.sparkle }),
          ...outActions(all.text, "Apply All Then"),
        ]
        : outActions(state.text)),
      ...(fixable ? [copy(state.text, "Copy Text as It Is", { section: "Copy" })] : []),
      otherTextAction(),
    ],
  };
}

function issueItem(issue: Issue): Item {
  const look = issueLook(issue.type);
  const fix = (value: string) => () =>
    setText(applyFix(state.text, issue, value), `“${issue.error}” → “${value || "(removed)"}”, checking again`);
  const suggestions = issue.replacements;
  return {
    id: issue.id,
    title: fixTitle(issue),
    subtitle: issue.shortMessage || issue.message,
    icon: { source: look.icon, tint: look.tint },
    section: issue.category,
    keywords: [issue.message, issue.rule, look.label],
    accessories: suggestions.length > 1 ? [{ text: `+${suggestions.length - 1}`, tooltip: "More suggestions" }] : [],
    detail: {
      markdown: [
        highlight(issue),
        "",
        mdEscape(issue.message),
        ...(suggestions.length
          ? ["", `**Suggestions:** ${suggestions.slice(0, 8).map((s) => `\`${s || "(remove)"}\``).join(", ")}`]
          : []),
      ].join("\n"),
      metadata: [
        meta.tags("Kind", [{ text: look.label, color: look.tint }]),
        meta.text("Category", issue.category),
        ...(issue.rule ? [meta.text("Rule", issue.rule)] : []),
        ...(issue.url ? [meta.link("Explanation", new URL(issue.url).hostname, issue.url)] : []),
      ],
    },
    actions: [
      ...(suggestions.length
        ? [
          action(`Apply “${suggestions[0] || "(remove)"}”`, fix(suggestions[0]), { icon: Icons.check }),
          submenu(
            "Suggestions",
            suggestions.map((s) => action(s || "(remove)", fix(s), { icon: Icons.check })),
            { icon: Icons.sparkle, shortcut: "<Ctrl>s" },
          ),
        ]
        : []),
      action("Ignore", () => {
        state.ignored.add(`${issue.ruleId}:${issue.error}`);
        notifyChanged();
      }, { icon: Icons.eyeOff, shortcut: "<Ctrl>i" }),
      ...(issue.url ? [open(issue.url, "Learn More", { icon: Icons.book })] : []),
      action("Apply All Suggestions", () => {
        const all = applyAll(state.text, current);
        setText(all.text, `Applied ${all.applied} suggestion${all.applied === 1 ? "" : "s"}, checking again`);
      }, { icon: Icons.sparkle, shortcut: "<Ctrl><Shift>a", section: "Text" }),
      ...outActions(state.text, "Text", "Text"),
      otherTextAction(),
    ],
  };
}

let current: Issue[] = [];

export default async (ctx: Context) => {
  const typed = ctx.query.trim();
  const sel = typed ? "" : await selection();
  const clip = typed || sel.trim() ? "" : await clipboardText();
  state.text = typed || sel || clip;
  state.source = typed ? "Typed" : sel.trim() ? "Selection" : "Clipboard";
  state.ignored.clear();
  const settings = ltSettings(ctx.preferences);
  const server = settings.url === LT_PUBLIC
    ? "LanguageTool"
    : settings.premium
    ? "LanguageTool Premium"
    : new URL(settings.url).host;
  return list({
    placeholder: "Filter issues…",
    empty: state.text.trim() ? { title: "No issues found", icon: Icons.done } : {
      title: "Nothing to check",
      description: "Select or copy some text, or type it after the command. Ctrl+N to write it here.",
      icon: Icons.text,
    },
    status: () => status,
    actions: [
      otherTextAction(),
      ...(settings.url.includes("localhost") || settings.url.includes("127.0.0.1")
        ? [open(LT_LOCAL_DOCS, "LanguageTool Server Guide", { icon: Icons.book })]
        : []),
    ],
    items: ({ signal }) =>
      live(async (): Promise<Item[]> => {
        if (!state.text.trim()) {
          status = server;
          return [];
        }
        const result = await check(state.text, settings, signal);
        current = result.issues.filter((i) => !state.ignored.has(`${i.ruleId}:${i.error}`));
        status = [
          `${current.length} issue${current.length === 1 ? "" : "s"}`,
          result.language,
          state.source === "Typed" ? "typed" : `from ${state.source.toLowerCase()}`,
          server,
        ].filter(Boolean).join(" · ");
        return [summaryItem(result, current), ...current.map(issueItem)];
      }, signal),
  });
};
