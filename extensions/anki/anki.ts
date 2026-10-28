// Talking to Anki through AnkiConnect, and the shared views.

import {
  type Action,
  action,
  close,
  type Context,
  copy,
  exec,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  open,
  pop,
  storage,
  toast,
} from "@backslash/api";
import {
  ANKICONNECT_CODE,
  ANKICONNECT_URL,
  BASIC,
  buildDecks,
  CLOZE,
  type Deck,
  type DeckStats,
  ENDPOINT,
  installHint,
  noteFields,
  noteParams,
  orderModels,
  parseTags,
  request,
  REVERSED,
  toHtml,
  unwrap,
  visibleDecks,
} from "./lib.ts";

/** Anki is closed, or AnkiConnect isn't installed. */
export class OfflineError extends Error {}

export async function anki<T>(
  ctx: Pick<Context, "preferences">,
  action: string,
  params: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const key = String(ctx.preferences.apiKey ?? "").trim() || undefined;
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request(action, params, key)),
      signal: signal ?? AbortSignal.timeout(action === "sync" ? 120_000 : 10_000),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new OfflineError("Anki isn't running, or AnkiConnect isn't installed");
  }
  if (!res.ok) throw new Error(`AnkiConnect answered ${res.status}`);
  return unwrap<T>(await res.json());
}

export async function loadDecks(ctx: Pick<Context, "preferences">, signal?: AbortSignal): Promise<Deck[]> {
  const names = await anki<Record<string, number>>(ctx, "deckNamesAndIds", {}, signal);
  const stats = await anki<Record<string, DeckStats>>(ctx, "getDeckStats", { decks: Object.keys(names) }, signal);
  return visibleDecks(buildDecks(names, stats));
}

// --- Opening Anki ------------------------------------------------------------

const HOME = Deno.env.get("HOME") ?? "";

/** Where Anki is installed, in the order tried; the same paths as `[permissions] read`. */
const LAUNCHERS = [
  "/usr/bin/anki",
  "/usr/local/bin/anki",
  `${HOME}/.local/bin/anki`,
  "/var/lib/flatpak/exports/bin/net.ankiweb.Anki",
  `${HOME}/.local/share/flatpak/exports/bin/net.ankiweb.Anki`,
  "/snap/bin/anki",
];

export async function findAnki(): Promise<string | undefined> {
  for (const path of LAUNCHERS) {
    if (await Deno.stat(path).then((s) => s.isFile, () => false)) return path;
  }
  return undefined;
}

/** Brings Anki to the front, or starts it in the background (it outlives this command). */
export async function openAnki(ctx: Pick<Context, "preferences">): Promise<string> {
  try {
    await anki(ctx, "guiDeckBrowser");
    return "Anki opened";
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e;
  }
  const path = await findAnki();
  if (!path) throw new Error("Anki isn't installed: get it from apps.ankiweb.net or Flathub (net.ankiweb.Anki)");
  await exec("systemd-run", ["--user", "--collect", "--quiet", `--unit=anki-${Date.now()}`, path]);
  return "Starting Anki…";
}

export async function sync(ctx: Pick<Context, "preferences">): Promise<string> {
  await anki(ctx, "sync");
  return "Anki synced with AnkiWeb";
}

// --- Empty state -------------------------------------------------------------

export async function offlineItems(ctx: Pick<Context, "preferences">): Promise<Item[]> {
  const installed = await findAnki();
  const osRelease = await Deno.readTextFile("/etc/os-release").catch(() => "");
  const steps = [
    "## Connect Anki",
    "",
    "Backslash talks to Anki through the **AnkiConnect** add-on, while Anki is open.",
    "",
    "1. In Anki: **Tools → Add-ons → Get Add-ons…**",
    `2. Paste the code **${ANKICONNECT_CODE}** and press OK`,
    "3. Restart Anki, and keep it open (it can stay minimized)",
    "",
    "If you set an API key in AnkiConnect's config, enter it in **Settings → Extensions → Anki**.",
  ];
  const items: Item[] = [{
    id: "offline",
    title: installed ? "Anki isn't running, or AnkiConnect isn't installed" : "Anki isn't installed",
    subtitle: installed ? `Add-on code ${ANKICONNECT_CODE}` : "Install Anki, then the AnkiConnect add-on",
    icon: { source: Icons.plug, tint: "orange" },
    detail: {
      markdown: installed
        ? steps.join("\n")
        : ["## Install Anki", "", ...installHint(osRelease), "", ...steps.slice(2)].join("\n"),
    },
    actions: [
      ...(installed
        ? [action("Open Anki", async () => close(await openAnki(ctx)), { icon: Icons.external })]
        : [open("https://apps.ankiweb.net", "Download Anki", { icon: Icons.download })]),
      open(ANKICONNECT_URL, "AnkiConnect on AnkiWeb", { icon: Icons.globe }),
      copy(ANKICONNECT_CODE, "Copy Add-on Code", { shortcut: "<Ctrl><Shift>c" }),
    ],
  }];
  return items;
}

