// Copied files (clipboard URIs), archive types, what bsdtar / tar / unzip / 7z
// list, and the command lines that extract and compress. Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Files from the clipboard

/**
 * Paths from what a file manager copies: text/uri-list (file:///…, one per
 * line, # comments), GNOME's x-special/gnome-copied-files ("copy" then URIs),
 * or plain absolute paths.
 */
export function parseFileList(text: string, home = ""): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line === "copy" || line === "cut") continue;
    let path: string | undefined;
    if (line.startsWith("file://")) {
      try {
        const url = new URL(line);
        if (url.host && url.host !== "localhost") continue; // another machine
        path = decodeURIComponent(url.pathname);
      } catch {
        continue;
      }
    } else if (line.startsWith("/")) path = line;
    else if (home && (line === "~" || line.startsWith("~/"))) path = home + line.slice(1);
    if (path && path.length > 1) path = path.replace(/\/+$/, "");
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}

const trim = (s: string) => s.length > 1 ? s.replace(/\/+$/, "") : s;
export const basename = (p: string) => trim(p).split("/").pop() || p;
export const dirname = (p: string) => trim(p).split("/").slice(0, -1).join("/") || "/";

/** `dir/name.ext`, or `dir/name-2.ext`, `-3`… : never an existing path. */
export function freePath(dir: string, name: string, ext: string, exists: (p: string) => boolean): string {
  const suffix = ext ? `.${ext}` : "";
  const base = `${dir === "/" ? "" : dir}/${name}`;
  let candidate = `${base}${suffix}`;
  for (let i = 2; exists(candidate); i++) candidate = `${base}-${i}${suffix}`;
  return candidate;
}

/**
 * The folder all paths are in, and their names relative to it, so an archive
 * of files from several folders keeps their layout: [/a/x, /a/b/y] → /a, [x, b/y].
 */
export function commonDir(paths: string[]): { dir: string; names: string[] } {
  if (!paths.length) return { dir: "/", names: [] };
  const parts = paths.map((p) => dirname(p).split("/").filter(Boolean));
  const first = parts[0];
  let n = first.length;
  for (const p of parts.slice(1)) {
    let i = 0;
    while (i < n && i < p.length && p[i] === first[i]) i++;
    n = i;
  }
  const dir = `/${first.slice(0, n).join("/")}`;
  const prefix = dir === "/" ? "/" : `${dir}/`;
  return { dir, names: paths.map((p) => trim(p).slice(prefix.length)) };
}

// ---------------------------------------------------------------------------
// Archive types

export type Kind = "zip" | "7z" | "rar" | "tar" | "iso" | "package" | "stream";

export interface ArchiveType {
  kind: Kind;
  /** What the name ends with: "tar.gz", "zip"… */
  ext: string;
  /** The name of the type for people. */
  label: string;
  /** For a single compressed file (.gz, .xz…): the program that decompresses it. */
  decompressor?: "gzip" | "bzip2" | "xz" | "zstd" | "lz4";
}

const TYPES: [RegExp, ArchiveType][] = [
  [/\.(tar\.gz|tgz)$/i, { kind: "tar", ext: "tar.gz", label: "TAR.GZ" }],
  [/\.(tar\.bz2|tbz2?)$/i, { kind: "tar", ext: "tar.bz2", label: "TAR.BZ2" }],
  [/\.(tar\.xz|txz)$/i, { kind: "tar", ext: "tar.xz", label: "TAR.XZ" }],
  [/\.(tar\.zst|tzst)$/i, { kind: "tar", ext: "tar.zst", label: "TAR.ZST" }],
  [/\.(tar\.lzma|tlz)$/i, { kind: "tar", ext: "tar.lzma", label: "TAR.LZMA" }],
  [/\.tar\.lz4$/i, { kind: "tar", ext: "tar.lz4", label: "TAR.LZ4" }],
  [/\.tar$/i, { kind: "tar", ext: "tar", label: "TAR" }],
  [/\.(zip|jar|war|apk|xpi|cbz)$/i, { kind: "zip", ext: "zip", label: "ZIP" }],
  [/\.(7z|cb7)$/i, { kind: "7z", ext: "7z", label: "7Z" }],
  [/\.(rar|cbr)$/i, { kind: "rar", ext: "rar", label: "RAR" }],
  [/\.iso$/i, { kind: "iso", ext: "iso", label: "ISO image" }],
  [/\.(deb|rpm|cpio)$/i, { kind: "package", ext: "", label: "Package" }],
  [/\.gz$/i, { kind: "stream", ext: "gz", label: "GZIP", decompressor: "gzip" }],
  [/\.bz2$/i, { kind: "stream", ext: "bz2", label: "BZIP2", decompressor: "bzip2" }],
  [/\.xz$/i, { kind: "stream", ext: "xz", label: "XZ", decompressor: "xz" }],
  [/\.zst$/i, { kind: "stream", ext: "zst", label: "Zstandard", decompressor: "zstd" }],
  [/\.lz4$/i, { kind: "stream", ext: "lz4", label: "LZ4", decompressor: "lz4" }],
];

