// Rows, operation menus and forms.

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
  refresh,
  submenu,
  toast,
} from "@backslash/api";
import {
  ago,
  basename,
  describe,
  dirname,
  exifDate,
  extname,
  type Family,
  formatBytes,
  FORMATS,
  installMarkdown,
  mapLink,
  MissingTool,
  type Operation,
  parseGeometry,
  sizeChange,
  type Tools,
  validQuality,
} from "./lib.ts";
import { apply, expandHome, type ImageFile, imageFile, type Result, tilde } from "./system.ts";

/** What this session made, shown on top. */
export const made: ImageFile[] = [];
/** Files opened by path, kept for the session. */
export const opened: ImageFile[] = [];

// The list stays live: a form that adds a file wakes it up (pop() alone doesn't reload it).
const changes = new EventTarget();
const changed = () => changes.dispatchEvent(new Event("change"));

/** Resolves on the next change, or when `signal` aborts. */
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

async function run(op: Operation, paths: string[]): Promise<void> {
  const done: Result[] = [];
  const failed: string[] = [];
  const same = (p: string) => op.kind === "convert" && extname(p).replace("jpeg", "jpg") === op.format;
  const skipped = paths.filter(same).length;
  for (const p of paths.filter((p) => !same(p))) {
    try {
      done.push(await apply(op, p));
    } catch (e) {
      if (e instanceof MissingTool) {
        await toast(e.message, { style: "failure", message: `Install ${e.packages.join(", ")}` });
        return;
      }
      failed.push(`${basename(p)}: ${(e as Error).message}`);
    }
  }
  for (const r of done) {
    const f = await imageFile(r.output);
    if (f) made.unshift(f);
  }
  if (done.length) changed();
  if (!done.length) {
    if (skipped && !failed.length) {
      await toast(`Already ${op.kind === "convert" ? op.format.toUpperCase() : "done"}`, { style: "info" });
      return;
    }
    await toast(`${describe(op)} failed`, { style: "failure", message: failed[0] });
    return;
  }
  const before = done.reduce((s, r) => s + r.before, 0);
  const after = done.reduce((s, r) => s + r.after, 0);
  await toast(
    done.length === 1 ? `Saved ${basename(done[0].output)}` : `${describe(op)}: ${done.length} images`,
    {
      style: failed.length ? "info" : "success",
      message: [
        `${formatBytes(after)} (${sizeChange(before, after)})`,
        skipped ? `${skipped} already ${op.kind === "convert" ? op.format.toUpperCase() : "done"}` : "",
        failed.length ? `${failed.length} failed` : "",
      ]
        .filter(Boolean).join(" · "),
    },
  );
}

const doing = (op: Operation, paths: string[]) => async () => {
  await run(op, paths);
  return refresh();
};

function resizeForm(paths: string[]): FormSpec {
  return form({
    title: "Resize",
    submitTitle: "Resize",
    fields: [
      field.text("size", "New size", {
        required: true,
        placeholder: "50%, 1600 (longest side), 1600x900 (fit in), x720 (height)",
      }),
    ],
    async submit(values) {
      let g;
      try {
        g = parseGeometry(String(values.size ?? ""));
      } catch (e) {
        await toast((e as Error).message, { style: "failure" });
        return;
      }
      await run({ kind: "resize", ...g }, paths);
      return pop();
    },
  });
}

function qualityForm(paths: string[], format?: (typeof FORMATS)[number]): FormSpec {
  return form({
    title: format ? `Convert to ${format.toUpperCase()}` : "Compress",
    submitTitle: format ? "Convert" : "Compress",
    fields: [field.text("quality", "Quality (1–100)", { required: true, value: format === "avif" ? "60" : "80" })],
    async submit(values) {
      let quality: number;
      try {
        quality = validQuality(String(values.quality ?? ""));
      } catch (e) {
        await toast((e as Error).message, { style: "failure" });
        return;
      }
      await run(format ? { kind: "convert", format, quality } : { kind: "compress", quality }, paths);
      return pop();
    },
  });
}