// --- Adding cards ------------------------------------------------------------

export async function lastDeck(): Promise<string | undefined> {
  const d = await storage.get("lastDeck").catch(() => undefined);
  return typeof d === "string" ? d : undefined;
}

async function lastModel(): Promise<string | undefined> {
  const d = await storage.get("lastModel").catch(() => undefined);
  return typeof d === "string" ? d : undefined;
}

export async function addCard(
  ctx: Pick<Context, "preferences">,
  o: { deck: string; model: string; front: string; back: string; tags: string[]; rememberModel?: boolean },
): Promise<number> {
  const names = await anki<string[]>(ctx, "modelFieldNames", { modelName: o.model });
  const fields = noteFields(names, toHtml(o.front), toHtml(o.back));
  const id = await anki<number>(ctx, "addNote", noteParams({ deck: o.deck, model: o.model, fields, tags: o.tags }));
  await storage.set("lastDeck", o.deck);
  // Quick adds pick their type from the text: only the form's choice is remembered.
  if (o.rememberModel) await storage.set("lastModel", o.model);
  return id;
}

/** The deck to add to: the remembered one if it still exists, else the first one that isn't empty "Default". */
export function pickDeck(decks: string[], remembered: string | undefined): string {
  if (remembered && decks.includes(remembered)) return remembered;
  return decks.find((d) => d !== "Default") ?? decks[0] ?? "Default";
}

export async function addCardForm(
  ctx: Pick<Context, "preferences">,
  o: { deck?: string; front?: string; standalone?: boolean } = {},
): Promise<FormSpec> {
  const [decks, models, remembered, model] = await Promise.all([
    anki<string[]>(ctx, "deckNames"),
    anki<string[]>(ctx, "modelNames").then(orderModels, () => [BASIC, REVERSED, CLOZE]),
    lastDeck(),
    lastModel(),
  ]);
  decks.sort((a, b) => a.localeCompare(b));
  return form({
    title: "Add Card",
    submitTitle: "Add Card",
    fields: [
      field.dropdown("deck", "Deck", decks.map((d) => ({ value: d, title: d.replace(/::/g, " › ") })), {
        value: o.deck ?? pickDeck(decks, remembered),
      }),
      field.dropdown("model", "Note type", models, {
        value: model && models.includes(model) ? model : models[0],
      }),
      field.textArea("front", "Front", {
        required: true,
        placeholder: "Question, or a cloze: The capital of France is {{c1::Paris}}",
        value: o.front ?? "",
      }),
      field.textArea("back", "Back", { placeholder: "Answer (Back Extra for a cloze)" }),
      field.text("tags", "Tags", { placeholder: "french vocabulary" }),
    ],
    async submit(values) {
      const front = String(values.front ?? "").trim();
      if (!front) throw new Error("The front of the card is empty");
      const modelName = String(values.model || BASIC);
      if (/cloze/i.test(modelName) && !/\{\{c\d+::/.test(front)) {
        throw new Error("A cloze card needs a deletion: {{c1::hidden text}}");
      }
      const deck = String(values.deck || pickDeck(decks, remembered));
      await addCard(ctx, {
        deck,
        model: modelName,
        front,
        back: String(values.back ?? ""),
        tags: parseTags(String(values.tags ?? "")),
        rememberModel: true,
      });
      await toast(`Card added to ${deck.replace(/::/g, " › ")}`, { style: "success" });
      return o.standalone ? close(`Added to ${deck.replace(/::/g, " › ")}`) : pop();
    },
  });
}

export function ankiActions(ctx: Pick<Context, "preferences">): Action[] {
  return [
    action("Sync", async () => close(await sync(ctx)), {
      icon: Icons.refresh,
      shortcut: "<Ctrl><Shift>s",
      section: "Anki",
    }),
    action("Open Anki", async () => close(await openAnki(ctx)), { icon: Icons.external, section: "Anki" }),
  ];
}
