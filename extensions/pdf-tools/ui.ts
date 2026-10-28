// Rows, operations and forms.

import {
  type Action,
  action,
  copy,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  pop,
  submenu,
  toast,
} from "@backslash/api";
import {
  ago,
  basename,
  dirname,
  type Family,
  formatBytes,
  installMarkdown,
  MissingTool,
  type Op,
  pageCount,
  parseRanges,
  pdfDate,
  PRESETS,
  rangeText,
  type Rotation,
  sizeChange,
  stem,
  toolOf,
  type Tools,
} from "./lib.ts";
import {
  CACHE,
  expandHome,
  free,
  loadAll,
  mergeList,
  type PdfFile,
  pdfFile,
  perform,
  setMergeList,
  tilde,
  WrongPassword,
} from "./system.ts";

/** What this session made, and files opened by path. */
export const made: PdfFile[] = [];
export const opened: PdfFile[] = [];

// Views of a command share one process: a change wakes the live lists up.
const changes = new EventTarget();
export const changed = () => {
  changes.dispatchEvent(new Event("change"));
};
export function nextChange(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      changes.removeEventListener("change", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    changes.addEventListener("change", done);
    signal.addEventListener("abort", done);
  });
}

/** Runs an operation and reports it; true when it worked. */
export async function execute(op: Op, what: string, o: { before?: number; result?: string; folder?: string } = {}) {
  await toast(`${what}…`);
  try {
    await perform(op);
  } catch (e) {
    if (e instanceof MissingTool) {
      await toast(e.message, { style: "failure", message: `Install ${e.packages.join(", ")}` });
    } else if (e instanceof WrongPassword) {
      await toast("Wrong password", { style: "failure" });
    } else await toast(`${what} failed`, { style: "failure", message: (e as Error).message });
    return false;
  }
  if (o.result) {
    const f = await pdfFile(o.result);
    if (f) {
      made.unshift(f);
      await toast(`Saved ${basename(o.result)}`, {
        style: "success",
        message: o.before ? `${formatBytes(f.size)} (${sizeChange(o.before, f.size)})` : formatBytes(f.size),
      });
    }
  } else if (o.folder) {
    let n = 0;
    for await (const _ of Deno.readDir(o.folder)) n++;
    await toast(`${n} file${n === 1 ? "" : "s"} in ${basename(o.folder)}`, { style: "success" });
  }
  changed();
  return true;
}

// ---------------------------------------------------------------------------
// Operations on one file

function extractForm(f: PdfFile): FormSpec {
  const total = f.info?.pages ?? 0;
  return form({
    title: `Extract Pages of ${f.name}`,
    submitTitle: "Extract",
    fields: [
      field.text("pages", total ? `Pages (1–${total})` : "Pages", {
        required: true,
        placeholder: "1-3, 5, 8-",
      }),
    ],
    async submit(values) {
      let ranges;
      try {
        ranges = parseRanges(String(values.pages ?? ""), total);
      } catch (e) {
        await toast((e as Error).message, { style: "failure" });
        return;
      }
      const output = free(dirname(f.path), `${stem(f.path)}-pages-${rangeText(ranges).replace(/,/g, "_")}`, "pdf");
      const tmp = `${CACHE}/tmp-${Date.now()}`;
      const n = pageCount(ranges);
      if (
        await execute(
          { kind: "extract", input: f.path, ranges, output, tmp },
          `Extracting ${n} page${n === 1 ? "" : "s"}`,
          { result: output },
        )
      ) {
        return pop();
      }
    },
  });
}

function passwordForm(f: PdfFile): FormSpec {
  return form({
    title: `Remove the Password of ${f.name}`,
    submitTitle: "Remove Password",
    fields: [field.password("password", "Password", { required: true })],
    async submit(values) {
      const output = free(dirname(f.path), `${stem(f.path)}-unlocked`, "pdf");
      const op: Op = { kind: "decrypt", input: f.path, password: String(values.password ?? ""), output };
      if (await execute(op, "Removing the password", { result: output })) return pop();
    },
  });
}

const run = (op: Op, what: string, o: Parameters<typeof execute>[2]) => async () => {
  await execute(op, what, o);
};

