// Rows, extract and compress actions, and forms.

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
  toast,
} from "@backslash/api";
import {
  ago,
  archiveName,
  archiveStem,
  archiveType,
  canCompress,
  canEncrypt,
  cleanName,
  commonDir,
  dirname,
  extractPlan,
  type Family,
  type Format,
  formatBytes,
  FORMATS,
  installMarkdown,
  listingText,
  MissingTool,
  plural,
  ratio,
  sevenZipEncrypted,
  summarize,
  type Tools,
  unsafeEntry,
} from "./lib.ts";
import {
  compress,
  exists,
  expandHome,
  extract,
  type FileEntry,
  fileEntry,
  free,
  loadListing,
  sizeOf,
  tilde,
  WrongPassword,
} from "./system.ts";

/** What this session made, and files opened by path. */
export const made: FileEntry[] = [];
export const opened: FileEntry[] = [];

// The list stays live: a form that makes or opens a file wakes it up.
const changes = new EventTarget();
export const changed = () => changes.dispatchEvent(new Event("change"));

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

async function report(e: unknown, what: string): Promise<void> {
  if (e instanceof MissingTool) {
    await toast(e.message, { style: "failure", message: `Install ${e.packages.join(", ")}` });
  } else if (e instanceof WrongPassword) {
    await toast("Wrong password", { style: "failure" });
  } else await toast(`${what} failed`, { style: "failure", message: (e as Error).message });
}

async function added(path: string): Promise<void> {
  const f = await fileEntry(path);
  if (!f) return;
  if (archiveType(path)?.kind && archiveType(path)?.kind !== "stream") await loadListing(f);
  made.unshift(f);
  changed();
}

// ---------------------------------------------------------------------------
// Extracting

/** Extracts and reports; true when it worked. */
async function doExtract(f: FileEntry, where: "smart" | "here" | "folder", password?: string): Promise<boolean> {
  const type = archiveType(f.path)!;
  const dir = dirname(f.path);
  let dest: string;
  let reveal: string;
  if (type.kind === "stream") {
    dest = reveal = free(dir, archiveStem(f.path), "");
  } else if (where === "here") {
    dest = dir;
    reveal = dir;
  } else {
    const plan = extractPlan(
      f.path,
      where === "smart" && f.listing ? summarize(f.listing.entries) : undefined,
      exists,
    );
    dest = plan.mode === "here" ? dir : plan.target;
    reveal = plan.target;
  }
  await toast(`Extracting ${f.name}…`);
  try {
    await extract(f.path, dest, password);
  } catch (e) {
    await report(e, "Extracting");
    return false;
  }
  const entry = await fileEntry(reveal);
  if (entry && reveal !== dir) {
    made.unshift(entry);
    changed();
  }
  await toast(
    reveal === dir ? `Extracted in ${tilde(dir)}` : `Extracted to ${reveal.split("/").pop()}`,
    { style: "success", message: where === "here" ? "Files already there were kept" : undefined },
  );
  return true;
}

function passwordForm(f: FileEntry): FormSpec {
  return form({
    title: `Extract ${f.name}`,
    submitTitle: "Extract",
    fields: [
      field.password("password", "Password", { required: true }),
      field.dropdown("where", "Where", [
        { value: "smart", title: `In a folder named “${archiveStem(f.path)}” (or its own folder)` },
        { value: "here", title: `Here, in ${tilde(dirname(f.path))}` },
      ], { value: "smart" }),
    ],
    async submit(values) {
      const password = String(values.password ?? "");
      if (await doExtract(f, values.where === "here" ? "here" : "smart", password)) return pop();
    },
  });
}

function encrypted(f: FileEntry): boolean {
  return !!f.listing && (sevenZipEncrypted(f.listing) || !!f.listing.locked);
}

