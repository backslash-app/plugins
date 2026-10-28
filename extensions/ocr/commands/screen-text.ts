import { action, close, copy, Icons, type Item, list, meta, paste, refresh, submenu, toast } from "@backslash/api";
import {
  ago,
  describeLanguages,
  type Family,
  FAMILY_NAMES,
  firstLine,
  grabberInstall,
  installLanguage,
  installTesseract,
  languageName,
  verbatim,
  words,
} from "../lib.ts";
import {
  family,
  history,
  Missing,
  preferredLanguages,
  recognize,
  type Recognized,
  type Setup,
  setup,
} from "../system.ts";

const families = (fam?: Family): Family[] => fam ? [fam] : ["debian", "fedora", "arch", "suse"];

const read = (languages: string, s: Setup) => async () => {
  try {
    await recognize(languages, { known: s });
  } catch (e) {
    if (e instanceof Missing) {
      await toast(e.message, { style: "failure" });
      return;
    }
    throw e;
  }
  return close();
};

function readItems(s: Setup, languages: string, fam?: Family): Item[] {
  if (!s.tesseract) {
    return [{
      id: "missing-tesseract",
      title: "Tesseract is not installed",
      subtitle: "the text recognition engine",
      icon: { source: Icons.alert, tint: "orange" },
      section: "Read",
      detail: {
        markdown: [
          "Backslash reads text with **Tesseract**, offline. Install it with the languages you read, then open this command again.",
          ...families(fam).map((f) =>
            `**${FAMILY_NAMES[f]}**\n\n\`${installTesseract(f, [...new Set(["eng", ...languages.split("+")])])}\``
          ),
        ].join("\n\n"),
      },
      actions: [action("Check Again", () => refresh(), { icon: Icons.refresh })],
    }];
  }
  if (!s.grabber || (s.grabber === "grim" && !s.slurp)) {
    return [{
      id: "missing-grabber",
      title: "Nothing to select an area with",
      subtitle: s.grabber === "grim" ? "slurp is missing" : "no screenshot tool",
      icon: { source: Icons.alert, tint: "orange" },
      section: "Read",
      detail: {
        markdown: [
          "To read text, Backslash first grabs the area you select with **grim + slurp** (Sway, Hyprland, wlroots), **gnome-screenshot** (GNOME), **spectacle** (KDE) or **maim** (X11).",
          ...families(fam).map((f) => `**${FAMILY_NAMES[f]}**\n\n\`${grabberInstall(s.session, f)}\``),
        ].join("\n\n"),
      },
      actions: [action("Check Again", () => refresh(), { icon: Icons.refresh })],
    }];
  }
  const others = s.languages.filter((l) => !languages.split("+").includes(l));
  return [{
    id: "read",
    title: "Read Text from Screen",
    subtitle: describeLanguages(languages),
    icon: { source: Icons.scan, tint: "blue" },
    section: "Read",
    keywords: ["ocr", "select", "sélection", "texte"],
    detail: {
      markdown:
        "Select an area: its text is copied to the clipboard and kept below. A notification shows what was read.",
      metadata: [
        meta.tags("Languages", languages.split("+").map((l) => ({ text: languageName(l), color: "blue" as const }))),
        meta.text("Engine", `Tesseract ${s.tesseract}`, { icon: Icons.sparkle }),
        meta.text("Selection", s.grabber === "grim" ? "grim + slurp" : s.grabber, { icon: Icons.scan }),
        meta.text("Offline", "Nothing leaves your computer", { icon: Icons.lock }),
      ],
    },
    actions: [
      action("Read Text", read(languages, s), { icon: Icons.scan }),
      ...(others.length
        ? [submenu(
          "Read in Another Language",
          others.map((l) => action(languageName(l), read(l, s), { icon: Icons.globe })),
          { icon: Icons.globe, shortcut: "<Ctrl>l" },
        )]
        : []),
    ],
  }];
}