export function fileActions(f: PdfFile, t: Tools): Action[] {
  const dir = dirname(f.path);
  const s = stem(f.path);
  const out = (suffix: string) => free(dir, `${s}-${suffix}`, "pdf");
  const actions: Action[] = [
    action("Add to Merge List", async () => {
      const list = await mergeList();
      if (!list.includes(f.path)) await setMergeList([...list, f.path]);
      changed();
      await toast(`Added to the merge list (${list.includes(f.path) ? list.length : list.length + 1})`, {
        style: "success",
      });
    }, { icon: Icons.plus, shortcut: "<Ctrl>m", section: "Combine" }),
    action("Extract Pages…", () => extractForm(f), { icon: Icons.file, shortcut: "<Ctrl>e", section: "Pages" }),
    action("Split into Single Pages", () => {
      const folder = free(dir, `${s} pages`, "");
      return run({ kind: "split", input: f.path, dir: folder, name: s }, "Splitting", { folder })();
    }, { icon: Icons.layers, section: "Pages" }),
    submenu(
      "Rotate",
      ([[90, "90° Right"], [270, "90° Left"], [180, "180°"]] as [Rotation, string][]).map(([deg, title]) =>
        action(title, () => {
          const output = out("rotated");
          return run({ kind: "rotate", input: f.path, degrees: deg, output }, "Rotating", { result: output })();
        }, { icon: Icons.repeat })
      ),
      { icon: Icons.repeat, shortcut: "<Ctrl>r", section: "Pages" },
    ),
    submenu(
      "Compress",
      PRESETS.filter((p) => (p.preset === "lossless" ? t.qpdf : t.gs) || (!t.gs && !t.qpdf && p.preset === "ebook"))
        .map((p) =>
          action(p.title, () => {
            const output = out(p.preset === "lossless" ? "optimized" : p.preset);
            return run({ kind: "compress", input: f.path, preset: p.preset, output }, "Compressing", {
              result: output,
              before: f.size,
            })();
          }, { icon: Icons.archive })
        ),
      { icon: Icons.archive, shortcut: "<Ctrl><Shift>c", section: "Edit" },
    ),
    ...(f.info?.encrypted
      ? [action("Remove Password…", () => passwordForm(f), { icon: Icons.lock, section: "Edit" })]
      : []),
    submenu(
      "Convert to Pictures",
      ([["png", 150], ["jpg", 150], ["png", 300]] as ["png" | "jpg", number][]).map(([format, dpi]) =>
        action(`${format.toUpperCase()}, ${dpi} dpi`, () => {
          const folder = free(dir, `${s} pictures`, "");
          return run({ kind: "toImages", input: f.path, format, dpi, dir: folder, name: s }, "Converting", {
            folder,
          })();
        }, { icon: Icons.image })
      ),
      { icon: Icons.image, section: "Export" },
    ),
    copy(f.path, "Copy Path", { section: "File", shortcut: "<Ctrl><Alt>c" }),
    open(dir, "Open Folder", { icon: Icons.folder, section: "File", shortcut: "<Ctrl>o" }),
  ];
  return [open(f.path, "Open PDF", { icon: Icons.eye }), ...actions];
}

function infoMetadata(f: PdfFile, t: Tools): Metadata[] {
  const i = f.info ?? {};
  const date = (label: string, text?: string) => {
    const d = pdfDate(text);
    return d
      ? [meta.text(label, d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }), { icon: Icons.calendar })]
      : [];
  };
  const tags = [
    ...(i.encrypted ? [{ text: i.locked ? "Password to open" : "Protected", color: "orange" as const }] : []),
    ...(i.form && i.form !== "none" ? [{ text: "Form", color: "blue" as const }] : []),
    ...(i.tagged ? [{ text: "Tagged", color: "green" as const }] : []),
    ...(i.version ? [`PDF ${i.version}`] : []),
  ];
  return [
    ...(i.title ? [meta.text("Title", i.title, { icon: Icons.text })] : []),
    ...(i.author ? [meta.person("Author", i.author)] : []),
    ...(i.subject ? [meta.text("Subject", i.subject)] : []),
    ...(tags.length ? [meta.tags("Document", tags)] : []),
    ...(i.pageSize ? [meta.text("Page size", i.pageSize, { icon: Icons.file })] : []),
    ...date("Created", i.created),
    ...date("Modified", i.modified),
    ...(i.creator || i.producer
      ? [
        meta.text(
          "Made with",
          [i.creator, i.producer].filter(Boolean).filter((v, n, a) => a.indexOf(v) === n).join(" · "),
          {
            icon: Icons.code,
          },
        ),
      ]
      : []),
    meta.separator(),
    meta.text("Folder", tilde(dirname(f.path)), { icon: Icons.folder }),
    meta.text("Changed", ago(f.modified), { icon: Icons.clock }),
    ...(toolOf({ kind: "compress", input: "", preset: "ebook", output: "" }, t)
      ? []
      : [meta.tags("Compress", [{ text: "needs Ghostscript", color: "gray" }])]),
  ];
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export function pdfItem(f: PdfFile, section: string, t: Tools, merging: string[]): Item {
  const i = f.info ?? {};
  const inList = merging.indexOf(f.path);
  return {
    id: `${section}:${f.path}`,
    title: f.name,
    subtitle: i.title && norm(i.title) !== norm(stem(f.path)) ? i.title : tilde(dirname(f.path)),
    icon: { source: i.encrypted ? Icons.lock : Icons.file, tint: i.encrypted ? "orange" : "red" },
    section,
    keywords: [i.title ?? "", i.author ?? ""].filter(Boolean),
    accessories: [
      ...(inList >= 0 ? [{ tag: `merge #${inList + 1}`, color: "purple" as const }] : []),
      ...(i.pages ? [{ text: `${i.pages} p.` }] : []),
      { text: formatBytes(f.size) },
    ],
    detail: {
      image: f.preview,
      stats: [
        ...(i.pages ? [{ label: i.pages === 1 ? "page" : "pages", value: i.pages }] : []),
        { label: "size", value: formatBytes(f.size) },
      ],
      metadata: infoMetadata(f, t),
    },
    actions: fileActions(f, t),
  };
}