export function archiveActions(f: FileEntry): Action[] {
  const type = archiveType(f.path)!;
  const dir = dirname(f.path);
  if (type.kind === "stream") {
    const target = archiveStem(f.path);
    return [
      action(`Decompress to “${target}”`, () => doExtract(f, "folder").then(() => refresh()), {
        icon: Icons.download,
      }),
    ];
  }
  const plan = extractPlan(f.path, f.listing ? summarize(f.listing.entries) : undefined, exists);
  const smartTitle = plan.mode === "here"
    ? `Extract “${plan.target.split("/").pop()}” Here`
    : `Extract to “${plan.target.split("/").pop()}/”`;
  const locked = encrypted(f);
  const extractActions: Action[] = [
    action(smartTitle, () => doExtract(f, "smart").then(() => refresh()), { icon: Icons.download }),
    action(
      `Extract to a Folder “${free(dir, archiveStem(f.path), "").split("/").pop()}/”`,
      () => doExtract(f, "folder").then(() => refresh()),
      { icon: Icons.folder, section: "Extract" },
    ),
    action("Extract Here, Keeping Existing Files", () => doExtract(f, "here").then(() => refresh()), {
      icon: Icons.download,
      section: "Extract",
      shortcut: "<Ctrl>e",
    }),
  ];
  const withPassword = action("Extract with Password…", () => passwordForm(f), {
    icon: Icons.lock,
    section: "Extract",
    shortcut: "<Ctrl><Shift>p",
  });
  // Encrypted: the password form comes first.
  return locked ? [withPassword, ...extractActions] : [...extractActions, withPassword];
}

function archiveMetadata(f: FileEntry): Metadata[] {
  const type = archiveType(f.path)!;
  const l = f.listing;
  const unsafe = l?.entries.filter((e) => unsafeEntry(e.path)).length ?? 0;
  return [
    meta.tags("Type", [
      type.label,
      ...(l && encrypted(f) ? [{ text: l.locked ? "Names encrypted" : "Encrypted", color: "orange" as const }] : []),
      ...(l?.solid ? ["solid"] : []),
    ]),
    ...(l?.method ? [meta.text("Method", l.method, { icon: Icons.settings })] : []),
    ...(unsafe
      ? [meta.tags("Warning", [{ text: `${plural(unsafe, "entry", "entries")} outside the folder`, color: "red" }])]
      : []),
    meta.text("Size", formatBytes(f.size), { icon: Icons.drive }),
    meta.text("Folder", tilde(dirname(f.path)), { icon: Icons.folder }),
    meta.text("Changed", ago(f.modified), { icon: Icons.clock }),
  ];
}

