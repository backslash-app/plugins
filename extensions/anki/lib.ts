// AnkiConnect (https://foosoft.net/projects/anki-connect/) responses and
// Anki-specific text handling. Pure functions, no I/O.

export const ANKICONNECT_CODE = "2055492159";
export const ANKICONNECT_URL = "https://ankiweb.net/shared/info/2055492159";
export const ENDPOINT = "http://127.0.0.1:8765";

export interface DeckStats {
  deck_id: number;
  name: string;
  new_count: number;
  learn_count: number;
  review_count: number;
  total_in_deck: number;
}

export interface Deck {
  id: number;
  /** Full name, `Languages::Japanese::Kanji`. */
  name: string;
  /** Last part, `Kanji`. */
  leaf: string;
  /** `Languages › Japanese`, or empty for a top-level deck. */
  parent: string;
  depth: number;
  newCount: number;
  learnCount: number;
  reviewCount: number;
  total: number;
}

/** The request body AnkiConnect expects. */
export function request(action: string, params: Record<string, unknown> = {}, key?: string) {
  return { action, version: 6, params, ...(key ? { key } : {}) };
}

/** The result of an AnkiConnect reply, or its error thrown. */
export function unwrap<T>(reply: unknown): T {
  if (!reply || typeof reply !== "object" || !("result" in reply) || !("error" in reply)) {
    throw new Error("Unexpected answer from AnkiConnect");
  }
  const r = reply as { result: T; error: string | null };
  if (r.error) throw new Error(friendlyError(r.error));
  return r.result;
}

export function friendlyError(error: string): string {
  if (/duplicate/i.test(error)) return "This card already exists in Anki (same first field)";
  if (/valid api key/i.test(error)) return "AnkiConnect wants an API key: set it in Settings → Extensions → Anki";
  if (/deck was not found|deck not found/i.test(error)) return "That deck doesn't exist in Anki any more";
  if (/model was not found/i.test(error)) return "That note type doesn't exist in Anki";
  if (/empty/i.test(error)) return "The first field of the card is empty";
  return `Anki: ${error}`;
}

/** Decks from `deckNamesAndIds` and `getDeckStats`, in Anki's tree order. */
export function buildDecks(names: Record<string, number>, stats: Record<string, DeckStats>): Deck[] {
  const byId = new Map(Object.values(stats ?? {}).map((s) => [s.deck_id, s]));
  return Object.entries(names ?? {})
    .map(([name, id]) => {
      const parts = name.split("::");
      const s = byId.get(id);
      return {
        id,
        name,
        leaf: parts[parts.length - 1],
        parent: parts.slice(0, -1).join(" › "),
        depth: parts.length - 1,
        newCount: s?.new_count ?? 0,
        learnCount: s?.learn_count ?? 0,
        reviewCount: s?.review_count ?? 0,
        total: s?.total_in_deck ?? 0,
      };
    })
    .sort((a, b) => compareDeckNames(a.name, b.name));
}

/** Tree order: `A`, `A::B`, `A::C`, `B`, case-insensitive like Anki. */
export function compareDeckNames(a: string, b: string): number {
  const pa = a.toLowerCase().split("::");
  const pb = b.toLowerCase().split("::");
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const c = pa[i].localeCompare(pb[i]);
    if (c) return c;
  }
  return pa.length - pb.length;
}

/** Anki hides the empty "Default" deck when there are others. */
export function visibleDecks(decks: Deck[]): Deck[] {
  if (decks.length <= 1) return decks;
  return decks.filter((d) => !(d.id === 1 && d.total === 0 && !decks.some((x) => x.name.startsWith("Default::"))));
}

/** Cards to study today: counts of parent decks include their children, so only top-level decks are summed. */
export function dueToday(decks: Deck[]): { review: number; learn: number; new: number } {
  const top = decks.filter((d) => d.depth === 0);
  return {
    review: top.reduce((n, d) => n + d.reviewCount, 0),
    learn: top.reduce((n, d) => n + d.learnCount, 0),
    new: top.reduce((n, d) => n + d.newCount, 0),
  };
}

/** "42 due today", "42 due today · 10 new", or undefined when there is nothing to do. */
export function dueSubtitle(decks: Deck[]): string | undefined {
  const d = dueToday(decks);
  const due = d.review + d.learn;
  if (!due && !d.new) return undefined;
  return [due ? `${due} due today` : "", d.new ? `${d.new} new` : ""].filter(Boolean).join(" · ");
}

// --- Notes -------------------------------------------------------------------

export const BASIC = "Basic";
export const REVERSED = "Basic (and reversed card)";
export const CLOZE = "Cloze";