/** The type of an archive from its name, or undefined for any other file. */
export function archiveType(path: string): ArchiveType | undefined {
  const name = basename(path);
  for (const [re, t] of TYPES) {
    if (re.test(name)) {
      return t.kind === "package" ? { ...t, ext: name.split(".").pop()!.toLowerCase() } : t;
    }
  }
  return undefined;
}

export const isArchive = (path: string) => !!archiveType(path);

/** "photos.tar.gz" → "photos", "notes.txt.gz" → "notes.txt", "a.zip" → "a". */
export function archiveStem(path: string): string {
  const name = basename(path);
  for (const [re] of TYPES) {
    const m = name.match(re);
    if (m) return name.slice(0, name.length - m[0].length) || name;
  }
  return name.replace(/\.[^.]+$/, "") || name;
}

/** "report.pdf" → "report", "photos" → "photos", ".config" → ".config". */
export const fileStem = (path: string) => basename(path).replace(/(?<=.)\.[^.]+$/, "");

// ---------------------------------------------------------------------------
// What's inside

export interface Entry {
  path: string;
  size: number;
  dir: boolean;
  /** For symbolic links. */
  link?: string;
  /** As the tool printed it. */
  modified?: string;
  encrypted?: boolean;
}

export interface Listing {
  entries: Entry[];
  /** What 7z tells about the archive. */
  type?: string;
  method?: string;
  solid?: boolean;
  encrypted?: boolean;
  /** Listing stopped because the names are encrypted too. */
  locked?: boolean;
}

const LS_LINE =
  /^([-dlcbpsh][-rwxsStT]{9})[.+@]?\s+(?:(\d+)\s+)?(\S+?)(?:\/(\S+)|\s+(\S+))\s+(\d+)\s+(\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)?|[A-Z][a-z]{2}\s+\d{1,2}\s+(?:\d\d:\d\d|\d{4}))\s(.+)$/;

/**
 * `bsdtar -tvf` and GNU `tar -tvf`: ls-like lines.
 * bsdtar: `-rw-r--r--  0 ada  ada     6 Oct 29 08:02 d/a.txt`
 * GNU tar: `-rw-r--r-- ada/ada         6 2026-10-29 08:02 d/a.txt`
 */
export function parseTarList(out: string): Listing {
  const entries: Entry[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(LS_LINE);
    if (!m) continue;
    const type = m[1][0];
    let name = m[8];
    let link: string | undefined;
    if (type === "l") {
      const at = name.indexOf(" -> ");
      if (at > 0) [name, link] = [name.slice(0, at), name.slice(at + 4)];
    } else if (type === "h") {
      const at = name.indexOf(" link to ");
      if (at > 0) name = name.slice(0, at);
    }
    entries.push({
      path: name.replace(/\/$/, ""),
      size: Number(m[6]),
      dir: type === "d",
      link,
      modified: m[7].replace(/\s+/g, " "),
    });
  }
  return { entries };
}

/** `unzip -l`: a length, a date, a time and the name, between dashed lines. */
export function parseUnzipList(out: string): Listing {
  const entries: Entry[] = [];
  let inside = false;
  for (const line of out.split("\n")) {
    if (/^\s*-{4,}/.test(line)) {
      if (inside) break;
      inside = true;
      continue;
    }
    if (!inside) continue;
    const m = line.match(/^\s*(\d+)\s+(\d\d(?:\d\d)?-\d\d-\d\d(?:\d\d)?\s+\d\d:\d\d)\s{2,}(.+)$/);
    if (!m) continue;
    const name = m[3];
    entries.push({ path: name.replace(/\/$/, ""), size: Number(m[1]), dir: name.endsWith("/"), modified: m[2] });
  }
  return { entries };
}

