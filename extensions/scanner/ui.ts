// The scan form, the page-by-page view for multi-page PDFs, the result view, and the rows
// for scanners and saved scans.

import {
  type Action,
  action,
  clipboard,
  close,
  copy,
  detail,
  type DetailSpec,
  field,
  form,
  Icons,
  type Item,
  meta,
  open,
  replace,
  submenu,
  toast,
} from "@backslash/api";
import {
  type Format,
  hasFeeder,
  installCommand,
  type Job,
  languages,
  type Options,
  osFamily,
  pickMode,
  pickResolution,
  pickSource,
  type Preset,
  preset as presetById,
  PRESETS,
  type ScanFile,
  type Scanner,
  size,
  type Source,
  when,
} from "./lib.ts";
import {
  cleanUp,
  last,
  options,
  osRelease,
  recognize,
  remember,
  type Saved,
  saveImages,
  savePdf,
  scanFeeder,
  scanPage,
  SCANS,
  tilde,
  trash,
  workDir,
} from "./system.ts";

export interface Prefs {
  languages?: string;
  ocr?: boolean;
}

export const changes = new EventTarget();
export const changed = () => changes.dispatchEvent(new Event("change"));

interface Request {
  scanner: Scanner;
  preset: Preset;
  source: Source;
  name?: string;
  ocr: boolean;
  /** Flatbed PDF: ask for another page after each one. */
  pages: boolean;
  langs: string;
}

function job(r: Request, o: Options): Job {
  return {
    device: r.scanner.id,
    mode: pickMode(o, r.preset.mode),
    resolution: pickResolution(o, r.preset.resolution),
    source: pickSource(o, r.source),
    feeder: r.source !== "flatbed",
  };
}

const pageFormat = (f: Format): "png" | "jpeg" => (f === "jpeg" ? "jpeg" : "png");

/** Starts a scan: the whole feeder, or one flatbed page (then more, page by page, for a PDF). */
export async function startScan(r: Request): Promise<DetailSpec> {
  const o = await options(r.scanner.id);
  const j = job(r, o);
  await remember({ device: r.scanner.id, preset: r.preset.id, source: r.source });
  const dir = await workDir();
  try {
    if (j.feeder) {
      await toast(`Scanning the feeder at ${j.resolution} dpi…`);
      return await finish(r, await scanFeeder(j, dir), dir);
    }
    await toast(`Scanning at ${j.resolution} dpi…`);
    const page = await scanPage(j, dir, 1, pageFormat(r.preset.format));
    if (r.preset.format === "pdf" && r.pages) return pagesView(r, j, dir, [page]);
    return await finish(r, [page], dir);
  } catch (e) {
    await cleanUp(dir);
    throw e;
  }
}

async function finish(r: Request, pages: string[], dir: string): Promise<DetailSpec> {
  if (r.ocr) await toast("Recognizing text…");
  const saved = r.preset.format === "pdf"
    ? [await savePdf(pages, r.name, r.ocr, r.langs)]
    : await saveImages(pages, r.name, r.preset.format, r.ocr, r.langs);
  await cleanUp(dir);
  changed();
  return resultView(r, saved, pages.length);
}

function pagesView(r: Request, j: Job, dir: string, pages: string[]): DetailSpec {
  const n = pages.length;
  return detail({
    title: `${n} Page${n === 1 ? "" : "s"} Scanned`,
    markdown: `## Page ${n} scanned\n\nPut the next page on the glass, then **Enter**. ` +
      `**Ctrl+Enter** saves the ${n}-page PDF.`,
    stats: [{ label: "Pages", value: n }, { label: "Resolution", value: `${j.resolution} dpi` }],
    metadata: [
      meta.text("Scanner", r.scanner.name, { icon: Icons.printer }),
      meta.text("Preset", r.preset.title, { icon: Icons.settings }),
      meta.text("Saved to", tilde(SCANS), { icon: Icons.folder }),
    ],
    actions: [
      action("Scan Next Page", async () => {
        await toast(`Scanning page ${n + 1}…`);
        const page = await scanPage(j, dir, n + 1, "png");
        return replace(pagesView(r, j, dir, [...pages, page]));
      }, { icon: Icons.scan }),
      action(`Save PDF (${n} Page${n === 1 ? "" : "s"})`, async () => replace(await finish(r, pages, dir)), {
        icon: Icons.download,
      }),
      action("Discard Pages", async () => {
        await cleanUp(dir);
        return close("Scan discarded");
      }, { icon: Icons.trash, destructive: true, confirm: `Discard the ${n} scanned page${n === 1 ? "" : "s"}?` }),
    ],
  });
}

