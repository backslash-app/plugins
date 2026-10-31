import { assert, assertEquals, assertInstanceOf, assertStringIncludes } from "@std/assert";
import { parse } from "@std/toml";
import {
  airtableFormula,
  type AirtableTable,
  apiError,
  type BaserowField,
  baserowWeb,
  displayValue,
  fromAirtableTable,
  fromBaserowFields,
  fromNocoColumns,
  HOSTS,
  isAllowedHost,
  type NocoColumn,
  nocoPk,
  nocoWhere,
  normalizeUrl,
  parseDateTime,
  parseDay,
  parseNumber,
  primaryField,
  recordFields,
  recordMarkdown,
  recordText,
  recordView,
  searchFields,
  SetupError,
  setupItem,
} from "./lib.ts";

Deno.test("manifest hosts match HOSTS", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(isAllowedHost("api.airtable.com"));
  assert(isAllowedHost("nocodb.lan"));
  assert(isAllowedHost("192.168.1.20"));
  assert(isAllowedHost("100.101.1.2"));
  assert(!isAllowedHost("nocodb.example.com"));
  assert(!isAllowedHost("8.8.8.8"));
});

Deno.test("addresses", () => {
  assertEquals(normalizeUrl("nocodb.lan:8080/dashboard/#/nc/p1/t1"), "http://nocodb.lan:8080");
  assertEquals(normalizeUrl("https://app.nocodb.com/"), "https://app.nocodb.com");
  assertEquals(normalizeUrl("http://192.168.1.20/baserow/api/database"), "http://192.168.1.20/baserow");
  assertEquals(normalizeUrl(""), "");
  assertEquals(baserowWeb("https://api.baserow.io"), "https://baserow.io");
  assertEquals(baserowWeb("http://baserow.lan"), "http://baserow.lan");
});

// GET /v0/meta/bases/{baseId}/tables
const airtable: AirtableTable = {
  id: "tblContacts01",
  name: "Contacts",
  primaryFieldId: "fldName",
  fields: [
    { id: "fldName", name: "Name", type: "singleLineText" },
    { id: "fldEmail", name: "Email", type: "email" },
    { id: "fldNotes", name: "Notes", type: "multilineText" },
    {
      id: "fldStage",
      name: "Stage",
      type: "singleSelect",
      options: { choices: [{ id: "sel1", name: "Lead" }, { id: "sel2", name: "Customer" }] },
    },
    { id: "fldTags", name: "Tags", type: "multipleSelects", options: { choices: [{ name: "vip" }, { name: "eu" }] } },
    { id: "fldScore", name: "Score", type: "number" },
    { id: "fldActive", name: "Active", type: "checkbox" },
    { id: "fldMet", name: "Met on", type: "date" },
    { id: "fldCall", name: "Next call", type: "dateTime" },
    { id: "fldCompany", name: "Company", type: "multipleRecordLinks" },
    { id: "fldFiles", name: "Files", type: "multipleAttachments" },
    { id: "fldAge", name: "Days since", type: "formula" },
  ],
};

// GET /api/v2/meta/tables/{tableId}
const noco: NocoColumn[] = [
  { id: "c1", title: "Id", uidt: "ID", pk: true, system: false },
  { id: "c2", title: "Title", uidt: "SingleLineText", pv: true },
  { id: "c3", title: "Status", uidt: "SingleSelect", colOptions: { options: [{ title: "Todo" }, { title: "Done" }] } },
  { id: "c4", title: "Labels", uidt: "MultiSelect", colOptions: { options: [{ title: "a" }, { title: "b" }] } },
  { id: "c5", title: "Done", uidt: "Checkbox" },
  { id: "c6", title: "CreatedAt", uidt: "CreatedTime", system: true },
  { id: "c7", title: "Projects", uidt: "Links" },
];

// GET /api/database/fields/table/{id}/
const baserow: BaserowField[] = [
  { id: 101, name: "Name", type: "text", primary: true },
  {
    id: 102,
    name: "Priority",
    type: "single_select",
    select_options: [{ id: 7, value: "High" }, { id: 8, value: "Low" }],
  },
  {
    id: 103,
    name: "Topics",
    type: "multiple_select",
    select_options: [{ id: 9, value: "Rust" }, { id: 10, value: "Go" }],
  },
  { id: 104, name: "Due", type: "date", date_include_time: true },
  { id: 105, name: "Created", type: "created_on", read_only: true },
  { id: 106, name: "Done", type: "boolean" },
];