export function archiveItem(f: FileEntry, section: string): Item {
  const type = archiveType(f.path)!;
  const l = f.listing;
  const s = l ? summarize(l.entries) : undefined;
  const locked = encrypted(f);
  const markdown = type.kind === "stream"
    ? `A single compressed file: decompressing it gives **${archiveStem(f.path)}**.`
    : f.error
    ? `**Can't read this archive.** ${f.error}`
    : l?.locked
    ? "The names of the files are encrypted too: extract it with its password."
    : l
    ? (l.entries.length ? "```\n" + listingText(l.entries) + "\n```" : "_Empty archive._")
    : "_Reading…_";
  return {
    id: `${section}:${f.path}`,
    title: f.name,
    subtitle: tilde(dirname(f.path)),
    icon: { source: locked ? Icons.lock : Icons.archive, tint: locked ? "orange" : f.error ? "gray" : "yellow" },
    section,
    keywords: [type.label, ...(s?.top ?? []).slice(0, 5)],
    accessories: [
      ...(s ? [{ text: plural(s.files, "file") }] : []),
      { text: formatBytes(f.size) },
    ],
    detail: {
      stats: s
        ? [
          { label: s.files === 1 ? "file" : "files", value: s.files },
          ...(s.folders ? [{ label: s.folders === 1 ? "folder" : "folders", value: s.folders }] : []),
          { label: "unpacked", value: formatBytes(s.size) },
          ...(ratio(f.size, s.size) ? [{ label: "compression", value: ratio(f.size, s.size)! }] : []),
        ]
        : [{ label: "size", value: formatBytes(f.size) }],
      markdown,
      metadata: archiveMetadata(f),
    },
    actions: [
      ...archiveActions(f),
      open(f.path, "Open with Default App", { icon: Icons.external, section: "File" }),
      copy(f.path, "Copy Path", { section: "File", shortcut: "<Ctrl><Shift>c" }),
      open(dirname(f.path), "Open Folder", { icon: Icons.folder, section: "File", shortcut: "<Ctrl>o" }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Compressing

async function doCompress(paths: string[], format: Format, name?: string, password?: string): Promise<boolean> {
  const { dir } = commonDir(paths);
  const output = free(dir, name ?? archiveName(paths), format);
  await toast(`Compressing to ${output.split("/").pop()}…`);
  try {
    await compress(format, paths, output, password);
  } catch (e) {
    await report(e, "Compressing");
    return false;
  }
  const [before, after] = await Promise.all([
    Promise.all(paths.map((p) => sizeOf(p))).then((s) => s.reduce((a, b) => a + b, 0)),
    Deno.stat(output).then((s) => s.size).catch(() => 0),
  ]);
  await added(output);
  await toast(`Saved ${output.split("/").pop()}`, {
    style: "success",
    message: [formatBytes(after), ratio(after, before), password ? "with a password" : ""].filter(Boolean).join(
      " · ",
    ),
  });
  return true;
}

function compressForm(paths: string[], t: Tools, encrypt: boolean): FormSpec {
  const formats = FORMATS.filter((f) => (!encrypt || canEncrypt(f.format)) && canCompress(f.format, t, encrypt));
  return form({
    title: encrypt ? "Compress with a Password" : "Compress",
    submitTitle: "Compress",
    fields: [
      field.text("name", "Name", { required: true, value: archiveName(paths) }),
      field.dropdown(
        "format",
        "Format",
        formats.map((f) => ({ value: f.format, title: `${f.title}: ${f.hint}` })),
        { value: formats[0]?.format },
      ),
      ...(encrypt
        ? [
          field.password("password", "Password", { required: true }),
          field.password("confirm", "Password again", { required: true }),
        ]
        : []),
    ],
    async submit(values) {
      let name: string;
      try {
        name = cleanName(String(values.name ?? ""));
      } catch (e) {
        await toast((e as Error).message, { style: "failure" });
        return;
      }
      const format = String(values.format ?? "") as Format;
      if (!formats.some((f) => f.format === format)) {
        await toast("Pick a format", { style: "failure" });
        return;
      }
      const password = encrypt ? String(values.password ?? "") : undefined;
      if (encrypt && password !== String(values.confirm ?? "")) {
        await toast("The passwords don't match", { style: "failure" });
        return;
      }
      if (encrypt && format === "zip" && !t.sevenZip && !t.bsdtar) {
        await toast("Using zip's legacy encryption", { message: "Install 7-Zip for AES-256" });
      }
      if (await doCompress(paths, format, name, password)) return pop();
    },
  });
}

export function compressItem(files: FileEntry[], t: Tools, section = "Compress"): Item {
  const paths = files.map((f) => f.path);
  const name = archiveName(paths);
  const formats = FORMATS.filter((f) => canCompress(f.format, t));
  const dir = commonDir(paths).dir;
  const folders = files.filter((f) => f.dir).length;
  const loose = files.length - folders;
  const what = files.length === 1
    ? `“${files[0].name}”`
    : [loose ? plural(loose, "file") : "", folders ? plural(folders, "folder") : ""].filter(Boolean).join(" and ");
  return {
    id: `compress:${paths.join("\n")}`,
    title: `Compress ${what}`,
    subtitle: formats.length ? `To ${name}.zip, .tar.zst, .7z…` : "No compression tool installed",
    icon: { source: Icons.archive, tint: formats.length ? "purple" : "gray" },
    section,
    detail: {
      stats: [
        { label: "items", value: files.length },
        ...(files.some((f) => !f.dir)
          ? [{ label: "files size", value: formatBytes(files.reduce((s, f) => s + (f.dir ? 0 : f.size), 0)) }]
          : []),
      ],
      markdown: [
        ...files.slice(0, 50).map((f) => `- ${f.name}${f.dir ? "/" : ""}`),
        ...(files.length > 50 ? [`- … and ${files.length - 50} more`] : []),
      ].join("\n"),
      metadata: [
        meta.text("Saved in", tilde(dir), { icon: Icons.folder }),
        meta.tags(
          "Formats",
          FORMATS.map((f) => ({ text: f.title, color: canCompress(f.format, t) ? "green" : "gray" })),
        ),
      ],
    },
    actions: [
      ...formats.map((f, n) =>
        action(`Compress to ${f.title}`, () => doCompress(paths, f.format).then(() => refresh()), {
          icon: Icons.archive,
          section: n < 2 ? undefined : "Format",
        })
      ),
      action("Choose Name and Format…", () => compressForm(paths, t, false), {
        icon: Icons.text,
        shortcut: "<Ctrl>n",
        section: "Options",
      }),
      ...(FORMATS.some((f) => canEncrypt(f.format) && canCompress(f.format, t, true))
        ? [action("Compress with a Password…", () => compressForm(paths, t, true), {
          icon: Icons.lock,
          shortcut: "<Ctrl><Shift>p",
          section: "Options",
        })]
        : []),
    ],
  };
}

/** A file or folder made this session (an extracted folder, a decompressed file). */
export function madeItem(f: FileEntry): Item {
  return {
    id: `made:${f.path}`,
    title: f.name,
    subtitle: tilde(dirname(f.path)),
    icon: { source: f.dir ? Icons.folder : Icons.file, tint: "green" },
    section: "Just Made",
    accessories: f.dir ? [] : [{ text: formatBytes(f.size) }],
    detail: {
      metadata: [
        meta.text("Folder", tilde(dirname(f.path)), { icon: Icons.folder }),
        meta.text("Made", ago(f.modified), { icon: Icons.clock }),
      ],
    },
    actions: [
      open(f.path, f.dir ? "Open Folder" : "Open", { icon: f.dir ? Icons.folder : Icons.external }),
      open(dirname(f.path), "Show in Folder", { icon: Icons.folder, shortcut: "<Ctrl>o" }),
      copy(f.path, "Copy Path", { shortcut: "<Ctrl><Shift>c" }),
    ],
  };
}

export function pathForm(): FormSpec {
  return form({
    title: "Open by Path",
    submitTitle: "Open",
    fields: [field.text("path", "Archive, file or folder", { required: true, placeholder: "~/Downloads/photos.zip" })],
    async submit(values) {
      const path = expandHome(String(values.path ?? "")).replace(/\/+$/, "");
      const f = await fileEntry(path).catch(() => undefined);
      if (!f) {
        await toast(`Can't read ${tilde(path)}`, { style: "failure", message: "Files must be in your home folder" });
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
    title: "Copy archives, files or folders in your file manager",
    subtitle: "Archives to look inside and extract, anything else to compress",
    icon: { source: Icons.paste, tint: "gray" },
    section: "Clipboard",
    detail: {
      markdown: [
        "Select files in **Files**, **Dolphin**, **Thunar** or **Nemo** and press **Ctrl+C**, then open Archives again:",
        "",
        "- **archives** (ZIP, 7z, RAR, TAR.GZ, TAR.ZST…) show what they hold, to extract them;",
        "- **files and folders** can be compressed together, with a password if you want.",
        "",
        "Or press **Ctrl+P** to type a path. Your recent archives from Downloads, Desktop and Documents are below.",
      ].join("\n"),
    },
    actions: [action("Open by Path", () => pathForm(), { icon: Icons.text })],
  };
}

export function missingToolsItem(fam?: Family): Item {
  return {
    id: "missing",
    title: "Install bsdtar or 7-Zip",
    subtitle: "To read and make more kinds of archives",
    icon: { source: Icons.alert, tint: "orange" },
    section: "Setup",
    detail: {
      markdown: installMarkdown(
        "Archives uses **bsdtar** (libarchive: reads almost every format) or **7-Zip** (7z, RAR, encrypted ZIP), with **unzip**, **zip**, **tar**, **zstd** and **xz** when they are there.",
        ["bsdtar", "7z", "unzip", "zip", "zstd"],
        fam,
      ),
    },
    actions: [action("Check Again", () => refresh(), { icon: Icons.refresh })],
  };
}