/** The operations, as submenus of the action panel. */
export function operations(paths: string[], t: Tools, gps = false): Action[] {
  const exts = new Set(paths.map(extname));
  const formats = FORMATS.filter((f) => !(exts.size === 1 && (exts.has(f) || (f === "jpg" && exts.has("jpeg")))));
  return [
    submenu("Resize", [
      ...[50, 25].map((p) => action(`${p} %`, doing({ kind: "resize", geometry: `${p}%`, label: `${p}pct` }, paths))),
      ...[3840, 1920, 1280, 800].map((px) =>
        action(`${px} px (longest side)`, doing({ kind: "resize", geometry: `${px}x${px}>`, label: `${px}px` }, paths))
      ),
      action("Custom Size…", () => resizeForm(paths), { icon: Icons.text }),
    ], { icon: Icons.layers, shortcut: "<Ctrl>r", section: "Edit" }),
    submenu("Convert", [
      ...formats.map((f) =>
        action(
          f === "avif" && !t.magickAvif && !t.avifenc ? "AVIF (needs avifenc)" : f.toUpperCase(),
          doing({ kind: "convert", format: f }, paths),
        )
      ),
      ...formats.filter((f) => f !== "png").map((f) =>
        action(`${f.toUpperCase()} with Quality…`, () => qualityForm(paths, f), { icon: Icons.text })
      ),
    ], { icon: Icons.refresh, shortcut: "<Ctrl>t", section: "Edit" }),
    submenu("Compress", [
      ...[85, 75, 60, 40].map((q) => action(`Quality ${q}`, doing({ kind: "compress", quality: q }, paths))),
      action("Custom Quality…", () => qualityForm(paths), { icon: Icons.text }),
    ], { icon: Icons.archive, shortcut: "<Ctrl>e", section: "Edit" }),
    submenu("Rotate & Flip", [
      action("Rotate 90° Right", doing({ kind: "rotate", degrees: 90 }, paths), { icon: Icons.repeat }),
      action("Rotate 90° Left", doing({ kind: "rotate", degrees: 270 }, paths), { icon: Icons.repeat }),
      action("Rotate 180°", doing({ kind: "rotate", degrees: 180 }, paths), { icon: Icons.repeat }),
      action("Flip Horizontally", doing({ kind: "flip", axis: "horizontal" }, paths), { icon: Icons.arrowRight }),
      action("Flip Vertically", doing({ kind: "flip", axis: "vertical" }, paths), { icon: Icons.arrowDown }),
    ], { icon: Icons.repeat, section: "Edit" }),
    action(gps ? "Remove Metadata and Location" : "Remove Metadata", doing({ kind: "strip" }, paths), {
      icon: Icons.shield,
      shortcut: "<Ctrl><Shift>m",
      section: "Edit",
    }),
  ];
}

function photoMetadata(f: ImageFile): Metadata[] {
  const i = f.info ?? {};
  const lines: Metadata[] = [];
  const shot = [i.exposure, i.aperture, i.iso ? `ISO ${i.iso}` : undefined, i.focal].filter((x): x is string => !!x);
  if (i.camera || shot.length || i.taken || i.gps) lines.push(meta.separator());
  if (i.camera) lines.push(meta.text("Camera", i.camera, { icon: Icons.camera }));
  if (i.lens) lines.push(meta.text("Lens", i.lens, { icon: Icons.eye }));
  if (shot.length) lines.push(meta.tags("Exposure", shot));
  const taken = exifDate(i.taken);
  if (taken) {
    lines.push(meta.text("Taken", taken.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }), {
      icon: Icons.calendar,
    }));
  }
  if (i.gps) {
    lines.push(meta.link("Location", `${i.gps.lat.toFixed(4)}, ${i.gps.lon.toFixed(4)}`, mapLink(i.gps)));
  }
  if (i.software) lines.push(meta.text("Software", i.software, { icon: Icons.code }));
  return lines;
}

