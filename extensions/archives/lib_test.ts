import { assertEquals, assertThrows } from "@std/assert";
import {
  archiveName,
  archiveStem,
  archiveType,
  canCompress,
  cleanName,
  commonDir,
  compressCommand,
  decompressCommand,
  extractCommand,
  extractPlan,
  failureLine,
  fileStem,
  freePath,
  installCommand,
  listCommand,
  listingText,
  MissingTool,
  NO_TOOLS,
  parse7zList,
  parseFileList,
  parseTarList,
  parseUnzipList,
  ratio,
  sevenZipEncrypted,
  summarize,
  type Tools,
  unsafeEntry,
  wrongPassword,
  zipEncrypted,
} from "./lib.ts";

const ALL: Tools = {
  bsdtar: true,
  tar: true,
  unzip: true,
  zip: true,
  sevenZip: "7z",
  gzip: true,
  bzip2: true,
  xz: true,
  zstd: true,
  lz4: true,
};
const BASIC: Tools = { ...NO_TOOLS, tar: true, unzip: true, zip: true, gzip: true, xz: true };

Deno.test("copied files and folders", () => {
  assertEquals(
    parseFileList("file:///home/ada/Downloads/Photos%20%C3%A9t%C3%A9.zip\r\nfile:///home/ada/Projets/\r\n"),
    ["/home/ada/Downloads/Photos été.zip", "/home/ada/Projets"],
  );
  assertEquals(parseFileList("copy\nfile:///a.tar.gz\nfile://other-host/b.zip\n~/c.7z", "/home/ada"), [
    "/a.tar.gz",
    "/home/ada/c.7z",
  ]);
});

Deno.test("archive types and names", () => {
  assertEquals(archiveType("/a/photos.tar.gz")?.ext, "tar.gz");
  assertEquals(archiveType("/a/photos.TGZ")?.kind, "tar");
  assertEquals(archiveType("/a/src.tar.zst")?.label, "TAR.ZST");
  assertEquals(archiveType("/a/app.jar")?.kind, "zip");
  assertEquals(archiveType("/a/notes.txt.gz")?.decompressor, "gzip");
  assertEquals(archiveType("/a/pkg.deb")?.ext, "deb");
  assertEquals(archiveType("/a/report.pdf"), undefined);
  assertEquals(archiveStem("/a/photos.tar.gz"), "photos");
  assertEquals(archiveStem("/a/notes.txt.gz"), "notes.txt");
  assertEquals(archiveStem("/a/Backup 2026.7z"), "Backup 2026");
  assertEquals(fileStem("/a/report.pdf"), "report");
  assertEquals(fileStem("/a/.config"), ".config");
  assertEquals(fileStem("/a/Projets"), "Projets");
});

Deno.test("never an existing path", () => {
  const taken = new Set(["/a/photos.zip", "/a/photos-2.zip", "/a/photos"]);
  assertEquals(freePath("/a", "photos", "zip", (p) => taken.has(p)), "/a/photos-3.zip");
  assertEquals(freePath("/a", "photos", "", (p) => taken.has(p)), "/a/photos-2");
  assertEquals(freePath("/", "x", "zip", () => false), "/x.zip");
});

Deno.test("the folder copied items share", () => {
  assertEquals(commonDir(["/home/ada/a.txt", "/home/ada/b"]), { dir: "/home/ada", names: ["a.txt", "b"] });
  assertEquals(commonDir(["/home/ada/x/a.txt", "/home/ada/y/z/b.txt"]), {
    dir: "/home/ada",
    names: ["x/a.txt", "y/z/b.txt"],
  });
  assertEquals(commonDir(["/etc/hosts", "/home/ada/b"]), { dir: "/", names: ["etc/hosts", "home/ada/b"] });
  assertEquals(archiveName(["/home/ada/Projets"]), "Projets");
  assertEquals(archiveName(["/home/ada/report.pdf"]), "report");
  assertEquals(archiveName(["/home/ada/Vacances/a.jpg", "/home/ada/Vacances/b.jpg"]), "Vacances");
  assertEquals(archiveName(["/a.jpg", "/b.jpg"]), "Archive");
});

const UNZIP = `Archive:  t.zip
  Length      Date    Time    Name
---------  ---------- -----   ----
        0  2026-10-29 08:02   d/
        0  2026-10-29 08:02   d/sub/
        4  2026-10-29 08:02   d/sub/b c.txt
        6  2026-10-29 08:02   d/a.txt
---------                     -------
       10                     4 files
`;

