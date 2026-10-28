import { assertEquals, assertThrows } from "@std/assert";
import {
  freePath,
  installCommand,
  MissingTool,
  move,
  NO_TOOLS,
  type Op,
  pageCount,
  pageSizeName,
  pagesOf,
  parseFileList,
  parsePdfinfo,
  parseRanges,
  pdfDate,
  plan,
  rangeText,
  sizeChange,
  toolOf,
  type Tools,
  wrongPassword,
} from "./lib.ts";

const ALL: Tools = {
  qpdf: true,
  gs: true,
  pdftk: true,
  pdfinfo: true,
  pdftoppm: true,
  pdfunite: true,
  pdfseparate: true,
  img2pdf: true,
  magick: "magick",
};
const POPPLER: Tools = { ...NO_TOOLS, pdfinfo: true, pdftoppm: true, pdfunite: true, pdfseparate: true };

Deno.test("copied files", () => {
  assertEquals(parseFileList("file:///home/ada/Documents/Rapport%20annuel.pdf\r\nfile:///home/ada/scan.png\r\n"), [
    "/home/ada/Documents/Rapport annuel.pdf",
    "/home/ada/scan.png",
  ]);
  assertEquals(parseFileList("copy\nfile:///a.pdf\nfile:///b.pdf"), ["/a.pdf", "/b.pdf"]);
});

Deno.test("page ranges", () => {
  assertEquals(parseRanges("1-3, 5, 8-", 10), [[1, 3], [5, 5], [8, 10]]);
  assertEquals(parseRanges("-2,last", 10), [[1, 2], [10, 10]]);
  assertEquals(parseRanges("z", 4), [[4, 4]]);
  assertThrows(() => parseRanges("", 3), Error, "Type the pages");
  assertThrows(() => parseRanges("2-12", 10), Error, "10 pages");
  assertThrows(() => parseRanges("5-2", 10), Error, "backwards");
  assertThrows(() => parseRanges("a-b", 10), Error, "isn't a page");
  assertThrows(() => parseRanges("0", 10), Error, "start at 1");
  const r = parseRanges("1-3,5", 10);
  assertEquals(rangeText(r), "1-3,5");
  assertEquals(pageCount(r), 4);
  assertEquals(pagesOf(r), [1, 2, 3, 5]);
});

const PDFINFO = `Title:           Rapport annuel 2025
Subject:
Keywords:
Author:          Ada Lovelace
Creator:         Writer
Producer:        LibreOffice 24.2
CreationDate:    Mon Oct  6 14:03:00 2026 CEST
ModDate:         Tue Oct  7 09:00:12 2026 CEST
Custom Metadata: no
Metadata Stream: yes
Tagged:          yes
UserProperties:  no
Suspects:        no
Form:            none
JavaScript:      no
Pages:           12
Encrypted:       yes (print:yes copy:no change:no addNotes:no algorithm:AES-256)
Page size:       595.276 x 841.89 pts (A4)
Page rot:        0
File size:       482193 bytes
Optimized:       no
PDF version:     1.7
`;

Deno.test("pdfinfo", () => {
  const i = parsePdfinfo(PDFINFO);
  assertEquals([i.title, i.author, i.creator, i.producer, i.pages], [
    "Rapport annuel 2025",
    "Ada Lovelace",
    "Writer",
    "LibreOffice 24.2",
    12,
  ]);
  assertEquals([i.encrypted, i.tagged, i.version, i.form, i.subject], [true, true, "1.7", undefined, undefined]);
  assertEquals(i.pageSize, "A4 (210 × 297 mm)");
  assertEquals(pageSizeName("612 x 792 pts (letter)"), "Letter (8.5 × 11 in)");
  assertEquals(pageSizeName("1000 x 500 pts"), "(353 × 176 mm)");
  assertEquals(pdfDate("Mon Oct  6 14:03:00 2026 CEST")?.getDate(), 6);
  assertEquals(pdfDate("garbage"), undefined);
  assertEquals(parsePdfinfo("Pages: 1\nEncrypted: no\n").encrypted, false);
});

Deno.test("names never overwrite", () => {
  const taken = new Set(["/d/a-merged.pdf"]);
  assertEquals(freePath("/d", "a-merged", "pdf", (p) => taken.has(p)), "/d/a-merged-2.pdf");
  assertEquals(freePath("/d", "a pages", "", () => false), "/d/a pages");
});

Deno.test("merge with the best tool", () => {
  const op: Op = { kind: "merge", inputs: ["/a.pdf", "/b.pdf"], output: "/m.pdf" };
  assertEquals(plan(op, ALL), [{ program: "qpdf", args: ["--empty", "--pages", "/a.pdf", "/b.pdf", "--", "/m.pdf"] }]);
  assertEquals(plan(op, POPPLER), [{ program: "pdfunite", args: ["/a.pdf", "/b.pdf", "/m.pdf"] }]);
  assertEquals(plan(op, { ...NO_TOOLS, pdftk: true })[0].args, ["/a.pdf", "/b.pdf", "cat", "output", "/m.pdf"]);
  assertEquals(plan(op, { ...NO_TOOLS, gs: true })[0].args.slice(-3), ["-sOutputFile=/m.pdf", "/a.pdf", "/b.pdf"]);
  assertThrows(() => plan(op, NO_TOOLS), MissingTool, "Merging");
});

