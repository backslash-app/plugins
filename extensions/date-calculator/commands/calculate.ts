import { type Action, type Color, copy, Icons, type Item, list, meta, paste } from "@backslash/api";
import {
  type Answer,
  answer,
  type DateOrder,
  type Env,
  EXAMPLES,
  holidaySet,
  localDay,
  long,
  parseQuery,
  type Row,
} from "../lib.ts";

const ICONS: Record<NonNullable<Row["icon"]>, { source: string; tint: Color }> = {
  calendar: { source: Icons.calendar, tint: "blue" },
  clock: { source: Icons.hourglass, tint: "purple" },
  hash: { source: Icons.hash, tint: "gray" },
  briefcase: { source: Icons.project, tint: "teal" },
  flag: { source: Icons.flag, tint: "red" },
  sun: { source: Icons.sun, tint: "yellow" },
  alert: { source: Icons.alert, tint: "orange" },
  info: { source: Icons.info, tint: "blue" },
  arrow: { source: Icons.arrowRight, tint: "green" },
};

const SYNTAX = [
  "## What you can type",
  "",
  "- **Countdowns**: `days until 2026-12-25`, `weeks until christmas`, `jours avant le 14 juillet`, `since 1 jan`",
  "- **Arithmetic**: `2026-03-01 + 45 days`, `today - 2 weeks`, `in 3 months`, `dans 3 semaines`, `45 days ago`, `il y a 2 mois`",
  "- **Working days**: `in 10 working days`, `working days in may`, `jours ouvrés en juin 2027`, `jours ouvrables du 1 mai au 31 mai`",
  "- **Between dates**: `between 1 jan and 14 jul`, `du 1er mai au 15 août`, `2026-01-01 to 2026-06-30`",
  "- **Weeks**: `week 42`, `semaine 3 2027`, `2026-W05`, `week number`, `week of 14 july`",
  "- **A day**: `what day is 14/07/2027`, `quel jour tombe noël 2030`, `next friday`, `pâques 2027`",
  "- **A year or month**: `2027`, `may 2027`, `q3`, `holidays 2027`, `jours fériés`",
  "",
  "Dates: `2026-12-25`, `25/12/2026`, `25 dec`, `December 25`, `1er janvier`, `today`, `demain`, `lundi prochain`.",
  "Without a year, the current one (or the next one for countdowns).",
  "",
  "**Working days** are Monday to Friday; **jours ouvrables** Monday to Saturday. Public holidays are off in both",
  "(set which ones in the preferences).",
].join("\n");

function examples(env: Env, section: string): Item[] {
  return EXAMPLES.map((e) => {
    const a = answer(parseQuery(e.query, env) as Parameters<typeof answer>[0], env);
    return {
      id: `example:${e.query}`,
      title: e.query,
      subtitle: e.title,
      icon: { source: Icons.lightbulb, tint: "yellow" },
      section,
      accessories: a.rows[0] ? [{ text: a.rows[0].title }] : [],
      detail: { markdown: SYNTAX },
      actions: [copy(e.query, "Copy Example")],
    };
  });
}

/** The whole answer as text, one line per row. */
const asText = (a: Answer) =>
  [a.heading, ...a.rows.filter((r) => r.copy).map((r) => `${r.title}${r.subtitle ? ` (${r.subtitle})` : ""}`)].join(
    "\n",
  );

function toItems(a: Answer, query: string): Item[] {
  const all = asText(a);
  return a.rows.map((r) => {
    const actions: Action[] = r.copy
      ? [
        copy(r.copy, r.copy === r.title ? "Copy" : `Copy “${r.copy.length > 40 ? r.copy.slice(0, 39) + "…" : r.copy}”`),
        paste(r.copy, "Paste"),
        ...(r.copy !== r.title ? [copy(r.title, "Copy as Shown", { icon: Icons.text, section: "Copy" })] : []),
        copy(all, "Copy Whole Answer", { icon: Icons.copy, shortcut: "<Ctrl><Shift>c", section: "Copy" }),
        copy(query, "Copy Query", { icon: Icons.search, section: "Copy" }),
      ]
      : [copy(query, "Copy Query")];
    return {
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      icon: r.icon ? ICONS[r.icon] : undefined,
      section: r.section ?? a.heading,
      accessories: r.accessory ? [{ text: r.accessory }] : undefined,
      detail: {
        markdown: r.id === "error" ? SYNTAX : `## ${r.title}\n\n${r.subtitle ?? ""}`,
        metadata: a.facts.map(([label, value]) => meta.text(label, value)),
      },
      actions,
    };
  });
}

let footer = "";

export default list({
  placeholder: "days until 2026-12-25 · 2026-03-01 + 45 days · working days in may · week 42 · dans 3 semaines",
  empty: { title: "Nothing to show", icon: Icons.calendar },
  status: () => footer,
  search(query, { preferences }) {
    const env: Env = {
      today: localDay(),
      holidays: holidaySet(preferences.holidays),
      order: String(preferences.dateOrder ?? "").trim().toLowerCase() === "mdy" ? "mdy" : "dmy" as DateOrder,
    };
    const q = parseQuery(query, env);
    if (q.kind === "empty") {
      footer = `Today is ${long(env.today)}`;
      return [...toItems(answer({ kind: "today" }, env), "today").slice(0, 4), ...examples(env, "Examples: type one")];
    }
    const a = answer(q, env);
    if (q.kind === "error") {
      footer = "Not a date query";
      return [...toItems(a, query), ...examples(env, "Examples")];
    }
    footer = a.heading;
    return toItems(a, query);
  },
});
