import {
  type Action,
  action,
  copy,
  exec,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  basename,
  cssFontFamily,
  dirname,
  type Family,
  FC_FORMAT,
  type FontFace,
  groupFamilies,
  isFontFile,
  pangoFont,
  parseFcList,
  plural,
  previewName,
  regularFile,
  regularStyle,
  SAMPLE,
  SAMPLE_EXTRA,
  tilde,
} from "../lib.ts";
import { HOME, installForm, LEGACY_FONTS, PREVIEWS, USER_FONTS } from "../install.ts";

type Renderer = "pango-view" | "convert";

/** pango-view (Pango) renders by family name; ImageMagick's convert by file. */
async function findRenderer(): Promise<Renderer | undefined> {
  for (const [program, flag] of [["pango-view", "--version"], ["convert", "-version"]] as const) {
    try {
      await exec(program, [flag]);
      return program;
    } catch (err) {
      if (err instanceof Deno.errors.NotFound || err instanceof Deno.errors.NotCapable) continue;
      return program; // Installed, but grumpy about the flag.
    }
  }
  return undefined;
}

async function render(renderer: Renderer, fam: Family, file: string | undefined, out: string): Promise<boolean> {
  const text = `${fam.name}\n${SAMPLE}\n${SAMPLE_EXTRA}`;
  const markup = `<span size="160%">${escapeMarkup(fam.name)}</span>\n${escapeMarkup(`${SAMPLE}\n${SAMPLE_EXTRA}`)}`;
  try {
    if (renderer === "pango-view") {
      // Through a file: pango-view decodes arguments with the locale, which may not be UTF-8.
      const input = `${out}.txt`;
      await Deno.writeTextFile(input, markup);
      await exec("pango-view", [
        "-q",
        `--font=${pangoFont(fam.name, 26)}`,
        "--background=#ffffff",
        "--foreground=#1a1a1a",
        "--margin=28",
        "--dpi=96",
        "--markup",
        `--output=${out}`,
        input,
      ]).finally(() => Deno.remove(input).catch(() => {}));
    } else {
      if (!file) return false;
      await exec("convert", [
        "-background",
        "#ffffff",
        "-fill",
        "#1a1a1a",
        "-font",
        file,
        "-pointsize",
        "26",
        "-bordercolor",
        "#ffffff",
        "-border",
        "28",
        `label:${text}`,
        out,
      ]);
    }
    return true;
  } catch {
    return false;
  }
}

const escapeMarkup = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const exists = (path: string) => Deno.stat(path).then(() => true, () => false);

function sampleMarkdown(fam: Family, home: string): string {
  const files = fam.files.slice(0, 12).map((f) => `- \`${tilde(f, home)}\``);
  if (fam.files.length > 12) files.push(`- … and ${fam.files.length - 12} more`);
  return [
    "```",
    SAMPLE,
    SAMPLE.toUpperCase(),
    SAMPLE_EXTRA,
    fam.mono ? "fn main() { let x = 0x1F; } // 0O Il1| -> => != ===" : "",
    "```",
    "",
    `**${plural(fam.files.length, "file")}**`,
    "",
    ...files,
  ].filter((l, i, all) => l !== "" || all[i - 1] !== "").join("\n");
}

let total = 0;
const families = (n: number) => `${n} ${n === 1 ? "family" : "families"}`;
let rendering = "";