Deno.test("field types", () => {
  const t = fromAirtableTable(airtable, { id: "appCRM", name: "CRM" });
  assertEquals(t.baseId, "appCRM");
  const byName = Object.fromEntries(t.fields!.map((f) => [f.name, f]));
  assertEquals(byName.Name.primary, true);
  assertEquals(byName.Notes.kind, "longText");
  assertEquals(byName.Stage.choices, [{ name: "Lead" }, { name: "Customer" }]);
  assertEquals(byName.Company.writable, false);
  assertEquals(byName.Files.writable, false);
  assertEquals(byName["Days since"].writable, false);
  assertEquals(primaryField(t.fields!)?.name, "Name");

  const n = fromNocoColumns(noco);
  assertEquals(n.map((f) => f.name), ["Id", "Title", "Status", "Labels", "Done", "Projects"]);
  assertEquals(n.find((f) => f.name === "Id")?.writable, false);
  assertEquals(n.find((f) => f.name === "Projects")?.writable, false);
  assertEquals(primaryField(n)?.name, "Title");
  assertEquals(nocoPk(noco), "Id");
  assertEquals(nocoPk([]), "Id");

  const b = fromBaserowFields(baserow);
  assertEquals(b.find((f) => f.name === "Due")?.kind, "dateTime");
  assertEquals(b.find((f) => f.name === "Created")?.writable, false);
  assertEquals(b.find((f) => f.name === "Priority")?.choices, [{ name: "High", id: 7 }, { name: "Low", id: 8 }]);
});

Deno.test("search filters", () => {
  const fs = fromAirtableTable(airtable, { id: "a", name: "A" }).fields!;
  assertEquals(searchFields(fs).map((f) => f.name), ["Name", "Email", "Notes", "Stage", "Tags"]);
  assertEquals(
    airtableFormula(' Ada "the" \\ ', fs.slice(0, 2)),
    'OR(FIND("ada \\"the\\" \\\\", LOWER({Name}&"")), FIND("ada \\"the\\" \\\\", LOWER({Email}&"")))',
  );
  assertEquals(airtableFormula("x", fs.slice(0, 1)), 'FIND("x", LOWER({Name}&""))');
  assertEquals(airtableFormula("  ", fs), undefined);
  const n = fromNocoColumns(noco);
  assertEquals(
    nocoWhere("to (do), x", n),
    "(Title,like,%to do x%)~or(Status,like,%to do x%)~or(Labels,like,%to do x%)",
  );
  assertEquals(nocoWhere("", n), undefined);
});

Deno.test("cell values as text", () => {
  assertEquals(displayValue(null), "");
  assertEquals(displayValue(true), "Yes");
  assertEquals(displayValue(["vip", "eu"]), "vip, eu");
  assertEquals(
    displayValue([{ id: "att1", url: "https://dl.airtable.com/x.pdf", filename: "contract.pdf" }]),
    "contract.pdf",
  );
  assertEquals(displayValue({ id: "usr1", email: "ada@example.org", name: "Ada" }), "Ada");
  assertEquals(displayValue([{ id: 7, value: "High", color: "red" }]), "High");
  assertEquals(displayValue({ error: "#ERROR!" }), "#ERROR!");
  assertEquals(displayValue({ specialValue: "NaN" }), "NaN");
  assertEquals(displayValue({ a: 1 }), '{"a":1}');
});

Deno.test("record views", () => {
  const fs = fromAirtableTable(airtable, { id: "a", name: "A" }).fields!;
  const row = {
    id: "recAda",
    created: "2026-10-01T10:00:00.000Z",
    fields: {
      Name: "Ada Lovelace",
      Email: "ada@example.org",
      Stage: "Customer",
      Score: 92,
      Notes: "Met at the conference.\nWants a demo.",
      Files: [{ filename: "notes.pdf" }],
      Unknown: "new column",
    },
  };
  const v = recordView(row, fs);
  assertEquals(v.title, "Ada Lovelace");
  assertEquals(v.subtitle, "ada@example.org · 92");
  assertEquals(v.tag, "Customer");
  assertEquals(v.lines.map((l) => l.name), ["Email", "Stage", "Score", "Files", "Unknown"]);
  assertEquals(v.long, [{ name: "Notes", value: "Met at the conference.\nWants a demo." }]);
  assertStringIncludes(recordMarkdown(v), "**Notes**\n\nMet at the conference.");
  assertStringIncludes(recordText(v), "Email: ada@example.org\nStage: Customer");
  assertEquals(recordView({ id: "r", fields: {} }, fs).title, "Untitled");
});

