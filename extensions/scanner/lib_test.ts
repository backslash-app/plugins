import { assert, assertEquals } from "@std/assert";
import {
  batchArgs,
  batchPages,
  explainSane,
  fileName,
  freeName,
  hasFeeder,
  installCommand,
  languages,
  ocrmypdfArgs,
  osFamily,
  parseOptions,
  parseScanners,
  pdfArgs,
  pickMode,
  pickResolution,
  pickSource,
  preset,
  recentScans,
  scanArgs,
  size,
  tesseractPdfArgs,
  when,
} from "./lib.ts";

Deno.test("scanimage -L: USB and network scanners, airscan kept over escl", () => {
  const found = parseScanners(`device \`escl:https://192.168.1.20:443' is a Canon TS5300 series flatbed scanner
device \`airscan:e0:Canon TS5300 series' is a eSCL Canon TS5300 series ip=192.168.1.20
device \`pixma:04A91912_123456' is a CANON Canon PIXMA MG5200 multi-function peripheral
device \`genesys:libusb:001:004' is a Canon LiDE 220 flatbed scanner
`);
  assertEquals(found.map((s) => [s.backend, s.name, s.network]), [
    ["airscan", "Canon TS5300 series", true],
    ["pixma", "CANON Canon PIXMA MG5200", false],
    ["genesys", "Canon LiDE 220", false],
  ]);
  assertEquals(parseScanners("\nNo scanners were identified. If you were expecting something different,\n"), []);
});

const OPTIONS = `
Options specific to device \`airscan:e0:Canon TS5300 series':
  Standard:
    --resolution 75|100|150|200|300|600dpi [300]
        Sets the resolution of the scanned image.
    --mode Color|Gray [Color]
        Selects the scan mode (e.g., lineart, monochrome, or color).
    --source Flatbed|ADF|ADF Duplex [Flatbed]
        Selects the scan source (such as a document-feeder).
  Geometry:
    -l 0..215.9mm [0]
`;

Deno.test("scanimage -A: modes, resolutions and sources", () => {
  const o = parseOptions(OPTIONS);
  assertEquals(o.modes, ["Color", "Gray"]);
  assertEquals(o.resolutions, [75, 100, 150, 200, 300, 600]);
  assertEquals(o.sources, ["Flatbed", "ADF", "ADF Duplex"]);
  assertEquals(o.defaults, { resolution: 300, mode: "Color", source: "Flatbed" });
  assert(hasFeeder(o));
  assertEquals(pickMode(o, "gray"), "Gray");
  assertEquals(pickMode(o, "lineart"), "Color");
  assertEquals(pickSource(o, "flatbed"), "Flatbed");
  assertEquals(pickSource(o, "adf"), "ADF");
  assertEquals(pickSource(o, "duplex"), "ADF Duplex");
  assertEquals(pickResolution(o, 400), 300);
  assertEquals(pickResolution(o, 1200), 600);
});

Deno.test("scanimage -A: ranges and vendor words", () => {
  const o = parseOptions(`    --mode Lineart|Gray|24bit Color[Fast] [24bit Color[Fast]]
    --resolution 50..1200dpi (in steps of 1) [150]
    --source Automatic Document Feeder(left aligned)|Automatic Document Feeder(left aligned,Duplex) [inactive]
`);
  assertEquals(o.range, { min: 50, max: 1200 });
  assertEquals(o.resolutions, [75, 100, 150, 200, 300, 600, 1200]);
  assertEquals(pickResolution(o, 400), 400);
  assertEquals(o.defaults.resolution, 150);
  assertEquals(o.defaults.source, undefined);
  assertEquals(pickSource(o, "adf"), "Automatic Document Feeder(left aligned)");
  assertEquals(pickSource(o, "duplex"), "Automatic Document Feeder(left aligned,Duplex)");
  assertEquals(pickSource(o, "flatbed"), undefined);
  assertEquals(pickSource(parseOptions(""), "flatbed"), undefined);
});