// ---------------------------------------------------------------------------
// Several files

export async function mergeFiles(paths: string[]): Promise<boolean> {
  if (paths.length < 2) {
    await toast("Pick at least two PDFs to merge", { style: "failure" });
    return false;
  }
  const output = free(dirname(paths[0]), `${stem(paths[0])}-merged`, "pdf");
  return await execute({ kind: "merge", inputs: paths, output }, `Merging ${paths.length} PDFs`, { result: output });
}

export function mergeBatchItem(files: PdfFile[]): Item {
  const pages = files.reduce((s, f) => s + (f.info?.pages ?? 0), 0);
  return {
    id: "merge-copied",
    title: `Merge ${files.length} Copied PDFs`,
    subtitle: "In the order they were copied",
    icon: { source: Icons.layers, tint: "purple" },
    section: "Clipboard",
    detail: {
      stats: [{ label: "files", value: files.length }, ...(pages ? [{ label: "pages", value: pages }] : [])],
      markdown: files.map((f, n) => `${n + 1}. ${f.name}${f.info?.pages ? ` (${f.info.pages} p.)` : ""}`).join("\n"),
    },
    actions: [
      action("Merge Now", () => mergeFiles(files.map((f) => f.path)).then(() => undefined), { icon: Icons.layers }),
      action("Add All to Merge List", async () => {
        const list = await mergeList();
        await setMergeList([...list, ...files.map((f) => f.path).filter((p) => !list.includes(p))]);
        changed();
        await toast("Added to the merge list: reorder them there", { style: "success" });
      }, { icon: Icons.plus, shortcut: "<Ctrl>m" }),
    ],
  };
}

export function imagesToPdfItem(images: string[], t: Tools): Item {
  const tool = toolOf({ kind: "fromImages", inputs: images, output: "" }, t);
  return {
    id: "from-images",
    title: images.length === 1
      ? "Make a PDF from the Copied Picture"
      : `Make a PDF from ${images.length} Copied Pictures`,
    subtitle: tool ? "One page per picture, in order" : "Needs img2pdf or ImageMagick",
    icon: { source: Icons.image, tint: tool ? "blue" : "gray" },
    section: "Clipboard",
    detail: {
      markdown: images.map((p, n) => `${n + 1}. ${basename(p)}`).join("\n"),
      metadata: [meta.text("Tool", tool ?? "Not installed", { icon: Icons.terminal })],
    },
    actions: [
      action("Make PDF", async () => {
        const output = free(dirname(images[0]), stem(images[0]), "pdf");
        await execute({ kind: "fromImages", inputs: images, output }, "Making the PDF", { result: output });
      }, { icon: Icons.file }),
    ],
  };
}

export function pathForm(): FormSpec {
  return form({
    title: "Open PDF",
    submitTitle: "Open",
    fields: [field.text("path", "Path", { required: true, placeholder: "~/Documents/report.pdf" })],
    async submit(values) {
      const path = expandHome(String(values.path ?? ""));
      const f = await pdfFile(path).catch(() => undefined);
      if (!f) {
        await toast(`Can't read ${tilde(path)}`, { style: "failure", message: "Files must be in your home folder" });
        return;
      }
      await loadAll([f]);
      opened.unshift(f);
      changed();
      return pop();
    },
  });
}

export function clipboardHint(): Item {
  return {
    id: "clipboard-hint",
    title: "Copy PDFs in your file manager",
    subtitle: "They show up here, in order",
    icon: { source: Icons.paste, tint: "gray" },
    section: "Clipboard",
    detail: {
      markdown: [
        "Select PDFs (or pictures, to make a PDF of them) in **Files**, **Dolphin**, **Thunar** or **Nemo** and press **Ctrl+C**, then open PDF Tools again.",
        "",
        "Or press **Ctrl+P** to type a path. Your recent PDFs from Downloads, Documents and Desktop are below.",
      ].join("\n"),
    },
    actions: [action("Open PDF by Path", () => pathForm(), { icon: Icons.text })],
  };
}

export function missingToolsItem(fam?: Family): Item {
  return {
    id: "missing",
    title: "Install the PDF tools",
    subtitle: "qpdf, Ghostscript and poppler",
    icon: { source: Icons.alert, tint: "orange" },
    section: "Setup",
    detail: {
      markdown: installMarkdown(
        "PDF Tools uses **qpdf** (merge, pages, rotate, passwords), **Ghostscript** (compress) and **poppler** (info, previews, pictures). Any one of them is enough to start.",
        ["qpdf", "ghostscript", "pdfinfo"],
        fam,
      ),
    },
    actions: [],
  };
}