Deno.test("unzip -l", () => {
  const l = parseUnzipList(UNZIP);
  assertEquals(l.entries.length, 4);
  assertEquals(l.entries[2], { path: "d/sub/b c.txt", size: 4, dir: false, modified: "2026-10-29 08:02" });
  assertEquals(l.entries[0].dir, true);
  assertEquals(summarize(l.entries), { files: 2, folders: 2, size: 10, top: ["d"] });
  // Older unzip prints MM-DD-YYYY.
  const old = parseUnzipList(
    `  Length      Date    Time    Name\n---------  ---------- -----   ----\n  1234  10-29-2026 08:02   a.txt\n`,
  );
  assertEquals(old.entries[0].size, 1234);
});

const GNU_TAR = `drwxr-xr-x ada/ada           0 2026-10-29 08:02 d/
drwxr-xr-x ada/ada           0 2026-10-29 08:02 d/sub/
-rw-r--r-- ada/ada           4 2026-10-29 08:02 d/sub/b c.txt
-rw-r--r-- 1000/1000      2048 2026-10-29 08:02 d/a.txt
lrwxrwxrwx ada/ada           0 2026-10-29 08:02 d/latest -> a.txt
hrw-r--r-- ada/ada           0 2026-10-29 08:02 d/again link to d/a.txt
`;

const BSDTAR = `drwxr-xr-x  0 ada    ada         0 Oct 29 08:02 d/
-rw-r--r--  0 ada    ada         6 Oct 29 08:02 d/a.txt
-rw-r--r--  0 ada    ada    123456 Mar  3  2024 d/old file.txt
lrwxrwxrwx  0 ada    ada         0 Oct 29 08:02 d/latest -> a.txt
`;

Deno.test("tar -tvf and bsdtar -tvf", () => {
  const gnu = parseTarList(GNU_TAR).entries;
  assertEquals(gnu.length, 6);
  assertEquals(gnu[2], { path: "d/sub/b c.txt", size: 4, dir: false, link: undefined, modified: "2026-10-29 08:02" });
  assertEquals(gnu[3].size, 2048);
  assertEquals(gnu[4].link, "a.txt");
  assertEquals(gnu[4].path, "d/latest");
  assertEquals(gnu[5].path, "d/again");
  const bsd = parseTarList(BSDTAR).entries;
  assertEquals(bsd.map((e) => e.path), ["d", "d/a.txt", "d/old file.txt", "d/latest"]);
  assertEquals(bsd[2].size, 123456);
  assertEquals(bsd[2].modified, "Mar 3 2024");
  assertEquals(summarize(bsd).top, ["d"]);
});

const SEVEN = `
7-Zip [64] 17.05 : Copyright (c) 1999-2021 Igor Pavlov : 2017-08-28
p7zip Version 17.05 (locale=en_US.UTF-8,Utf16=on,HugeFiles=on,64 bits,8 CPUs x64)

Scanning the drive for archives:
1 file, 1234 bytes (2 KiB)

Listing archive: backup.7z

--
Path = backup.7z
Type = 7z
Physical Size = 1234
Headers Size = 210
Method = LZMA2:12 7zAES
Solid = +
Blocks = 1

----------
Path = docs
Size = 0
Packed Size = 0
Modified = 2026-10-29 08:02:11.4573480
Attributes = D_ drwxr-xr-x
CRC =
Encrypted = -
Method =
Block =

Path = docs/a.txt
Size = 6
Packed Size = 16
Modified = 2026-10-29 08:02:11.4573480
Attributes = A_ -rw-r--r--
CRC = 363A3020
Encrypted = +
Method = LZMA2:12 7zAES:19
Block = 0

Path = docs\\b.txt
Size = 4
Packed Size =
Modified = 2026-10-29 08:02:11.4573480
Attributes = A_ -rw-r--r--
CRC = 3A6C4C42
Encrypted = +
Method = LZMA2:12 7zAES:19
Block = 0
`;

