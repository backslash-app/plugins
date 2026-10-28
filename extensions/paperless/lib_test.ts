import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  asnText,
  cleanTaskError,
  cleanToken,
  CONSUMABLE,
  createdDay,
  type Doc,
  docView,
  excerpt,
  fileNameFrom,
  freePath,
  highlightsMarkdown,
  HOSTS,
  isAllowedHost,
  mimeOf,
  namesFrom,
  namesMissing,
  nearestColor,
  normalizeUrl,
  parseFileList,
  shareUrl,
  taskState,
  webUrl,
} from "./lib.ts";

// `GET /api/documents/?query=invoice&truncate_content=true`, Paperless-ngx 2.17.
const DOC: Doc = {
  id: 412,
  correspondent: 7,
  document_type: 3,
  storage_path: null,
  title: "Electricity invoice October",
  content: "EDF\n\n\nInvoice n° 4512\n   Period: October 2026  \nTotal: 84,20 €",
  tags: [12, 1],
  created: "2026-10-14",
  created_date: "2026-10-14",
  modified: "2026-10-15T08:01:12.123456+02:00",
  added: "2026-10-15T08:00:57.452310+02:00",
  archive_serial_number: 231,
  original_file_name: "scan_2026-10-15.pdf",
  archived_file_name: "2026-10-14 EDF Electricity invoice October.pdf",
  page_count: 2,
  mime_type: "application/pdf",
  notes: [{ id: 1, note: "Paid" }],
  __search_hit__: {
    score: 4.2,
    highlights: 'EDF <span class="match">Invoice</span> n° 4512 Period: October',
    note_highlights: null,
    rank: 0,
  },
};

const NAMES = namesFrom(
  [{ id: 7, name: "EDF" }],
  [{ id: 3, name: "Invoice" }],
  [
    { id: 1, name: "Inbox", color: "#0d6efd", is_inbox_tag: true },
    { id: 12, name: "Utilities", color: "#a6cee3" },
  ],
  [],
  1_700_000_000_000,
);

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(isAllowedHost("paperless"));
  assert(isAllowedHost("docs.duckdns.org"));
  assert(isAllowedHost("10.0.0.5"));
  assert(!isAllowedHost("paperless.example.com"));
});

Deno.test("addresses and tokens", () => {
  assertEquals(normalizeUrl("paperless.local:8000/dashboard"), "http://paperless.local:8000");
  assertEquals(normalizeUrl("https://nas.lan/paperless/documents/12/details"), "https://nas.lan/paperless");
  assertEquals(normalizeUrl(""), "");
  assertEquals(cleanToken(" Token 0123abc "), "0123abc");
  assertEquals(webUrl("http://p:8000", 412), "http://p:8000/documents/412/details");
  assertEquals(shareUrl("http://p:8000", "abc"), "http://p:8000/share/abc");
});

Deno.test("documents with their names", () => {
  const d = docView(DOC, NAMES);
  assertEquals(d.correspondent, "EDF");
  assertEquals(d.type, "Invoice");
  assertEquals(d.tags.map((t) => [t.name, t.color, !!t.inbox]), [["Inbox", "blue", true], [
    "Utilities",
    "blue",
    false,
  ]]);
  assertEquals(d.created, new Date(2026, 9, 14).getTime());
  assertEquals(d.asn, 231);
  assertEquals(d.notes, 1);
  assertEquals(d.highlights, "EDF **Invoice** n° 4512 Period: October");
  assertEquals(d.excerpt, "EDF\nInvoice n° 4512\nPeriod: October 2026\nTotal: 84,20 €");
  assertEquals(asnText(31), "ASN 0031");
  assertEquals(namesMissing(NAMES, [DOC]), false);
  assertEquals(namesMissing(NAMES, [{ ...DOC, tags: [99] }]), true);
  assertEquals(docView({ ...DOC, correspondent: null, title: "" }, NAMES).title, "scan_2026-10-15.pdf");
});

Deno.test("dates, colors and text", () => {
  assertEquals(createdDay("2024-03-01T00:00:00+01:00"), new Date(2024, 2, 1).getTime());
  assertEquals(createdDay(undefined), undefined);
  assertEquals(nearestColor("#dc3545"), "red");
  assertEquals(nearestColor("#20c997"), "teal");
  assertEquals(nearestColor("#ffffff"), "gray");
  assertEquals(nearestColor("nope"), "gray");
  assertEquals(highlightsMarkdown('a &amp; <span class="match">b</span>'), "a & **b**");
  assertEquals(highlightsMarkdown(""), undefined);
  assert(excerpt("word ".repeat(300), 100).endsWith("…"));
  assert(excerpt("word ".repeat(300), 100).length <= 101);
});

Deno.test("file names", () => {
  assertEquals(
    fileNameFrom(
      `attachment; filename="2026-10-14 EDF.pdf"; filename*=utf-8''2026-10-14%20EDF%20%C3%A9t%C3%A9.pdf`,
      "x.pdf",
    ),
    "2026-10-14 EDF été.pdf",
  );
  assertEquals(fileNameFrom('attachment; filename="scan.pdf"', "x.pdf"), "scan.pdf");
  assertEquals(fileNameFrom('attachment; filename="../../etc/passwd"', "x.pdf"), "_.._etc_passwd");
  assertEquals(fileNameFrom(null, "x.pdf"), "x.pdf");
  const taken = new Set(["/d/a.pdf", "/d/a (2).pdf"]);
  assertEquals(freePath("/d", "a.pdf", (p) => taken.has(p)), "/d/a (3).pdf");
  assertEquals(freePath("/d", "b.pdf", (p) => taken.has(p)), "/d/b.pdf");
});

Deno.test("copied files", () => {
  assertEquals(
    parseFileList("copy\nfile:///home/me/Scans/facture%20EDF.pdf\nfile:///home/me/photo.jpg\n", "/home/me"),
    ["/home/me/Scans/facture EDF.pdf", "/home/me/photo.jpg"],
  );
  assertEquals(parseFileList("~/a.pdf\nhttps://example.com/x.pdf", "/home/me"), ["/home/me/a.pdf"]);
  assert(CONSUMABLE.test("scan.PDF"));
  assert(CONSUMABLE.test("letter.docx"));
  assert(!CONSUMABLE.test("movie.mkv"));
  assertEquals(mimeOf("a.JPG"), "image/jpeg");
  assertEquals(mimeOf("a.xyz"), "application/octet-stream");
});

Deno.test("consumption tasks", () => {
  // API 9: Celery states.
  assertEquals(
    taskState({
      task_id: "a",
      status: "SUCCESS",
      result: "Success. New document id 413 created",
      related_document: "413",
      task_file_name: "scan.pdf",
    }),
    { state: "done", documentId: 413, message: "Success. New document id 413 created", fileName: "scan.pdf" },
  );
  assertEquals(
    taskState({
      task_id: "b",
      status: "FAILURE",
      result: "scan.pdf: Not consuming scan.pdf: It is a duplicate of Electricity invoice October (#412).",
    }).message,
    "It is a duplicate of Electricity invoice October (#412)",
  );
  assertEquals(taskState({ task_id: "c", status: "STARTED" }).state, "running");
  assertEquals(taskState({ task_id: "d", status: "PENDING" }).state, "pending");
  // API 10: lower-case states and lists of documents.
  assertEquals(taskState({ task_id: "e", status: "success", related_document_ids: [500] }).documentId, 500);
  assertEquals(
    taskState({ task_id: "f", status: "failure", result_data: { error: "Unsupported mime type" } }).message,
    "Unsupported mime type",
  );
  assertEquals(cleanTaskError(undefined), undefined);
});