Deno.test("extract pages", () => {
  const op: Op = { kind: "extract", input: "/a.pdf", ranges: [[1, 2], [5, 5]], output: "/o.pdf", tmp: "/t" };
  assertEquals(plan(op, ALL), [{ program: "qpdf", args: ["/a.pdf", "--pages", ".", "1-2,5", "--", "/o.pdf"] }]);
  assertEquals(plan(op, { ...NO_TOOLS, pdftk: true })[0].args, ["/a.pdf", "cat", "1-2", "5", "output", "/o.pdf"]);
  // poppler: separate each range, then join in order.
  assertEquals(plan(op, POPPLER), [
    { program: "pdfseparate", args: ["-f", "1", "-l", "2", "/a.pdf", "/t/page-%d.pdf"] },
    { program: "pdfseparate", args: ["-f", "5", "-l", "5", "/a.pdf", "/t/page-%d.pdf"] },
    { program: "pdfunite", args: ["/t/page-1.pdf", "/t/page-2.pdf", "/t/page-5.pdf", "/o.pdf"] },
  ]);
  assertEquals(plan(op, { ...NO_TOOLS, gs: true })[0].args.includes("-sPageList=1-2,5"), true);
});

Deno.test("split, compress, rotate", () => {
  assertEquals(plan({ kind: "split", input: "/a.pdf", dir: "/a pages", name: "a" }, ALL), [
    { program: "qpdf", args: ["--split-pages", "/a.pdf", "/a pages/a-%d.pdf"] },
  ]);
  assertEquals(plan({ kind: "split", input: "/a.pdf", dir: "/p", name: "a" }, POPPLER)[0], {
    program: "pdfseparate",
    args: ["/a.pdf", "/p/a-%d.pdf"],
  });
  const gs = plan({ kind: "compress", input: "/a.pdf", preset: "ebook", output: "/o.pdf" }, ALL)[0];
  assertEquals(gs.program, "gs");
  assertEquals(gs.args.includes("-dPDFSETTINGS=/ebook"), true);
  assertEquals(gs.args.slice(-2), ["-sOutputFile=/o.pdf", "/a.pdf"]);
  assertThrows(
    () => plan({ kind: "compress", input: "/a", preset: "screen", output: "/o" }, POPPLER),
    MissingTool,
    "Ghostscript",
  );
  assertEquals(
    plan({ kind: "compress", input: "/a.pdf", preset: "lossless", output: "/o.pdf" }, ALL)[0].program,
    "qpdf",
  );
  assertEquals(plan({ kind: "rotate", input: "/a.pdf", degrees: 90, output: "/o.pdf" }, ALL), [
    { program: "qpdf", args: ["/a.pdf", "/o.pdf", "--rotate=+90"] },
  ]);
  assertEquals(
    plan({ kind: "rotate", input: "/a.pdf", degrees: 270, output: "/o.pdf" }, { ...NO_TOOLS, pdftk: true })[0].args,
    [
      "/a.pdf",
      "cat",
      "1-endwest",
      "output",
      "/o.pdf",
    ],
  );
  assertThrows(() => plan({ kind: "rotate", input: "/a", degrees: 180, output: "/o" }, POPPLER), MissingTool);
});

Deno.test("passwords stay out of the command line with qpdf", () => {
  assertEquals(plan({ kind: "decrypt", input: "/a.pdf", password: "s3cret", output: "/o.pdf" }, ALL), [
    { program: "qpdf", args: ["--password-file=-", "--decrypt", "/a.pdf", "/o.pdf"], stdin: "s3cret" },
  ]);
  assertEquals(
    plan({ kind: "decrypt", input: "/a.pdf", password: "x", output: "/o.pdf" }, { ...NO_TOOLS, gs: true })[0]
      .args.includes("-sPDFPassword=x"),
    true,
  );
  assertEquals(wrongPassword("qpdf exited with 2: /a.pdf: invalid password"), true);
  assertEquals(wrongPassword("Command Line Error: Incorrect password"), true);
  assertEquals(wrongPassword("No such file"), false);
});

Deno.test("pictures", () => {
  assertEquals(plan({ kind: "toImages", input: "/a.pdf", format: "png", dpi: 150, dir: "/p", name: "a" }, ALL), [
    { program: "pdftoppm", args: ["-png", "-r", "150", "/a.pdf", "/p/a"] },
  ]);
  assertEquals(
    plan({ kind: "toImages", input: "/a.pdf", format: "jpg", dpi: 300, dir: "/p", name: "a" }, {
      ...NO_TOOLS,
      gs: true,
    })[0]
      .args.slice(-4),
    ["-r300", "-dJPEGQ=90", "-sOutputFile=/p/a-%03d.jpg", "/a.pdf"],
  );
  assertEquals(plan({ kind: "fromImages", inputs: ["/1.jpg", "/2.png"], output: "/o.pdf" }, ALL), [
    { program: "img2pdf", args: ["/1.jpg", "/2.png", "-o", "/o.pdf"] },
  ]);
  assertEquals(
    plan({ kind: "fromImages", inputs: ["/1.jpg"], output: "/o.pdf" }, { ...NO_TOOLS, magick: "convert" })[0],
    { program: "convert", args: ["/1.jpg", "-auto-orient", "/o.pdf"] },
  );
  assertEquals(toolOf({ kind: "fromImages", inputs: [], output: "" }, NO_TOOLS), undefined);
});

Deno.test("helpers", () => {
  assertEquals(move(["a", "b", "c"], 2, -1), ["a", "c", "b"]);
  assertEquals(move(["a", "b", "c"], 0, -1), ["a", "b", "c"]);
  assertEquals(move(["a", "b", "c"], 0, 1), ["b", "a", "c"]);
  assertEquals(sizeChange(1000, 250), "−75 %");
  assertEquals(
    installCommand(["qpdf", "ghostscript", "pdfinfo"], "debian"),
    "sudo apt install qpdf ghostscript poppler-utils",
  );
  assertEquals(installCommand(["pdfinfo", "pdftoppm"], "arch"), "sudo pacman -S poppler");
});