function resultView(r: Request, saved: Saved[], pages: number): DetailSpec {
  const first = saved[0];
  const notes = saved.map((s) => s.note).filter(Boolean);
  const text = saved.find((s) => s.ocr === "tesseract" && !s.path.endsWith(".pdf"));
  return detail({
    title: "Scan Saved",
    markdown: [
      `## ${saved.length > 1 ? `${saved.length} files saved` : first.path.split("/").pop()}`,
      "",
      ...saved.map((s) => `- \`${tilde(s.path)}\``),
      ...(notes.length ? ["", ...notes.map((n) => `> ${n}`)] : []),
    ].join("\n"),
    stats: [
      { label: "Pages", value: pages },
      { label: "Text", value: saved.some((s) => s.ocr) ? "Recognized" : "None" },
    ],
    metadata: [
      meta.text("Scanner", r.scanner.name, { icon: Icons.printer }),
      meta.text("Preset", `${r.preset.title} · ${r.preset.description}`, { icon: Icons.settings }),
      ...(first.ocr ? [meta.text("Text by", first.ocr, { icon: Icons.text })] : []),
    ],
    actions: [
      open(first.path, saved.length > 1 ? "Open First Page" : "Open Scan", { icon: Icons.file }),
      open(SCANS, "Open Scans Folder", { icon: Icons.folder, shortcut: "<Ctrl>o" }),
      copy(first.path, "Copy Path", { section: "Copy" }),
      ...(text ? [action("Copy Recognized Text", () => copyText(text.path), { section: "Copy" })] : []),
      action("Scan Again", async () => replace(await startScan(r)), { icon: Icons.scan, shortcut: "<Ctrl>r" }),
    ],
  });
}

async function copyText(image: string) {
  const text = await Deno.readTextFile(image.replace(/\.[^.]+$/, ".txt")).catch(() => "");
  if (!text.trim()) throw new Error("No text was recognized");
  await clipboard.write(text.trim());
  return close("Text copied");
}

// ---------------------------------------------------------------------------
// The form

export async function scanForm(scanners: Scanner[], prefs: Prefs, preselect?: string) {
  if (!scanners.length) throw new Error("No scanner found: turn it on, or connect it, then try again");
  const remembered = await last();
  const device = scanners.find((s) => s.id === (preselect ?? remembered.device)) ?? scanners[0];
  // The scanner's own options decide whether a feeder is offered (cached after the first time).
  const o = await options(device.id).catch(() => undefined);
  const feeder = o ? hasFeeder(o) : true;
  return form({
    title: "Scan",
    submitTitle: "Scan",
    fields: [
      field.dropdown("scanner", "Scanner", scanners.map((s) => ({ value: s.id, title: s.name })), { value: device.id }),
      field.dropdown(
        "preset",
        "Preset",
        PRESETS.map((p) => ({ value: p.id, title: `${p.title} · ${p.description}` })),
        {
          value: presetById(remembered.preset).id,
        },
      ),
      field.dropdown(
        "source",
        "Source",
        [
          { value: "flatbed", title: "Flatbed (glass)" },
          ...(feeder
            ? [{ value: "adf", title: "Document feeder (ADF)" }, {
              value: "duplex",
              title: "Document feeder, both sides",
            }]
            : []),
        ],
        { value: feeder ? remembered.source ?? "flatbed" : "flatbed" },
      ),
      field.text("name", "File name", { placeholder: "Scan 2026-10-29 14.05.12" }),
      field.checkbox("pages", "Several pages from the glass (PDF)", { value: true }),
      field.checkbox("ocr", "Recognize text (searchable PDF, or a .txt for images)", { value: prefs.ocr ?? false }),
    ],
    async submit(values) {
      const scanner = scanners.find((s) => s.id === values.scanner) ?? device;
      return replace(
        await startScan({
          scanner,
          preset: presetById(String(values.preset)),
          source: String(values.source) as Source,
          name: String(values.name ?? "").trim() || undefined,
          ocr: values.ocr === true,
          pages: values.pages === true,
          langs: languages(prefs.languages),
        }),
      );
    },
  });
}

// ---------------------------------------------------------------------------
// Rows