/** `7z l -slt`: blocks of `Key = value` lines, the archive's first, then one per entry after "----------". */
export function parse7zList(out: string): Listing {
  const listing: Listing = { entries: [] };
  if (/Can not open encrypted archive|Wrong password|Enter password/i.test(out) && !/^-{10}$/m.test(out)) {
    return { entries: [], encrypted: true, locked: true };
  }
  const [head, body] = out.split(/^-{10}\s*$/m);
  const block = (text: string) => {
    const kv: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Za-z][A-Za-z ]*?) = ?(.*)$/);
      if (m) kv[m[1]] = m[2].trim();
    }
    return kv;
  };
  const archive = block(head?.split(/^--\s*$/m).pop() ?? "");
  if (archive.Type) listing.type = archive.Type;
  if (archive.Method) listing.method = archive.Method;
  if (archive.Solid) listing.solid = archive.Solid === "+";
  if (archive.Encrypted === "+") listing.encrypted = true;
  for (const text of (body ?? "").split(/\n\s*\n/)) {
    const kv = block(text);
    if (!kv.Path) continue;
    const dir = kv.Folder === "+" || /^D/.test(kv.Attributes ?? "") || /^\S*\s+d/.test(kv.Attributes ?? "");
    const e: Entry = { path: kv.Path.replace(/\\/g, "/").replace(/\/$/, ""), size: Number(kv.Size) || 0, dir };
    if (kv.Modified) e.modified = kv.Modified.replace(/\.\d+$/, "");
    if (kv.Encrypted === "+") {
      e.encrypted = true;
      listing.encrypted = true;
    }
    if (kv.Method && !listing.method) listing.method = kv.Method;
    listing.entries.push(e);
  }
  return listing;
}

export interface Summary {
  files: number;
  folders: number;
  /** Unpacked size. */
  size: number;
  /** The names at the root of the archive. */
  top: string[];
}