Deno.test("scan command lines", () => {
  const job = { device: "airscan:e0:Canon", mode: "Gray", resolution: 300, source: "ADF", feeder: true };
  assertEquals(scanArgs({ ...job, source: undefined }, "/c/page-001.png", "png"), [
    "-d",
    "airscan:e0:Canon",
    "--mode",
    "Gray",
    "--resolution",
    "300",
    "--format=png",
    "-o",
    "/c/page-001.png",
  ]);
  assertEquals(batchArgs(job, "/c").slice(-3), ["ADF", "--format=png", "--batch=/c/page-%03d.png"]);
  assertEquals(batchPages(["page-002.png", "pages.txt", "page-001.png", "document.pdf"]), [
    "page-001.png",
    "page-002.png",
  ]);
  assertEquals(pdfArgs("img2pdf", ["/a.png", "/b.png"], "/o.pdf"), ["/a.png", "/b.png", "-o", "/o.pdf"]);
  assertEquals(pdfArgs("magick", ["/a.png"], "/o.pdf"), ["/a.png", "/o.pdf"]);
  assertEquals(ocrmypdfArgs("/i.pdf", "/o.pdf", "eng+fra"), [
    "-l",
    "eng+fra",
    "--skip-text",
    "--deskew",
    "/i.pdf",
    "/o.pdf",
  ]);
  assertEquals(tesseractPdfArgs("/c/pages.txt", "/c/document", "eng"), [
    "/c/pages.txt",
    "/c/document",
    "-l",
    "eng",
    "pdf",
  ]);
  assertEquals(preset("photo").format, "png");
  assertEquals(preset("nope").id, "document");
});

Deno.test("file names", () => {
  const at = new Date(2026, 9, 29, 14, 5, 12);
  assertEquals(fileName(at), "Scan 2026-10-29 14.05.12.pdf");
  assertEquals(fileName(at, " Invoice: ACME/2026 ", "png"), "Invoice- ACME-2026.png");
  assertEquals(fileName(at, "...hidden"), "hidden.pdf");
  assertEquals(freeName("Invoice.pdf", new Set(["Invoice.pdf", "Invoice (2).pdf"])), "Invoice (3).pdf");
  assertEquals(freeName("Invoice.pdf", new Set()), "Invoice.pdf");
  assertEquals(languages("eng, fra"), "eng+fra");
  assertEquals(languages("chi_sim+eng"), "chi_sim+eng");
  assertEquals(languages("; rm -rf"), "eng");
  assertEquals(languages(undefined), "eng");
});

Deno.test("recent scans, sizes and dates", () => {
  const files = recentScans([
    { name: "a.pdf", size: 1_200_000, modified: 2 },
    { name: "b.png", size: 3000, modified: 3 },
    { name: "b.txt", size: 10, modified: 3 },
    { name: "notes.odt", size: 10, modified: 9 },
  ], "/s");
  assertEquals(files.map((f) => [f.name, f.text]), [["b.png", "/s/b.txt"], ["a.pdf", undefined]]);
  assertEquals(size(1_200_000), "1.2 MB");
  assertEquals(size(512), "512 B");
  const now = new Date(2026, 9, 29, 15, 0).getTime();
  assertEquals(when(new Date(2026, 9, 29, 14, 5).getTime(), now), "Today 14:05");
  assertEquals(when(new Date(2026, 9, 28, 9, 30).getTime(), now), "Yesterday 09:30");
  assertEquals(when(new Date(2026, 9, 25, 9, 30).getTime(), now), "4 days ago");
});

Deno.test("SANE errors and install commands", () => {
  assertEquals(
    explainSane("scanimage: sane_start: Document feeder out of documents"),
    "The document feeder is empty: put the pages in it",
  );
  assertEquals(
    explainSane("scanimage: open of device airscan:e0:X failed: Invalid argument"),
    "The scanner didn't open: it may be off, asleep or on another network",
  );
  assertEquals(
    explainSane("scanimage: setting of option --source failed (Invalid argument)"),
    "The scanner refused the source setting",
  );
  assertEquals(
    explainSane("scanimage: sane_read: Error during device I/O"),
    "The scanner stopped answering (I/O error): try again",
  );
  assertEquals(explainSane("scanimage: weird"), "weird");
  assertEquals(installCommand("sane", osFamily("ID=fedora\n")), "sudo dnf install sane-backends sane-airscan");
  assertEquals(
    installCommand("ocr", osFamily('ID=ubuntu\nID_LIKE="debian"\n')),
    "sudo apt install ocrmypdf tesseract-ocr",
  );
});
