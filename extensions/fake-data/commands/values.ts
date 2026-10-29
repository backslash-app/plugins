import { action, copy, Icons, type Item, list, meta, paste, refresh } from "@backslash/api";
import {
  FIELDS,
  groupCard,
  groupIban,
  KNOWN_TEST_CARDS,
  type Locale,
  LOCALES,
  luhnValid,
  newSeed,
  sample,
} from "../lib.ts";
import { localeOf, text } from "../ui.ts";

const ICONS: Record<string, string> = {
  Identifiers: Icons.hash,
  Person: Icons.person,
  Address: Icons.home,
  Company: Icons.project,
  Finance: Icons.coin,
  Dates: Icons.calendar,
  Internet: Icons.globe,
  Text: Icons.text,
  Commerce: Icons.package,
  Other: Icons.dice,
};

const again = () => action("New Values", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" });

/** A readable form of the value, when there is one: grouped IBAN or card. */
function pretty(id: string, value: string): string | undefined {
  if (id === "iban") return groupIban(value);
  if (id === "card_number") return groupCard(value);
  if (id === "siret") return value.replace(/^(\d{3})(\d{3})(\d{3})(\d{5})$/, "$1 $2 $3 $4");
  if (id === "siren") return value.replace(/^(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3");
  if (id === "nir") return value.replace(/^(\d)(\d{2})(\d{2})(\d{2})(\d{3})(\d{3})(\d{2})$/, "$1 $2 $3 $4 $5 $6 $7");
  return undefined;
}

export default list({
  placeholder: "Filter: email, iban, siret, card, uuid…",
  filter: { options: [{ value: "auto", title: "Preference" }, ...LOCALES], default: "auto" },
  status: (items) => `${items.length} values · Ctrl+R for new ones`,
  empty: { title: "No value of that kind", icon: Icons.dice },
  actions: [again()],
  items({ filter, preferences }) {
    const locale: Locale = filter === "fr" || filter === "en" ? filter : localeOf(preferences.locale);
    const seed = newSeed();
    const now = Date.now();
    const items: Item[] = FIELDS.filter((f) => f.id !== "id").map((f) => {
      const value = text(sample(f.id, locale, seed, now));
      const shown = pretty(f.id, value);
      const short = value.length > 90 ? `${value.slice(0, 89)}…` : value;
      return {
        id: f.id,
        title: shown ?? short,
        subtitle: f.title,
        section: f.group,
        icon: { source: ICONS[f.group] ?? Icons.dice, tint: "blue" },
        keywords: [f.id, f.title, f.group],
        detail: {
          markdown: value.length > 60 ? value : undefined,
          metadata: [
            meta.text("Kind", f.title),
            meta.text("Field name", f.id, { icon: Icons.braces }),
            meta.text("Locale", LOCALES.find((l) => l.value === locale)!.title, { icon: Icons.globe }),
            ...(shown ? [meta.text("Formatted", shown)] : []),
            ...(["card_number", "siren", "siret"].includes(f.id)
              ? [meta.text("Luhn", luhnValid(value) ? "Valid" : "Invalid", { color: "green" })]
              : []),
            ...(f.id === "iban" ? [meta.text("Checksum", "Valid (mod 97)", { color: "green" })] : []),
          ],
        },
        actions: [
          copy(value, "Copy Value"),
          paste(value, "Paste Value"),
          ...(shown ? [copy(shown, "Copy Formatted", { icon: Icons.text, section: "Copy" })] : []),
          again(),
        ],
      };
    });
    for (const c of KNOWN_TEST_CARDS) {
      items.push({
        id: `known:${c.number}`,
        title: groupCard(c.number),
        subtitle: `${c.brand} · ${c.note}`,
        section: "Documented Test Cards",
        icon: { source: Icons.coin, tint: "green" },
        keywords: ["card", "test", "carte", c.brand],
        detail: {
          markdown:
            "Use any future expiry date and any CVC (4 digits for American Express). These numbers only work in payment sandboxes.",
          metadata: [meta.text("Brand", c.brand), meta.text("Where", c.note)],
        },
        actions: [copy(c.number, "Copy Number"), paste(c.number, "Paste Number")],
      });
    }
    return items;
  },
});