export function summarize(entries: Entry[]): Summary {
  const top = new Set<string>();
  const folders = new Set<string>();
  let files = 0;
  let size = 0;
  for (const e of entries) {
    const parts = e.path.replace(/^\.\//, "").split("/").filter(Boolean);
    if (!parts.length) continue;
    top.add(parts[0]);
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/"));
    if (e.dir) folders.add(parts.join("/"));
    else {
      files++;
      size += e.size;
    }
  }
  return { files, folders: folders.size, size, top: [...top] };
}

/** Whether a name in an archive would land outside the folder it is extracted to. */
export const unsafeEntry = (path: string) => path.startsWith("/") || path.split("/").includes("..");

/**
 * Where "Extract" puts the files: straight in the archive's folder when it
 * holds a single folder that isn't there yet, else in a new folder named
 * after the archive.
 */
export function extractPlan(
  archive: string,
  summary: Summary | undefined,
  exists: (p: string) => boolean,
): { mode: "here" | "folder"; target: string } {
  const dir = dirname(archive);
  if (summary && summary.top.length === 1) {
    const only = `${dir === "/" ? "" : dir}/${summary.top[0]}`;
    if (!exists(only)) return { mode: "here", target: only };
  }
  return { mode: "folder", target: freePath(dir, archiveStem(archive), "", exists) };
}

/** Whether the first entries of a ZIP file are encrypted (bit 0 of the local header flags). */
export function zipEncrypted(b: Uint8Array): boolean | undefined {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 0;
  let seen = 0;
  while (i + 30 <= b.length && seen < 64) {
    if (v.getUint32(i, true) !== 0x04034b50) {
      // A data descriptor or something unexpected: look for the next header.
      const next = indexOf(b, [0x50, 0x4b, 0x03, 0x04], i + 1);
      if (next < 0) break;
      i = next;
      continue;
    }
    seen++;
    const flags = v.getUint16(i + 6, true);
    const packed = v.getUint32(i + 18, true);
    const nameLength = v.getUint16(i + 26, true);
    const extraLength = v.getUint16(i + 28, true);
    const nameEnd = i + 30 + nameLength;
    const isDir = nameEnd <= b.length && b[nameEnd - 1] === 0x2f;
    if (!isDir && (flags & 1)) return true;
    if (!isDir && nameLength) return false;
    i = nameEnd + extraLength + (flags & 8 ? 0 : packed);
  }
  return seen ? false : undefined;
}

function indexOf(b: Uint8Array, needle: number[], from: number): number {
  outer: for (let i = from; i + needle.length <= b.length; i++) {
    for (let j = 0; j < needle.length; j++) if (b[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Whether 7z says an archive is encrypted, or its method is (7zAES, AES-256, ZipCrypto). */
export const sevenZipEncrypted = (l: Listing) => !!l.encrypted || /7zAES|AES-?256|ZipCrypto/i.test(l.method ?? "");

/** The preview: one line per entry, sizes aligned, folders first at each level. */
export function listingText(entries: Entry[], max = 250): string {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  const lines = sorted.slice(0, max).map((e) => {
    const size = e.dir ? "" : formatBytes(e.size);
    const name = e.dir ? `${e.path}/` : e.link ? `${e.path} → ${e.link}` : e.path;
    return `${size.padStart(9)}  ${name}${e.encrypted ? "  [encrypted]" : ""}`;
  });
  if (sorted.length > max) lines.push(`           … and ${sorted.length - max} more`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Commands

export interface Tools {
  bsdtar: boolean;
  /** GNU tar. */
  tar: boolean;
  unzip: boolean;
  zip: boolean;
  /** 7z (p7zip), 7zz (7-Zip) or 7za. */
  sevenZip?: "7z" | "7zz" | "7za";
  gzip: boolean;
  bzip2: boolean;
  xz: boolean;
  zstd: boolean;
  lz4: boolean;
}

export const NO_TOOLS: Tools = {
  bsdtar: false,
  tar: false,
  unzip: false,
  zip: false,
  gzip: false,
  bzip2: false,
  xz: false,
  zstd: false,
  lz4: false,
};

export class MissingTool extends Error {
  constructor(message: string, public packages: string[]) {
    super(message);
  }
}

export type Step = [program: string, args: string[]];

/** How to list an archive: the first tool installed that reads its type. */
export function listCommand(path: string, t: Tools): { step: Step; parse: (out: string) => Listing } | undefined {
  const type = archiveType(path);
  if (!type || type.kind === "stream") return undefined;
  const sz = t.sevenZip;
  const bsd = () => ({ step: ["bsdtar", ["-tvf", path]] as Step, parse: parseTarList });
  // No -p: an archive whose names are encrypted fails (stdin is closed) instead of waiting for a password.
  const seven = () => ({ step: [sz!, ["l", "-slt", "--", path]] as Step, parse: parse7zList });
  switch (type.kind) {
    case "zip":
      if (t.unzip) return { step: ["unzip", ["-l", path]], parse: parseUnzipList };
      if (sz) return seven();
      return t.bsdtar ? bsd() : undefined;
    case "7z":
    case "rar":
      if (sz) return seven();
      return t.bsdtar ? bsd() : undefined;
    case "tar":
      if (t.bsdtar) return bsd();
      if (t.tar) return { step: ["tar", ["-tvf", path]], parse: parseTarList };
      return sz ? seven() : undefined;
    default:
      if (t.bsdtar) return bsd();
      return sz ? seven() : undefined;
  }
}

/**
 * How to extract `archive` into the folder `dest` (which exists). Files that
 * are already there are always kept: unzip -n, 7z -aos, tar --skip-old-files,
 * bsdtar -k. A single compressed file is decompressed to stdout instead
 * (see `decompressCommand`).
 */
export function extractCommand(archive: string, dest: string, t: Tools, password?: string): Step {
  const type = archiveType(archive);
  if (!type) throw new Error("Not an archive");
  if (type.kind === "stream") throw new Error("A compressed file is decompressed, not extracted");
  const sz = t.sevenZip;
  const pw = password ?? "";
  const seven =
    (): Step => [sz!, ["x", "-aos", "-y", ...(password ? [`-p${password}`] : []), `-o${dest}`, "--", archive]];
  const bsd =
    (): Step => ["bsdtar", ["-x", "-k", ...(password ? ["--passphrase", password] : []), "-f", archive, "-C", dest]];
  switch (type.kind) {
    case "zip":
      // Not -q: it would hide "incorrect password".
      if (t.unzip && !password) return ["unzip", ["-n", archive, "-d", dest]];
      if (sz) return seven();
      if (t.unzip) return ["unzip", ["-n", "-P", pw, archive, "-d", dest]];
      if (t.bsdtar) return bsd();
      throw new MissingTool("Extracting ZIP files needs unzip, 7-Zip or bsdtar", ["unzip"]);
    case "7z":
    case "rar":
      if (sz) return seven();
      if (t.bsdtar) return bsd();
      throw new MissingTool(`Extracting ${type.label} files needs 7-Zip`, ["7z"]);
    case "tar": {
      const comp = tarCompressor(type.ext);
      if (t.bsdtar) return bsd();
      if (t.tar && (!comp || t[comp])) return ["tar", ["-x", "--skip-old-files", "-f", archive, "-C", dest]];
      if (sz && type.ext === "tar") return seven();
      throw new MissingTool(
        `Extracting ${type.label} files needs bsdtar, or tar with ${comp ?? "it"}`,
        comp ? ["tar", comp] : ["tar"],
      );
    }
    default:
      if (t.bsdtar) return bsd();
      if (sz) return seven();
      throw new MissingTool(`Extracting ${type.label} files needs bsdtar or 7-Zip`, ["bsdtar"]);
  }
}

const tarCompressor = (ext: string): "gzip" | "bzip2" | "xz" | "zstd" | "lz4" | undefined =>
  (({
    "tar.gz": "gzip",
    "tar.bz2": "bzip2",
    "tar.xz": "xz",
    "tar.zst": "zstd",
    "tar.lzma": "xz",
    "tar.lz4": "lz4",
  }) as Record<string, "gzip" | "bzip2" | "xz" | "zstd" | "lz4">)[ext];

/** `gzip -dc -- notes.txt.gz`: the decompressed file comes out on stdout. */
export function decompressCommand(path: string, t: Tools): Step {
  const type = archiveType(path);
  const program = type?.decompressor;
  if (!program) throw new Error("Not a compressed file");
  if (!t[program]) throw new MissingTool(`Decompressing ${type.label} files needs ${program}`, [program]);
  return [program, ["-d", "-c", "--", path]];
}

export type Format = "zip" | "tar.gz" | "tar.zst" | "tar.xz" | "7z";
export const FORMATS: { format: Format; title: string; hint: string }[] = [
  { format: "zip", title: "ZIP", hint: "Opens everywhere" },
  { format: "tar.gz", title: "TAR.GZ", hint: "Keeps permissions, opens on any Linux or macOS" },
  { format: "tar.zst", title: "TAR.ZST", hint: "Fast and small (Zstandard)" },
  { format: "tar.xz", title: "TAR.XZ", hint: "Smallest, slower" },
  { format: "7z", title: "7Z", hint: "Small, opens with 7-Zip" },
];

export const canEncrypt = (f: Format) => f === "zip" || f === "7z";

/** Whether a format can be written with the installed tools. */
export function canCompress(format: Format, t: Tools, password = false): boolean {
  try {
    compressCommand(format, "/x", ["x"], t, password ? "x" : undefined);
    return true;
  } catch {
    return false;
  }
}

/**
 * How to make `output` of `names`, run in the folder they are relative to.
 * `-y`/`--` keep names starting with a dash for names. The password, for zip
 * and 7z, goes on the command line: these tools have no other way without a
 * terminal.
 */
export function compressCommand(format: Format, output: string, names: string[], t: Tools, password?: string): Step {
  const sz = t.sevenZip;
  switch (format) {
    case "zip":
      if (password) {
        // AES-256 with 7-Zip or bsdtar; Info-ZIP only knows the weak ZipCrypto.
        if (sz) return [sz, ["a", "-tzip", "-mem=AES256", `-p${password}`, "-y", "--", output, ...names]];
        if (t.bsdtar) {
          return ["bsdtar", [
            "--format",
            "zip",
            "--options",
            "zip:encryption=aes256",
            "--passphrase",
            password,
            "-cf",
            output,
            "--",
            ...names,
          ]];
        }
        if (t.zip) return ["zip", ["-r", "-q", "-y", "-P", password, output, "--", ...names]];
        throw new MissingTool("Making a ZIP with a password needs 7-Zip, bsdtar or zip", ["7z"]);
      }
      if (t.zip) return ["zip", ["-r", "-q", "-y", output, "--", ...names]];
      if (sz) return [sz, ["a", "-tzip", "-y", "--", output, ...names]];
      if (t.bsdtar) return ["bsdtar", ["--format", "zip", "-cf", output, "--", ...names]];
      throw new MissingTool("Making a ZIP needs zip, 7-Zip or bsdtar", ["zip"]);
    case "7z":
      if (sz) {
        return [sz, [
          "a",
          "-t7z",
          "-mx=7",
          ...(password ? [`-p${password}`, "-mhe=on"] : []),
          "-y",
          "--",
          output,
          ...names,
        ]];
      }
      if (t.bsdtar && !password) return ["bsdtar", ["--format", "7zip", "-cf", output, "--", ...names]];
      throw new MissingTool(
        password ? "Making a 7z with a password needs 7-Zip" : "Making a 7z needs 7-Zip or bsdtar",
        ["7z"],
      );
    default: {
      if (password) throw new Error("Only ZIP and 7z archives can have a password");
      const comp = tarCompressor(format)!;
      if (t.tar && t[comp]) return ["tar", ["-c", "-a", "-f", output, "--", ...names]];
      if (t.bsdtar) return ["bsdtar", ["-c", "-a", "-f", output, "--", ...names]];
      throw new MissingTool(`Making a ${format.toUpperCase()} needs tar and ${comp}, or bsdtar`, ["tar", comp]);
    }
  }
}

/** The name of a new archive: the file without its extension, a folder's name, or the folder they share. */
export function archiveName(paths: string[]): string {
  if (paths.length === 1) return fileStem(paths[0]);
  const { dir } = commonDir(paths);
  return dir === "/" ? "Archive" : basename(dir);
}

/** A name typed in the form, without a path or an archive extension. */
export function cleanName(text: string): string {
  const name = text.trim().replace(/\.(zip|7z|tar(\.(gz|xz|zst))?|tgz|txz|tzst)$/i, "").trim();
  if (!name || name === "." || name === "..") throw new Error("Type a name for the archive");
  if (name.includes("/")) throw new Error("A name can't contain a slash");
  return name;
}

export const wrongPassword = (message: string) =>
  /wrong password|incorrect password|password incorrect|bad password|passphrase required|Data Error in encrypted|Can not open encrypted|unsupported compression method 99/i
    .test(message);

/** The last useful line a tool printed on failure. */
export function failureLine(message: string): string {
  const lines = message.replace(/^.*?exited with \d+: /s, "").split("\n").map((l) => l.trim()).filter((l) =>
    l && !/^(7-Zip|p7zip|Copyright|Scanning|Open archive|--|Path =|Type =|Physical Size|Headers Size)/.test(l)
  );
  const error = lines.find((l) => /error|cannot|can't|failed|not|unsupported|wrong/i.test(l));
  return (error ?? lines.at(-1) ?? "").replace(/^ERROR: /, "").slice(0, 200);
}

// ---------------------------------------------------------------------------
// Formatting

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** How much smaller the archive is than what it holds: "62 % smaller". */
export function ratio(packed: number, unpacked: number): string | undefined {
  if (!packed || !unpacked) return undefined;
  const pct = Math.round((1 - packed / unpacked) * 100);
  return pct > 0 ? `${pct} % smaller` : pct === 0 ? "same size" : "not compressed";
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const days = Math.round(s / 86400);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

// ---------------------------------------------------------------------------
// What to install

export type Family = "arch" | "debian" | "fedora" | "suse";

export function osFamily(osRelease: string): Family | undefined {
  const field = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "arch";
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "debian";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "fedora";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "suse";
  return undefined;
}

const PACKAGES: Record<string, Partial<Record<Family, string>>> = {
  bsdtar: { debian: "libarchive-tools", arch: "libarchive", fedora: "bsdtar", suse: "bsdtar" },
  "7z": { debian: "7zip", arch: "7zip", fedora: "7zip", suse: "7zip" },
  "wl-paste": { debian: "wl-clipboard", arch: "wl-clipboard", fedora: "wl-clipboard", suse: "wl-clipboard" },
};

const MANAGERS: Record<Family, string> = {
  arch: "sudo pacman -S",
  debian: "sudo apt install",
  fedora: "sudo dnf install",
  suse: "sudo zypper install",
};

const FAMILY_NAMES: Record<Family, string> = {
  arch: "Arch",
  debian: "Debian, Ubuntu",
  fedora: "Fedora",
  suse: "openSUSE",
};

export function installCommand(programs: string[], family: Family): string {
  return `${MANAGERS[family]} ${[...new Set(programs.map((p) => PACKAGES[p]?.[family] ?? p))].join(" ")}`;
}

export function installMarkdown(what: string, programs: string[], family?: Family): string {
  const families = family ? [family] : (Object.keys(MANAGERS) as Family[]);
  return `${what}\n\n${
    families.map((f) => `**${FAMILY_NAMES[f]}**\n\n\`${installCommand(programs, f)}\``).join("\n\n")
  }`;
}
