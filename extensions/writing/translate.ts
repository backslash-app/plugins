// Translation views and actions shared by the translate commands.

import {
  type Action,
  action,
  clipboard,
  close,
  type Context,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  replace,
  storage,
  submenu,
} from "@backslash/api";
import {
  base,
  COMMON,
  DEEPL_KEYS_URL,
  DEEPL_SIGNUP_URL,
  deeplKey,
  FORMALITIES,
  type Formality,
  formatNumber,
  KeyError,
  languageName,
  languagePrefs,
  LANGUAGES,
  mdEscape,
  normalizeTarget,
  preview,
  supportsFormality,
  type Translation,
  type Usage,
} from "./lib.ts";
import { clipboardText, selection, translate, translateSmart, usage } from "./services.ts";

export interface Setup {
  key: string;
  /** The preferred target, for "en" → EN-US/EN-GB. */
  target: string;
}

export interface Recent {
  original: string;
  text: string;
  source: string;
  target: string;
  at: number;
}

export async function recents(): Promise<Recent[]> {
  return ((await storage.get("recent").catch(() => undefined)) as Recent[] | undefined) ?? [];
}

async function remember(t: Translation) {
  const list = (await recents()).filter((r) => !(r.original === t.original && r.target === t.target));
  list.unshift({ original: t.original, text: t.text, source: t.source, target: t.target, at: Date.now() });
  await storage.set("recent", list.slice(0, 10) as never).catch(() => {});
}

/** "French → English (US)". */
export const direction = (t: Pick<Translation, "source" | "target">) =>
  `${t.source ? languageName(t.source) : "Auto"} → ${languageName(t.target)}`;

/** DeepL's web translator with the same text, to compare alternatives. */
export function deeplWebUrl(t: Pick<Translation, "source" | "target" | "original">): string {
  const lang = (c: string) => c.toLowerCase();
  return `https://www.deepl.com/translator#${lang(t.source || "auto")}/${lang(t.target)}/${
    encodeURIComponent(t.original)
  }`;
}

export function translationMarkdown(t: Translation): string {
  const quoted = t.original.trim().split("\n").map((l) => `> ${mdEscape(l)}`).join("\n");
  return `${mdEscape(t.text).replace(/\n/g, "  \n")}\n\n---\n\n${quoted}`;
}

export function translationMetadata(t: Translation, u?: Usage): Metadata[] {
  const lines: Metadata[] = [
    meta.text("From", t.source ? `${languageName(t.source)} (detected)` : "Auto", { icon: Icons.globe }),
    meta.text("To", languageName(t.target), { icon: Icons.arrowRight }),
  ];
  if (supportsFormality(t.target)) {
    lines.push(meta.text("Formality", FORMALITIES.find((f) => f.value === t.formality)?.title ?? "Default"));
  }
  lines.push(meta.text("Characters", formatNumber([...t.original].length)));
  if (u) {
    lines.push(
      meta.separator(),
      meta.progress(
        "DeepL this month",
        u.character_count / u.character_limit,
        `${formatNumber(u.character_count)} of ${formatNumber(u.character_limit)}`,
      ),
    );
  }
  return lines;
}

/** Translates again (other language, formality, swapped) and shows it. */
async function retranslate(
  setup: Setup,
  t: Translation,
  options: { text?: string; target: string; source?: string; formality?: Formality },
): Promise<DetailSpec> {
  const next = await translate(setup.key, options.text ?? t.original, options.target, {
    source: options.source,
    formality: options.formality ?? t.formality,
  });
  return translationDetail(setup, next, await usage(setup.key));
}