Deno.test("numbers and dates typed in a form", () => {
  const now = new Date(2026, 9, 30, 9, 0);
  assertEquals(parseNumber("12,5"), 12.5);
  assertEquals(parseNumber("1 234"), 1234);
  assertEquals(parseNumber("1,234.5"), 1234.5);
  assertEquals(parseNumber("-3"), -3);
  assertEquals(parseNumber(""), undefined);
  assert(Number.isNaN(parseNumber("abc")!));
  assertEquals(parseDay("2026-10-03", now), "2026-10-03");
  assertEquals(parseDay("3/10", now), "2026-10-03");
  assertEquals(parseDay("today", now), "2026-10-30");
  assertEquals(parseDay("tomorrow", now), "2026-10-31");
  assertEquals(parseDay("31/02", now), undefined);
  assertEquals(parseDateTime("2026-10-29 14:30", now), new Date(2026, 9, 29, 14, 30).toISOString());
  assertEquals(parseDateTime("29/10 9h05", now), new Date(2026, 9, 29, 9, 5).toISOString());
  assertEquals(parseDateTime("2026-10-29", now), new Date(2026, 9, 29).toISOString());
  assertEquals(parseDateTime("soon", now), undefined);
});

Deno.test("form values become API values", () => {
  const now = new Date(2026, 9, 30, 9, 0);
  const at = fromAirtableTable(airtable, { id: "a", name: "A" }).fields!;
  const id = (fs: { id: string; name: string }[], name: string) => `f_${fs.find((f) => f.name === name)!.id}`;
  assertEquals(
    recordFields("airtable", at, {
      [id(at, "Name")]: " Grace Hopper ",
      [id(at, "Email")]: "",
      [id(at, "Stage")]: "Lead",
      [id(at, "Tags")]: "vip, eu,",
      [id(at, "Score")]: "7,5",
      [id(at, "Active")]: true,
      [id(at, "Met on")]: "29/10",
    }, now),
    { Name: "Grace Hopper", Stage: "Lead", Tags: ["vip", "eu"], Score: 7.5, Active: true, "Met on": "2026-10-29" },
  );
  assertEquals(recordFields("airtable", at, { [id(at, "Score")]: "lots" }, now), "Score: type a number");
  assertEquals(recordFields("airtable", at, { [id(at, "Active")]: false }, now), "Fill in at least one field");

  const n = fromNocoColumns(noco);
  assertEquals(
    recordFields("nocodb", n, { [id(n, "Title")]: "Ship it", [id(n, "Labels")]: "a, b", [id(n, "Done")]: false }, now),
    { Title: "Ship it", Labels: "a,b", Done: false },
  );

  const b = fromBaserowFields(baserow);
  assertEquals(
    recordFields("baserow", b, {
      [id(b, "Name")]: "Learn Rust",
      [id(b, "Priority")]: "High",
      [id(b, "Topics")]: "rust, Go",
      [id(b, "Due")]: "2026-11-02 18:00",
      [id(b, "Done")]: false,
    }, now),
    {
      Name: "Learn Rust",
      Priority: 7,
      Topics: [9, 10],
      Due: new Date(2026, 10, 2, 18, 0).toISOString(),
      Done: false,
    },
  );
  assertStringIncludes(
    recordFields("baserow", b, { [id(b, "Topics")]: "Haskell" }, now) as string,
    "use the existing options (Rust, Go)",
  );
});

Deno.test("errors", () => {
  assertInstanceOf(apiError("airtable", 401, { error: { type: "AUTHENTICATION_REQUIRED" } }), SetupError);
  assertEquals(
    apiError("airtable", 422, {
      error: { type: "INVALID_VALUE_FOR_COLUMN", message: 'Field "Score" cannot accept "x"' },
    })
      .message,
    'Airtable refused it: Field "Score" cannot accept "x"',
  );
  assertEquals(apiError("nocodb", 400, { msg: "Invalid where" }).message, "NocoDB refused it: Invalid where");
  assertEquals(
    apiError("baserow", 404, { error: "ERROR_TABLE_DOES_NOT_EXIST", detail: "The requested table does not exist." })
      .message,
    "Not found on Baserow: The requested table does not exist.",
  );
  assertInstanceOf(apiError("baserow", 403, { error: "ERROR_NO_PERMISSION_TO_TABLE" }), SetupError);
  assertStringIncludes(setupItem(new SetupError("x")).detail!.markdown!, "schema.bases:read");
});