Deno.test("7z l -slt", () => {
  const l = parse7zList(SEVEN);
  assertEquals(l.type, "7z");
  assertEquals(l.solid, true);
  assertEquals(l.encrypted, true);
  assertEquals(l.entries.map((e) => [e.path, e.dir, e.size]), [
    ["docs", true, 0],
    ["docs/a.txt", false, 6],
    ["docs/b.txt", false, 4],
  ]);
  assertEquals(l.entries[1].modified, "2026-10-29 08:02:11");
  assertEquals(sevenZipEncrypted(l), true);
  const locked = parse7zList(
    "Listing archive: x.7z\n\nERROR: x.7z\nCan not open encrypted archive. Wrong password?\n\nERRORS:\nHeaders Error",
  );
  assertEquals(locked.locked, true);
  assertEquals(locked.entries, []);
  // A ZIP read by 7z marks folders with "Folder = +".
  const zip = parse7zList(
    "--\nPath = a.zip\nType = zip\n\n----------\nPath = d\nFolder = +\nSize = 0\n\nPath = d/x\nFolder = -\nSize = 3\nEncrypted = -\nMethod = Deflate\n",
  );
  assertEquals(zip.entries.map((e) => e.dir), [true, false]);
  assertEquals(sevenZipEncrypted(zip), false);
});

Deno.test("where extracting goes", () => {
  const none = () => false;
  const single = summarize(parseUnzipList(UNZIP).entries);
  assertEquals(extractPlan("/dl/t.zip", single, none), { mode: "here", target: "/dl/d" });
  // The folder is already there: a new one named after the archive.
  assertEquals(extractPlan("/dl/t.zip", single, (p) => p === "/dl/d"), { mode: "folder", target: "/dl/t" });
  const loose = summarize([{ path: "a.txt", size: 1, dir: false }, { path: "b.txt", size: 1, dir: false }]);
  assertEquals(extractPlan("/dl/photos.tar.gz", loose, (p) => p === "/dl/photos"), {
    mode: "folder",
    target: "/dl/photos-2",
  });
  assertEquals(extractPlan("/dl/photos.tar.gz", undefined, none).mode, "folder");
  assertEquals(unsafeEntry("../../.bashrc"), true);
  assertEquals(unsafeEntry("/etc/passwd"), true);
  assertEquals(unsafeEntry("a/b..c"), false);
});

/** A local file header: "PK\x03\x04", flags, sizes and the name. */
function header(name: string, flags: number, data = new Uint8Array()): Uint8Array {
  const n = new TextEncoder().encode(name);
  const b = new Uint8Array(30 + n.length + data.length);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(6, flags, true);
  v.setUint32(18, data.length, true);
  v.setUint16(26, n.length, true);
  b.set(n, 30);
  b.set(data, 30 + n.length);
  return b;
}
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let i = 0;
  for (const p of parts) (out.set(p, i), i += p.length);
  return out;
};

Deno.test("encrypted ZIP entries", () => {
  assertEquals(zipEncrypted(concat(header("d/", 0), header("d/a.txt", 1, new Uint8Array(12)))), true);
  assertEquals(zipEncrypted(concat(header("d/", 0), header("d/a.txt", 0, new Uint8Array(5)))), false);
  assertEquals(zipEncrypted(new TextEncoder().encode("not a zip")), undefined);
});

Deno.test("listing commands", () => {
  assertEquals(listCommand("/a/t.zip", ALL)?.step, ["unzip", ["-l", "/a/t.zip"]]);
  assertEquals(listCommand("/a/t.zip", { ...NO_TOOLS, sevenZip: "7zz" })?.step, ["7zz", [
    "l",
    "-slt",
    "--",
    "/a/t.zip",
  ]]);
  assertEquals(listCommand("/a/t.7z", ALL)?.step[0], "7z");
  assertEquals(listCommand("/a/t.tar.gz", ALL)?.step, ["bsdtar", ["-tvf", "/a/t.tar.gz"]]);
  assertEquals(listCommand("/a/t.tar.gz", BASIC)?.step, ["tar", ["-tvf", "/a/t.tar.gz"]]);
  assertEquals(listCommand("/a/t.rar", BASIC), undefined);
  assertEquals(listCommand("/a/notes.txt.gz", ALL), undefined);
});

Deno.test("extracting never overwrites", () => {
  assertEquals(extractCommand("/a/t.zip", "/a/t", ALL), ["unzip", ["-n", "/a/t.zip", "-d", "/a/t"]]);
  assertEquals(extractCommand("/a/t.zip", "/a/t", ALL, "s3cret"), [
    "7z",
    ["x", "-aos", "-y", "-ps3cret", "-o/a/t", "--", "/a/t.zip"],
  ]);
  assertEquals(extractCommand("/a/t.zip", "/a/t", BASIC, "pw")[1].slice(0, 3), ["-n", "-P", "pw"]);
  assertEquals(extractCommand("/a/t.tar.xz", "/a/t", BASIC), [
    "tar",
    ["-x", "--skip-old-files", "-f", "/a/t.tar.xz", "-C", "/a/t"],
  ]);
  assertEquals(extractCommand("/a/t.tar.zst", "/a/t", { ...NO_TOOLS, bsdtar: true }), [
    "bsdtar",
    ["-x", "-k", "-f", "/a/t.tar.zst", "-C", "/a/t"],
  ]);
  assertThrows(() => extractCommand("/a/t.tar.zst", "/a/t", BASIC), MissingTool, "zstd");
  assertThrows(() => extractCommand("/a/t.rar", "/a/t", BASIC), MissingTool, "7-Zip");
  assertEquals(decompressCommand("/a/n.txt.xz", BASIC), ["xz", ["-d", "-c", "--", "/a/n.txt.xz"]]);
  assertThrows(() => decompressCommand("/a/n.txt.zst", BASIC), MissingTool);
});