/** Copy, paste, swap, other languages, formality. `inDetail` swaps the view instead of stacking. */
export function translationActions(setup: Setup, t: Translation, inDetail = false): Action[] {
  const go = (view: Promise<DetailSpec>) => inDetail ? view.then(replace) : view;
  const swapTarget = t.source ? normalizeTarget(t.source, setup.target) : undefined;
  const others = [...COMMON, ...Object.keys(LANGUAGES).filter((c) => !COMMON.includes(c))].filter((c) =>
    c !== t.target
  );
  return [
    action("Copy Translation", async () => {
      await remember(t);
      await clipboard.write(t.text);
      return close("Copied");
    }, { icon: Icons.copy }),
    action("Paste Translation", async () => {
      // Replaces the selection in the app the text came from.
      await remember(t);
      await clipboard.paste(t.text);
    }, { icon: Icons.paste }),
    ...(swapTarget
      ? [action(
        `Swap Languages (${languageName(t.target)} → ${languageName(swapTarget)})`,
        () => go(retranslate(setup, t, { text: t.text, target: swapTarget, source: base(t.target) })),
        { icon: Icons.repeat, shortcut: "<Ctrl>s", section: "Translation" },
      )]
      : []),
    submenu(
      "Translate To",
      others.map((code) =>
        action(languageName(code), () => go(retranslate(setup, t, { target: code })), { icon: Icons.globe })
      ),
      { icon: Icons.globe, shortcut: "<Ctrl>l", section: "Translation" },
    ),
    ...(supportsFormality(t.target)
      ? [submenu(
        "Formality",
        FORMALITIES.map((f) =>
          action(
            `${f.title}${f.value === t.formality ? " ✓" : ""}`,
            () => go(retranslate(setup, t, { target: t.target, source: t.source || undefined, formality: f.value })),
            { icon: Icons.person },
          )
        ),
        { icon: Icons.person, shortcut: "<Ctrl>f", section: "Translation" },
      )]
      : []),
    open(deeplWebUrl(t), "Open in DeepL", { section: "Translation" }),
    copy(t.original, "Copy Original", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(`${t.original}\n\n${t.text}`, "Copy Original and Translation", { section: "Copy" }),
  ];
}

export function translationDetail(setup: Setup, t: Translation, u?: Usage): DetailSpec {
  return detail({
    title: direction(t),
    markdown: translationMarkdown(t),
    metadata: translationMetadata(t, u),
    status: `${direction(t)} · DeepL`,
    actions: translationActions(setup, t, true),
  });
}

export function translationItem(setup: Setup, t: Translation, u?: Usage): Item {
  return {
    id: "translation",
    title: preview(t.text, 120),
    subtitle: direction(t),
    icon: { source: Icons.globe, tint: "blue" },
    detail: { markdown: translationMarkdown(t), metadata: translationMetadata(t, u) },
    actions: translationActions(setup, t),
  };
}

export function keyHelp(message: string) {
  return {
    title: message,
    markdown: [
      "## Connect DeepL",
      "",
      "1. Sign up for the **DeepL API Free** plan (500,000 characters a month, no charge) or Pro.",
      "2. Open **Account → API Keys** and copy your key.",
      "3. Paste it in **Settings → Extensions → DeepL & LanguageTool → Configure → DeepL API key**.",
      "",
      "Free keys end with `:fx`; Backslash picks the right DeepL server by itself.",
    ].join("\n"),
    actions: [
      open(DEEPL_KEYS_URL, "Open DeepL API Keys", { icon: Icons.key }),
      open(DEEPL_SIGNUP_URL, "Sign Up for DeepL API", { icon: Icons.plus }),
    ],
  };
}

export function keyItem(message: string): Item {
  const help = keyHelp(message);
  return {
    id: "setup",
    title: message,
    subtitle: "A free DeepL API key translates 500,000 characters a month",
    icon: { source: Icons.key, tint: "orange" },
    detail: { markdown: help.markdown },
    actions: help.actions,
  };
}

/** "Translate Selected Text" and "Translate Clipboard": one translation, shown as a detail. */
export async function translateFrom(ctx: Context, from: "selection" | "clipboard") {
  let key: string;
  try {
    key = deeplKey(ctx.preferences);
  } catch (e) {
    if (!(e instanceof KeyError)) throw e;
    const help = keyHelp(e.message);
    return detail({ title: "DeepL", markdown: help.markdown, actions: help.actions });
  }
  const text = from === "selection" ? await selection() : await clipboardText();
  if (!text.trim()) {
    throw new Error(from === "selection" ? "Select some text first" : "The clipboard has no text");
  }
  const langs = languagePrefs(ctx.preferences);
  try {
    const t = await translateSmart(key, text, { ...langs }, ctx.signal);
    return translationDetail({ key, target: langs.target }, t, await usage(key, ctx.signal));
  } catch (e) {
    if (!(e instanceof KeyError)) throw e;
    const help = keyHelp(e.message);
    return detail({ title: "DeepL", markdown: help.markdown, actions: help.actions });
  }
}