function item(fam: Family, faces: FontFace[], preview?: string): Item {
  const css = cssFontFamily(fam.name, fam.mono);
  const folder = dirname(fam.files[0] ?? USER_FONTS);
  const removable = fam.files.filter((f) => f.startsWith(USER_FONTS + "/"));
  const actions: Action[] = [
    copy(fam.name, "Copy Family Name"),
    copy(css, "Copy CSS font-family", { icon: Icons.braces, shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(fam.files.join("\n"), fam.files.length === 1 ? "Copy File Path" : "Copy File Paths", {
      icon: Icons.file,
      section: "Copy",
    }),
    open(folder, "Open Folder", { icon: Icons.folder, shortcut: "<Ctrl>o" }),
    action("Install Font…", () => installForm("", false), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
  ];
  if (removable.length) {
    actions.push(action("Uninstall", async () => {
      for (const f of removable) await Deno.remove(f);
      await exec("fc-cache", ["-f", USER_FONTS]).catch(() => {});
      await toast(`${fam.name} uninstalled`, { style: "success" });
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Delete ${plural(removable.length, "file")} of ${fam.name} from ~/.local/share/fonts?`,
      section: "Danger",
    }));
  }
  return {
    id: fam.name,
    title: fam.name,
    subtitle: plural(fam.styles.length, "style"),
    icon: { source: Icons.font, tint: fam.user ? "purple" : fam.mono ? "teal" : "blue" },
    section: fam.user ? "Your Fonts" : "System Fonts",
    keywords: [...fam.styles, ...fam.formats, fam.mono ? "monospace" : "", fam.user ? "user" : ""],
    accessories: [
      ...(fam.mono ? [{ tag: "Mono", color: "teal" as const }] : []),
      { text: fam.formats.join(" · "), tooltip: "File formats" },
    ],
    detail: {
      image: preview,
      markdown: sampleMarkdown(fam, HOME),
      metadata: [
        meta.text("Family", fam.name, { icon: Icons.font }),
        meta.tags(
          "Styles",
          fam.styles.map((s) => ({ text: s, color: s === regularStyle(fam.styles) ? "blue" : undefined })),
        ),
        meta.text("Spacing", fam.mono ? "Monospace" : "Proportional", fam.mono ? { color: "teal" } : {}),
        meta.tags("Formats", fam.formats),
        meta.separator(),
        meta.text("Installed", fam.user ? "For you" : "System-wide", { icon: fam.user ? Icons.person : Icons.server }),
        meta.text("Folder", tilde(folder, HOME), { icon: Icons.folder }),
        ...(regularFile(faces, fam.name) ? [meta.text("Regular file", basename(regularFile(faces, fam.name)!))] : []),
        meta.text("CSS", css, { icon: Icons.code }),
      ],
    },
    actions,
  };
}

export default list({
  placeholder: "Search font families, styles…",
  filter: {
    options: [
      { value: "all", title: "All Fonts" },
      { value: "mono", title: "Monospace" },
      { value: "user", title: "Yours" },
    ],
  },
  empty: {
    title: "No fonts found",
    description: "Press Ctrl+N to install one from a .ttf or .otf file, or type its path in the search bar",
    icon: Icons.font,
  },
  status: (items) =>
    `${items.length === total ? families(total) : `${items.length} of ${families(total)}`}${
      rendering ? ` · ${rendering}` : ""
    }`,
  async *items({ filter, query, signal }) {
    let out: string;
    try {
      out = await exec("fc-list", ["--format", FC_FORMAT]);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        throw new Error("fc-list was not found: install fontconfig (it ships with every desktop)");
      }
      throw err;
    }
    const faces = parseFcList(out);
    const all = groupFamilies(faces, [USER_FONTS, LEGACY_FONTS]);
    let shown = all;
    updateCommandMetadata({ subtitle: families(all.length) }).catch(() => {});
    if (filter === "mono") shown = all.filter((f) => f.mono);
    if (filter === "user") shown = all.filter((f) => f.user);
    total = shown.length;

    // A font file path typed before opening: offer to install it first.
    const install: Item[] = isFontFile(query.trim())
      ? [{
        id: "install",
        title: `Install ${basename(query.trim())}`,
        subtitle: "Copy into ~/.local/share/fonts",
        icon: { source: Icons.download, tint: "green" },
        section: "Install",
        keywords: [query],
        actions: [action("Install Font", () => installForm(query.trim(), false), { icon: Icons.download })],
      }]
      : [];

    const previews = new Map<string, string>();
    await Promise.all(shown.map(async (f) => {
      const path = `${PREVIEWS}/${previewName(f.name)}`;
      if (await exists(path)) previews.set(f.name, path);
    }));
    const build = () => [...install, ...shown.map((f) => item(f, faces, previews.get(f.name)))];
    yield build();

    const missing = shown.filter((f) => !previews.has(f.name));
    if (missing.length === 0) return;
    const renderer = await findRenderer();
    if (!renderer) return;
    await Deno.mkdir(PREVIEWS, { recursive: true });
    let done = 0;
    let since = 0;
    const queue = [...missing];
    const worker = async () => {
      for (let fam = queue.shift(); fam && !signal.aborted; fam = queue.shift()) {
        const path = `${PREVIEWS}/${previewName(fam.name)}`;
        if (await render(renderer, fam, regularFile(faces, fam.name), path)) previews.set(fam.name, path);
        done++;
        since++;
      }
    };
    const workers = Promise.all(Array.from({ length: 4 }, worker));
    let finished = false;
    workers.finally(() => finished = true);
    while (!finished && !signal.aborted) {
      await Promise.race([workers, new Promise((r) => setTimeout(r, 1500))]);
      rendering = finished ? "" : `rendering previews ${done}/${missing.length}`;
      if (since > 0 || finished) {
        since = 0;
        yield build();
      }
    }
    rendering = "";
  },
});