export function scannerItem(s: Scanner, all: Scanner[], prefs: Prefs, stale: boolean): Item {
  const quick = (p: Preset): Action =>
    action(`${p.title} · ${p.description}`, () =>
      startScan({
        scanner: s,
        preset: p,
        source: "flatbed",
        ocr: prefs.ocr ?? false,
        pages: true,
        langs: languages(prefs.languages),
      }));
  return {
    id: `scanner:${s.id}`,
    title: s.name,
    subtitle: s.description,
    icon: { source: Icons.printer, tint: stale ? "gray" : "blue" },
    section: "Scanners",
    keywords: [s.backend, s.network ? "network" : "usb", "scanner"],
    accessories: [
      ...(stale ? [{ text: "Looking…", icon: Icons.inProgress }] : []),
      { tag: s.network ? "Network" : "USB", color: "gray" },
    ],
    detail: {
      metadata: [
        meta.text("Device", s.id, { icon: Icons.hash }),
        meta.text("Backend", s.backend, { icon: Icons.package }),
        meta.text("Connection", s.network ? "Network" : "USB", { icon: s.network ? Icons.wifi : Icons.plug }),
        meta.text("Saved to", tilde(SCANS), { icon: Icons.folder }),
      ],
    },
    actions: [
      action("Scan…", () => scanForm(all, prefs, s.id), { icon: Icons.scan }),
      submenu("Scan Now With", PRESETS.map(quick), { icon: Icons.bolt, shortcut: "<Ctrl>s" }),
      open(SCANS, "Open Scans Folder", { icon: Icons.folder, shortcut: "<Ctrl>o", section: "Scans" }),
      copy(s.id, "Copy Device Name", { section: "Copy" }),
    ],
  };
}

export function scanItem(f: ScanFile, prefs: Prefs): Item {
  const image = ["png", "jpg", "jpeg"].includes(f.ext);
  return {
    id: `scan:${f.path}`,
    title: f.name,
    subtitle: when(f.modified),
    icon: { source: image ? Icons.image : Icons.file, tint: f.ext === "pdf" ? "red" : "purple" },
    section: "Recent Scans",
    keywords: [f.ext, "scan"],
    accessories: [...(f.text ? [{ tag: "Text", color: "green" as const }] : []), { text: size(f.size) }],
    detail: {
      image: image ? f.path : undefined,
      metadata: [
        meta.text("File", tilde(f.path), { icon: Icons.file }),
        meta.text("Size", size(f.size), { icon: Icons.database }),
        meta.text("Scanned", new Date(f.modified).toLocaleString(), { icon: Icons.clock }),
        ...(f.text ? [meta.text("Text", tilde(f.text), { icon: Icons.text })] : []),
      ],
    },
    actions: [
      open(f.path, "Open", { icon: Icons.file }),
      open(SCANS, "Open Scans Folder", { icon: Icons.folder, shortcut: "<Ctrl>o" }),
      copy(f.path, "Copy Path", { section: "Copy" }),
      ...(f.text
        ? [action("Copy Recognized Text", () => copyText(f.path), { section: "Copy", shortcut: "<Ctrl><Shift>c" })]
        : [action(f.ext === "pdf" ? "Make Searchable (OCR)" : "Recognize Text", async () => {
          await toast("Recognizing text…");
          await recognize(f, languages(prefs.languages));
          await toast("Text recognized", { style: "success" });
          changed();
        }, { icon: Icons.text, section: "Text" })]),
      action("Move to Trash", async () => {
        await trash(f);
        await toast(`${f.name} moved to the trash`, { style: "success" });
        changed();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Move ${f.name} to the trash?`,
        shortcut: "<Ctrl>Delete",
        section: "Danger",
      }),
    ],
  };
}

export async function installItem(): Promise<Item> {
  const family = osFamily(await osRelease());
  const command = installCommand("sane", family);
  return {
    id: "install",
    title: "scanimage is not installed",
    subtitle: "Install SANE to scan",
    icon: { source: Icons.alert, tint: "orange" },
    section: "Scanners",
    detail: {
      markdown: [
        "Scanning goes through **SANE**'s `scanimage`; **sane-airscan** finds network scanners (eSCL, WSD):",
        "",
        "```",
        command,
        "```",
        "",
        `Multi-page PDFs need **img2pdf** (\`${installCommand("pdf", family)}\`), searchable PDFs **ocrmypdf** ` +
        `(\`${installCommand("ocr", family)}\`).`,
      ].join("\n"),
    },
    actions: [copy(command, "Copy Install Command")],
  };
}

export function noScannerItem(): Item {
  return {
    id: "none",
    title: "No scanner found",
    subtitle: "Turn it on, connect it, then Ctrl+R",
    icon: { source: Icons.printer, tint: "gray" },
    section: "Scanners",
    detail: {
      markdown: "SANE found no scanner. Network scanners need **sane-airscan**; some brands need their own driver " +
        "(brscan for Brother, epsonscan2 for Epson, hplip for HP). USB scanners may need you in the `scanner` group.",
    },
    actions: [],
  };
}