export const isCloze = (text: string) => /\{\{c\d+::/.test(text);

/** Note types for the form: the three standard ones first, then the user's own. */
export function orderModels(models: string[]): string[] {
  const standard = [BASIC, REVERSED, CLOZE].filter((m) => models.includes(m));
  return [...standard, ...models.filter((m) => !standard.includes(m)).sort((a, b) => a.localeCompare(b))];
}

/** `tag1, tag2 #tag3` → `["tag1", "tag2", "tag3"]`; Anki tags have no spaces. */
export function parseTags(input: string): string[] {
  return [...new Set(input.split(/[\s,]+/).map((t) => t.replace(/^#/, "")).filter(Boolean))];
}

export interface QuickCard {
  front: string;
  back: string;
  tags: string[];
  cloze: boolean;
}

/**
 * `front :: back #tag`: the first ` :: ` outside a `{{c1::…}}` cloze splits
 * the sides; `#words` at the end are tags. A text with a cloze and no back
 * is a cloze card.
 */
export function parseQuickAdd(input: string): QuickCard {
  let text = input.trim();
  const tags: string[] = [];
  for (;;) {
    const m = /\s+#([^\s#]+)$/.exec(text);
    if (!m) break;
    tags.unshift(m[1]);
    text = text.slice(0, m.index).trimEnd();
  }
  // A spaced " :: " wins, so `std::vector :: dynamic array` keeps its `::`.
  const at = (spaced: boolean) => {
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      if (text.startsWith("{{", i)) {
        depth++;
        i++;
      } else if (text.startsWith("}}", i)) {
        depth = Math.max(0, depth - 1);
        i++;
      } else if (
        depth === 0 && text.startsWith("::", i) &&
        (!spaced || (/\s/.test(text[i - 1] ?? "") && /\s/.test(text[i + 2] ?? "")))
      ) {
        return i;
      }
    }
    return -1;
  };
  const spacedAt = at(true);
  const split = spacedAt >= 0 ? spacedAt : at(false);
  const front = (split < 0 ? text : text.slice(0, split)).trim();
  const back = split < 0 ? "" : text.slice(split + 2).trim();
  const cloze = isCloze(front);
  if (!front) throw new Error("Type the front of the card: “front :: back”");
  if (!back && !cloze) throw new Error("Separate the two sides with “::”, e.g. “bonjour :: hello”");
  return { front, back, tags, cloze };
}

/** The fields of a note: the first two fields of the note type get the front and back. */
export function noteFields(fieldNames: string[], front: string, back: string): Record<string, string> {
  const names = fieldNames.length ? fieldNames : ["Front", "Back"];
  const fields: Record<string, string> = {};
  for (const n of names) fields[n] = "";
  fields[names[0]] = front;
  if (names[1]) fields[names[1]] = back;
  return fields;
}

/** Plain text typed in the launcher, as Anki's HTML fields: escaped, line breaks kept. */
export function toHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, "<br>");
}

export function noteParams(o: { deck: string; model: string; fields: Record<string, string>; tags: string[] }) {
  return {
    note: {
      deckName: o.deck,
      modelName: o.model,
      fields: o.fields,
      tags: o.tags,
      options: { allowDuplicate: false, duplicateScope: "deck" },
    },
  };
}

// --- Installing Anki ---------------------------------------------------------

/** `ID` and `ID_LIKE` of /etc/os-release. */
export function osIds(osRelease: string): string[] {
  const get = (k: string) => new RegExp(`^${k}=(.*)$`, "m").exec(osRelease)?.[1]?.replace(/^["']|["']$/g, "") ?? "";
  return `${get("ID")} ${get("ID_LIKE")}`.toLowerCase().split(/\s+/).filter(Boolean);
}

/** How to install Anki on this distribution; Flathub always works and is up to date. */
export function installHint(osRelease: string): string[] {
  const ids = osIds(osRelease);
  const lines = ["- Flathub (any distribution): `flatpak install flathub net.ankiweb.Anki`"];
  if (ids.some((i) => ["arch", "manjaro", "endeavouros"].includes(i))) lines.push("- Arch (AUR): `yay -S anki-bin`");
  else if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) lines.push("- Fedora: `sudo dnf install anki`");
  else if (ids.some((i) => ["debian", "ubuntu"].includes(i))) {
    lines.push("- Debian, Ubuntu: `sudo apt install anki` (often an older version)");
  } else if (ids.some((i) => ["opensuse", "suse"].includes(i))) lines.push("- openSUSE: `sudo zypper install anki`");
  else if (ids.includes("nixos")) lines.push("- NixOS: add `anki` to your packages");
  lines.push("- Or the official build from [apps.ankiweb.net](https://apps.ankiweb.net)");
  return lines;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