Deno.test("compressing", () => {
  assertEquals(compressCommand("zip", "/a/x.zip", ["b", "-c"], BASIC), ["zip", [
    "-r",
    "-q",
    "-y",
    "/a/x.zip",
    "--",
    "b",
    "-c",
  ]]);
  assertEquals(compressCommand("zip", "/a/x.zip", ["b"], ALL, "pw"), [
    "7z",
    ["a", "-tzip", "-mem=AES256", "-ppw", "-y", "--", "/a/x.zip", "b"],
  ]);
  assertEquals(compressCommand("7z", "/a/x.7z", ["b"], ALL, "pw")[1], [
    "a",
    "-t7z",
    "-mx=7",
    "-ppw",
    "-mhe=on",
    "-y",
    "--",
    "/a/x.7z",
    "b",
  ]);
  assertEquals(compressCommand("tar.zst", "/a/x.tar.zst", ["b"], ALL), ["tar", [
    "-c",
    "-a",
    "-f",
    "/a/x.tar.zst",
    "--",
    "b",
  ]]);
  assertEquals(compressCommand("tar.zst", "/a/x.tar.zst", ["b"], { ...BASIC, bsdtar: true })[0], "bsdtar");
  assertThrows(() => compressCommand("tar.zst", "/a/x.tar.zst", ["b"], BASIC), MissingTool, "zstd");
  assertThrows(() => compressCommand("tar.gz", "/a/x.tar.gz", ["b"], ALL, "pw"), Error, "Only ZIP and 7z");
  assertThrows(() => compressCommand("7z", "/a/x.7z", ["b"], { ...NO_TOOLS, bsdtar: true }, "pw"), MissingTool);
  assertEquals(canCompress("7z", BASIC), false);
  assertEquals(canCompress("tar.xz", BASIC), true);
  assertEquals(canCompress("zip", BASIC, true), true);
});

Deno.test("names typed in the form", () => {
  assertEquals(cleanName(" Vacances 2026.zip "), "Vacances 2026");
  assertEquals(cleanName("src.tar.gz"), "src");
  assertThrows(() => cleanName("  "), Error, "Type a name");
  assertThrows(() => cleanName("a/b"), Error, "slash");
});

Deno.test("errors from the tools", () => {
  assertEquals(wrongPassword("skipping: d/a.txt                incorrect password"), true);
  assertEquals(wrongPassword("ERROR: Wrong password : docs/a.txt"), true);
  assertEquals(wrongPassword("No such file"), false);
  assertEquals(
    failureLine(
      "7z exited with 2: \n7-Zip [64] 17.05\n\nScanning the drive:\nERROR: No more files\nbad.txt\n\nSystem ERROR:\nUnknown error -2147024872",
    ),
    "No more files",
  );
  assertEquals(
    failureLine("tar: d/a.txt: Cannot open: Permission denied\ntar: Exiting with failure status"),
    "tar: d/a.txt: Cannot open: Permission denied",
  );
});

Deno.test("preview text and ratios", () => {
  const text = listingText(parseTarList(GNU_TAR).entries, 3);
  assertEquals(text.split("\n").length, 4);
  assertEquals(text.split("\n")[0], "           d/");
  assertEquals(text.endsWith("… and 3 more"), true);
  assertEquals(ratio(380, 1000), "62 % smaller");
  assertEquals(ratio(1100, 1000), "not compressed");
  assertEquals(ratio(0, 1000), undefined);
});

Deno.test("install commands", () => {
  assertEquals(installCommand(["bsdtar", "7z"], "debian"), "sudo apt install libarchive-tools 7zip");
  assertEquals(installCommand(["bsdtar", "zstd"], "arch"), "sudo pacman -S libarchive zstd");
});