export function imageItem(f: ImageFile, section: string, t: Tools): Item {
  const w = f.info?.width ?? f.width;
  const h = f.info?.height ?? f.height;
  const dims = w && h ? `${w} × ${h}` : undefined;
  const i = f.info ?? {};
  const fmt = [
    i.format ?? extname(f.path).toUpperCase(),
    i.colorspace,
    i.depth ? `${i.depth}-bit` : undefined,
    i.quality && /jpe?g|webp/i.test(i.format ?? extname(f.path)) ? `quality ${i.quality}` : undefined,
    i.alpha ? "transparency" : undefined,
    i.frames ? `${i.frames} frames` : undefined,
  ].filter((x): x is string => !!x);
  return {
    id: `${section}:${f.path}`,
    title: f.name,
    subtitle: tilde(dirname(f.path)),
    icon: { source: Icons.image, tint: i.gps ? "orange" : "blue" },
    section,
    keywords: [extname(f.path), i.camera ?? ""].filter(Boolean),
    accessories: [
      ...(i.gps ? [{ icon: { source: Icons.pin, tint: "orange" as const }, tooltip: "Contains a GPS location" }] : []),
      ...(dims ? [{ text: dims }] : []),
      { text: formatBytes(f.size) },
    ],
    detail: {
      image: f.path,
      metadata: [
        ...(i.gps ? [meta.tags("Privacy", [{ text: "Contains a GPS location", color: "orange" }])] : []),
        ...(dims ? [meta.text("Dimensions", dims, { icon: Icons.image })] : []),
        meta.tags("Format", fmt),
        meta.text("Size", formatBytes(f.size), { icon: Icons.drive }),
        meta.text("Modified", ago(f.modified), { icon: Icons.clock }),
        meta.text("Folder", tilde(dirname(f.path)), { icon: Icons.folder }),
        ...photoMetadata(f),
      ],
    },
    actions: [
      open(f.path, "Open Picture", { icon: Icons.eye }),
      ...operations([f.path], t, !!i.gps),
      copy(f.path, "Copy Path", { section: "File", shortcut: "<Ctrl><Shift>c" }),
      open(dirname(f.path), "Open Folder", { icon: Icons.folder, section: "File", shortcut: "<Ctrl>o" }),
    ],
  };
}

export function batchItem(files: ImageFile[], t: Tools): Item {
  const total = files.reduce((s, f) => s + f.size, 0);
  const gps = files.filter((f) => f.info?.gps).length;
  return {
    id: "batch",
    title: `All ${files.length} Copied Pictures`,
    subtitle: "Resize, convert or compress them together",
    icon: { source: Icons.layers, tint: "purple" },
    section: "Clipboard",
    accessories: [{ text: formatBytes(total) }],
    detail: {
      stats: [{ label: "pictures", value: files.length }, { label: "total", value: formatBytes(total) }],
      markdown: files.map((f) => `- ${f.name}`).join("\n"),
      metadata: gps ? [meta.tags("Privacy", [{ text: `${gps} with a GPS location`, color: "orange" }])] : [],
    },
    actions: operations(files.map((f) => f.path), t, gps > 0),
  };
}

export function pathForm(): FormSpec {
  return form({
    title: "Open Picture",
    submitTitle: "Open",
    fields: [field.text("path", "Path", { required: true, placeholder: "~/Pictures/photo.jpg" })],
    async submit(values) {
      const path = expandHome(String(values.path ?? ""));
      const f = await imageFile(path).catch(() => undefined);
      if (!f) {
        await toast(`Can't read ${tilde(path)}`, { style: "failure", message: "Pictures must be in your home folder" });
        return;
      }
      opened.unshift(f);
      changed();
      return pop();
    },
  });
}

export function clipboardHint(): Item {
  return {
    id: "clipboard-hint",
    title: "Copy pictures in your file manager",
    subtitle: "They show up here",
    icon: { source: Icons.paste, tint: "gray" },
    section: "Clipboard",
    detail: {
      markdown: [
        "Select pictures in **Files**, **Dolphin**, **Thunar** or **Nemo** and press **Ctrl+C**, then open Image Tools again: they are listed here, to resize, convert or compress together.",
        "",
        "Or press **Ctrl+P** to type a path. The newest pictures of Pictures, Downloads and Desktop are below.",
      ].join("\n"),
    },
    actions: [action("Open Picture by Path", () => pathForm(), { icon: Icons.text })],
  };
}

export function missingMagickItem(fam?: Family): Item {
  return {
    id: "missing-magick",
    title: "Install ImageMagick",
    subtitle: "Needed to resize, convert and compress",
    icon: { source: Icons.alert, tint: "orange" },
    section: "Setup",
    detail: {
      markdown: installMarkdown(
        "Image Tools works with **ImageMagick**. **exiftool** (metadata), **cwebp** and **avifenc** are optional.",
        ["imagemagick", "exiftool"],
        fam,
      ),
    },
    actions: [action("Check Again", () => refresh(), { icon: Icons.refresh })],
  };
}
