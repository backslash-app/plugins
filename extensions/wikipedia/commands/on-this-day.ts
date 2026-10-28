import { type Color, type Context, Icons, type Item, list, type ListSpec, meta } from "@backslash/api";
import { onThisDay } from "../api.ts";
import { type DayKind, languageName, ON_THIS_DAY, truncate } from "../lib.ts";
import { defaultLanguage, pageActions, pageMetadata } from "../ui.ts";

const KINDS: { value: DayKind; title: string; icon: string; tint: Color }[] = [
  { value: "selected", title: "Selected", icon: Icons.starFilled, tint: "yellow" },
  { value: "events", title: "Events", icon: Icons.calendar, tint: "blue" },
  { value: "births", title: "Births", icon: Icons.person, tint: "green" },
  { value: "deaths", title: "Deaths", icon: Icons.person, tint: "gray" },
  { value: "holidays", title: "Holidays", icon: Icons.sparkle, tint: "pink" },
];

/** Events, births, deaths and holidays of today, from Wikipedia's feed. */
export function dayView(preferred: string): ListSpec {
  // The feed exists in a few languages only; English otherwise.
  const lang = ON_THIS_DAY.includes(preferred) ? preferred : "en";
  const today = new Date();
  const date = today.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long" });
  return list({
    title: `On This Day · ${date}`,
    placeholder: "Filter events, births, deaths…",
    filter: { options: KINDS.map(({ value, title }) => ({ value, title })), default: "selected" },
    status: (items) => `${items.length} entries · ${date} · ${languageName(lang)} Wikipedia`,
    empty: { title: "Nothing for today", icon: Icons.calendar },
    async items({ filter, signal }) {
      const kind = KINDS.find((k) => k.value === filter) ?? KINDS[0];
      const entries = (await onThisDay(lang, today, signal)).filter((e) => e.kind === kind.value);
      return entries.map((e, i): Item => {
        const main = e.pages.find((p) => p.image) ?? e.pages[0];
        const ago = e.year !== undefined ? today.getFullYear() - e.year : undefined;
        return {
          id: `${kind.value}:${i}`,
          title: truncate(e.text, 140),
          subtitle: undefined,
          icon: main?.image?.url ?? { source: kind.icon, tint: kind.tint },
          keywords: e.pages.map((p) => p.title),
          accessories: e.year !== undefined ? [{ tag: String(e.year) }] : [],
          detail: {
            image: main?.image?.url,
            stats: e.year !== undefined
              ? [{ label: "Year", value: e.year }, ...(ago! > 0 ? [{ label: "Years ago", value: ago! }] : [])]
              : [],
            markdown: [
              e.text,
              main
                ? `**${main.title}**${main.description ? `: *${main.description}*` : ""}\n\n${
                  truncate(main.extract, 700)
                }`
                : "",
            ]
              .filter(Boolean).join("\n\n"),
            metadata: main
              ? [
                ...pageMetadata(main),
                ...(e.pages.length > 1
                  ? [
                    meta.separator(),
                    meta.tags("Also", e.pages.filter((p) => p !== main).slice(0, 6).map((p) => p.title)),
                  ]
                  : []),
              ]
              : [],
          },
          actions: main ? pageActions(main) : [],
        };
      });
    },
  });
}

export default (ctx: Context) => dayView(defaultLanguage(ctx));