function recentItem(r: Recognized): Item {
  const n = words(r.text);
  return {
    id: r.path,
    title: firstLine(r.text) || "(blank)",
    subtitle: ago(r.date),
    icon: { source: Icons.text, tint: "gray" },
    section: "Recent",
    keywords: [r.text.slice(0, 500)],
    accessories: [{ text: `${n} word${n === 1 ? "" : "s"}` }],
    detail: {
      markdown: verbatim(r.text),
      metadata: [
        meta.text("Read", new Date(r.date).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }), {
          icon: Icons.clock,
        }),
        meta.text("Words", n),
        meta.text("Characters", r.text.length),
      ],
    },
    actions: [
      copy(r.text, "Copy Text"),
      paste(r.text, "Paste Text"),
      copy(r.text.replace(/\s*\n\s*/g, " ").trim(), "Copy as One Line", { section: "Copy" }),
      action("Delete", async () => {
        await Deno.remove(r.path);
        return refresh();
      }, { icon: Icons.trash, destructive: true, shortcut: "<Ctrl>Delete", section: "Danger" }),
      action("Clear History", async () => {
        for (const h of await history()) await Deno.remove(h.path).catch(() => {});
        return refresh();
      }, { icon: Icons.trash, destructive: true, confirm: "Delete every recognized text?", section: "Danger" }),
    ],
  };
}

function languageItem(code: string, chosen: string[], s: Setup, fam?: Family): Item {
  const active = chosen.includes(code);
  return {
    id: `lang:${code}`,
    title: languageName(code),
    subtitle: code,
    icon: { source: Icons.globe, tint: active ? "green" : "gray" },
    section: "Installed Languages",
    keywords: [code],
    accessories: active ? [{ tag: "Default", color: "green" }] : [],
    detail: {
      markdown: active
        ? "Used by **Read Text from Screen**. Change the languages in the extension's preferences."
        : `Add \`${code}\` to the **Languages** preference (e.g. \`eng+${code}\`) to read it by default.`,
      metadata: [
        meta.text("Code", code, { icon: Icons.tag }),
        meta.text("Default", active ? "Yes" : "No", { icon: active ? Icons.check : Icons.minus }),
        ...(fam && code !== "osd" ? [meta.text("Package", installLanguage(fam, code).split(" ").pop()!)] : []),
      ],
    },
    actions: [
      action(`Read Text in ${languageName(code)}`, read(code, s), { icon: Icons.scan }),
      copy(code, "Copy Code", { section: "Copy" }),
      copy([...new Set([...chosen, code])].join("+"), "Copy Preference Value", { section: "Copy" }),
    ],
  };
}

const moreLanguages = (fam?: Family): Item => ({
  id: "more-languages",
  title: "Add a Language…",
  subtitle: "install its model",
  icon: { source: Icons.plus, tint: "gray" },
  section: "Installed Languages",
  detail: {
    markdown: [
      "Tesseract reads one model per language. Install the ones you need, e.g. French:",
      ...families(fam).map((f) => `**${FAMILY_NAMES[f]}**\n\n\`${installLanguage(f, "fra")}\``),
    ].join("\n\n"),
  },
  actions: [action("Check Again", () => refresh(), { icon: Icons.refresh })],
});

export default list({
  placeholder: "Read text, or search what you read…",
  empty: { title: "Nothing here", icon: Icons.scan },
  status: (items) => {
    const n = items.filter((i) => i.section === "Recent").length;
    const langs = items.filter((i) => i.section === "Installed Languages" && i.id !== "more-languages").length;
    return [n && `${n} recognized text${n > 1 ? "s" : ""}`, langs && `${langs} languages`].filter(Boolean).join(
      " · ",
    ) ||
      "Text from Screen";
  },
  items: async ({ preferences }) => {
    const [s, fam, recent] = await Promise.all([setup(), family(), history()]);
    const languages = preferredLanguages(preferences);
    const chosen = languages.split("+");
    return [
      ...readItems(s, languages, fam),
      ...recent.map(recentItem),
      ...(s.tesseract ? [...s.languages.map((l) => languageItem(l, chosen, s, fam)), moreLanguages(fam)] : []),
    ];
  },
});
