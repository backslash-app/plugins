// Tables, fields and records of Airtable, NocoDB and Baserow in one shape:
// field types, how values are shown, how form values become API values, and
// the search filters. No network here.

import { Icons, type Item, open } from "@backslash/api";

export type Kind = "airtable" | "nocodb" | "baserow";
export const KIND_NAMES: Record<Kind, string> = { airtable: "Airtable", nocodb: "NocoDB", baserow: "Baserow" };

export class SetupError extends Error {
  constructor(message: string, readonly kind?: Kind, readonly base?: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Hosts

export const HOSTS = [
  "api.airtable.com",
  "app.nocodb.com",
  "api.baserow.io",
  "localhost",
  "127.0.0.1",
  "nocodb",
  "baserow",
  "*.local",
  "*.lan",
  "*.home",
  "*.home.arpa",
  "*.internal",
  "*.duckdns.org",
  "*.ts.net",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
];

function ipv4(host: string): number | undefined {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return undefined;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

/** Whether Deno's `--allow-net` with {@link HOSTS} lets us reach `host`. */
export function isAllowedHost(host: string, patterns = HOSTS): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return patterns.some((p) => {
    if (p.startsWith("*.")) return h.endsWith(p.slice(1)) || h === p.slice(2);
    const cidr = /^([\d.]+)\/(\d+)$/.exec(p);
    if (cidr) {
      const ip = ipv4(h), net = ipv4(cidr[1]);
      if (ip === undefined || net === undefined) return false;
      const bits = Number(cidr[2]);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((ip & mask) >>> 0) === ((net & mask) >>> 0);
    }
    return h === p;
  });
}

/** `nocodb.lan:8080/dashboard/#/…` → `http://nocodb.lan:8080`; a sub-path is kept. */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/(dashboard|api(\/v\d)?|database|signin|login)(\/.*)?$/i, "").replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return "";
  }
}

/** Where Baserow's web pages are: baserow.io for its hosted API, else the same server. */
export const baserowWeb = (api: string) => api.replace(/^https?:\/\/api\.baserow\.io/i, "https://baserow.io");

// ---------------------------------------------------------------------------
// Fields

export type FieldKind =
  | "text"
  | "longText"
  | "email"
  | "url"
  | "phone"
  | "number"
  | "rating"
  | "checkbox"
  | "select"
  | "multiSelect"
  | "date"
  | "dateTime"
  | "other";

export interface Field {
  id: string;
  name: string;
  kind: FieldKind;
  /** The type as the service names it, for the preview. */
  type: string;
  primary: boolean;
  /** Can be set when adding a record (not a formula, lookup, link, file…). */
  writable: boolean;
  /** Select choices; for Baserow, with their ids. */
  choices?: { name: string; id?: number }[];
  description?: string;
}

export interface Table {
  kind: Kind;
  id: string;
  name: string;
  baseId: string;
  baseName: string;
  /** Airtable lists fields with the tables; NocoDB and Baserow load them on demand. */
  fields?: Field[];
}

export const tableKey = (t: Pick<Table, "kind" | "id">) => `${t.kind}:${t.id}`;

const AIRTABLE_KINDS: Record<string, FieldKind> = {
  singleLineText: "text",
  multilineText: "longText",
  richText: "longText",
  email: "email",
  url: "url",
  phoneNumber: "phone",
  number: "number",
  currency: "number",
  percent: "number",
  duration: "number",
  rating: "rating",
  checkbox: "checkbox",
  singleSelect: "select",
  multipleSelects: "multiSelect",
  date: "date",
  dateTime: "dateTime",
};

export interface AirtableField {
  id: string;
  name: string;
  type: string;
  description?: string;
  options?: { choices?: { id?: string; name: string }[] } & Record<string, unknown>;
}

export interface AirtableTable {
  id: string;
  name: string;
  primaryFieldId: string;
  fields: AirtableField[];
}

export function fromAirtableTable(t: AirtableTable, base: { id: string; name: string }): Table {
  return {
    kind: "airtable",
    id: t.id,
    name: t.name,
    baseId: base.id,
    baseName: base.name,
    fields: t.fields.map((f) => {
      const kind = AIRTABLE_KINDS[f.type] ?? "other";
      return {
        id: f.id,
        name: f.name,
        kind,
        type: f.type,
        primary: f.id === t.primaryFieldId,
        writable: kind !== "other",
        choices: f.options?.choices?.map((c) => ({ name: c.name })),
        description: f.description,
      };
    }),
  };
}

const NOCODB_KINDS: Record<string, FieldKind> = {
  SingleLineText: "text",
  LongText: "longText",
  Email: "email",
  URL: "url",
  PhoneNumber: "phone",
  Number: "number",
  Decimal: "number",
  Currency: "number",
  Percent: "number",
  Duration: "number",
  Rating: "rating",
  Checkbox: "checkbox",
  SingleSelect: "select",
  MultiSelect: "multiSelect",
  Date: "date",
  DateTime: "dateTime",
};

export interface NocoColumn {
  id: string;
  title: string;
  column_name?: string;
  uidt: string;
  pk?: boolean | number;
  pv?: boolean | number;
  system?: boolean | number;
  ai?: boolean | number;
  meta?: unknown;
  colOptions?: { options?: { title: string }[] } | null;
  description?: string | null;
}

export function fromNocoColumns(columns: NocoColumn[]): Field[] {
  return columns.filter((c) => !c.system || c.pk).map((c) => {
    const kind = c.pk ? "other" : NOCODB_KINDS[c.uidt] ?? "other";
    return {
      id: c.id,
      name: c.title,
      kind,
      type: c.pk ? "ID" : c.uidt,
      primary: Boolean(c.pv),
      writable: kind !== "other" && !c.ai,
      choices: c.colOptions?.options?.map((o) => ({ name: o.title })),
      description: c.description ?? undefined,
    };
  });
}

/** The primary key column's title (rows are found by it), "Id" by default. */
export const nocoPk = (columns: NocoColumn[]) => columns.find((c) => c.pk)?.title ?? "Id";

const BASEROW_KINDS: Record<string, FieldKind> = {
  text: "text",
  long_text: "longText",
  email: "email",
  url: "url",
  phone_number: "phone",
  number: "number",
  rating: "rating",
  boolean: "checkbox",
  single_select: "select",
  multiple_select: "multiSelect",
  date: "date",
};

export interface BaserowField {
  id: number;
  name: string;
  type: string;
  primary?: boolean;
  read_only?: boolean;
  date_include_time?: boolean;
  select_options?: { id: number; value: string; color?: string }[];
  description?: string | null;
}

export function fromBaserowFields(fields: BaserowField[]): Field[] {
  return fields.map((f) => {
    let kind = BASEROW_KINDS[f.type] ?? "other";
    if (kind === "date" && f.date_include_time) kind = "dateTime";
    return {
      id: String(f.id),
      name: f.name,
      kind,
      type: f.type,
      primary: Boolean(f.primary),
      writable: kind !== "other" && !f.read_only,
      choices: f.select_options?.map((o) => ({ name: o.value, id: o.id })),
      description: f.description ?? undefined,
    };
  });
}

/** The field shown as a record's title: the primary one, else the first text field. */
export function primaryField(fields: Field[]): Field | undefined {
  return fields.find((f) => f.primary) ?? fields.find((f) => f.kind === "text") ?? fields[0];
}

// ---------------------------------------------------------------------------
// Values

/** Any cell value as text: attachments, collaborators, links and selects included. */
export function displayValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map(displayValue).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    // Airtable's formula errors: { error: "#ERROR!" } or { specialValue: "NaN" }.
    for (
      const k of ["value", "name", "title", "filename", "label", "error", "specialValue", "email", "display_value"]
    ) {
      if (typeof o[k] === "string" || typeof o[k] === "number") return String(o[k]);
    }
    if (o.value && typeof o.value === "object") return displayValue(o.value);
    try {
      return JSON.stringify(v);
    } catch {
      return "";
    }
  }
  return String(v);
}

/** "12,5" → 12.5; "1 234" → 1234; "" → undefined; "abc" → NaN. */
export function parseNumber(input: string): number | undefined {
  const s = input.trim().replace(/[\s ']/g, "");
  if (!s) return undefined;
  const normalized = /^-?\d+,\d+$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  const n = Number(normalized.replace(/[^\d.eE+-]/g, ""));
  return /\d/.test(normalized) ? n : NaN;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-29", "29/10/2026", "29/10", "today" → "2026-10-29". */
export function parseDay(input: string, now = new Date()): string | undefined {
  const s = input.trim().toLowerCase();
  if (s === "today" || s === "aujourd'hui") {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
  if (s === "tomorrow" || s === "demain") {
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  }
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else {
    match = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/.exec(s);
    if (!match) return undefined;
    [d, m] = [Number(match[1]), Number(match[2])];
    y = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : now.getFullYear();
  }
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return undefined;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** "2026-10-29 14:30", "29/10 9:05", "now" → an ISO instant (local time). */
export function parseDateTime(input: string, now = new Date()): string | undefined {
  const s = input.trim();
  if (/^now|maintenant$/i.test(s)) return now.toISOString();
  const m = /^(.*?)(?:[ T]+(\d{1,2})[:h](\d{2}))?$/.exec(s);
  if (!m) return undefined;
  const day = parseDay(m[1], now);
  if (!day) return undefined;
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(y, mo - 1, d, Number(m[2] ?? 0), Number(m[3] ?? 0)).toISOString();
}

/**
 * Form values → the record's fields as the service wants them, or the
 * sentence saying what's wrong. Empty fields are left out.
 */
export function recordFields(
  kind: Kind,
  fields: Field[],
  values: Record<string, string | boolean>,
  now = new Date(),
): Record<string, unknown> | string {
  const out: Record<string, unknown> = {};
  for (const f of fields.filter((x) => x.writable)) {
    const raw = values[`f_${f.id}`];
    if (raw === undefined) continue;
    if (f.kind === "checkbox") {
      if (raw === true || raw === "true") out[f.name] = true;
      else if (kind !== "airtable") out[f.name] = false;
      continue;
    }
    const s = String(raw).trim();
    if (!s) continue;
    switch (f.kind) {
      case "number":
      case "rating": {
        const n = parseNumber(s);
        if (n === undefined || Number.isNaN(n)) return `${f.name}: type a number`;
        out[f.name] = n;
        break;
      }
      case "date": {
        const d = parseDay(s, now);
        if (!d) return `${f.name}: type a date like 2026-10-29 or 29/10`;
        out[f.name] = d;
        break;
      }
      case "dateTime": {
        const d = parseDateTime(s, now);
        if (!d) return `${f.name}: type a date and time like 2026-10-29 14:30`;
        out[f.name] = d;
        break;
      }
      case "select": {
        if (kind === "baserow") {
          const c = f.choices?.find((x) => x.name === s);
          if (!c?.id) return `${f.name}: pick one of the options`;
          out[f.name] = c.id;
        } else out[f.name] = s;
        break;
      }
      case "multiSelect": {
        const names = s.split(",").map((x) => x.trim()).filter(Boolean);
        if (kind === "baserow") {
          const ids = names.map((n) => f.choices?.find((c) => c.name.toLowerCase() === n.toLowerCase())?.id);
          if (ids.some((i) => i === undefined)) {
            return `${f.name}: use the existing options (${f.choices?.map((c) => c.name).join(", ")})`;
          }
          out[f.name] = ids;
        } else if (kind === "nocodb") out[f.name] = names.join(",");
        else out[f.name] = names;
        break;
      }
      default:
        out[f.name] = s;
    }
  }
  if (!Object.keys(out).length || Object.values(out).every((v) => v === false)) return "Fill in at least one field";
  return out;
}

export function fieldHint(f: Field): string | undefined {
  switch (f.kind) {
    case "number":
      return "A number: 42, 12.5";
    case "rating":
      return "1 to 5";
    case "date":
      return "2026-10-29, 29/10, today";
    case "dateTime":
      return "2026-10-29 14:30";
    case "multiSelect":
      return f.choices?.length ? `Separated by commas: ${f.choices.slice(0, 5).map((c) => c.name).join(", ")}` : "a, b";
    case "email":
      return "name@example.com";
    case "url":
      return "https://…";
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Search

/** Fields worth searching: text-like ones, the primary first, at most 10. */
export function searchFields(fields: Field[]): Field[] {
  const text = (f: Field) => ["text", "longText", "email", "url", "phone", "select", "multiSelect"].includes(f.kind);
  return [...fields.filter((f) => f.primary), ...fields.filter((f) => !f.primary && text(f))].slice(0, 10);
}

/** Airtable `filterByFormula`: the query in any of the fields, ignoring case. */
export function airtableFormula(query: string, fields: Field[]): string | undefined {
  const q = query.trim();
  if (!q) return undefined;
  const literal = `"${q.toLowerCase().replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const parts = searchFields(fields).filter((f) => !/[{}]/.test(f.name))
    .map((f) => `FIND(${literal}, LOWER({${f.name}}&""))`);
  if (!parts.length) return undefined;
  return parts.length === 1 ? parts[0] : `OR(${parts.join(", ")})`;
}

/** NocoDB `where`: `(Name,like,%q%)~or(Notes,like,%q%)`. Its syntax has no escapes, so , ( ) ~ are dropped. */
export function nocoWhere(query: string, fields: Field[]): string | undefined {
  const q = query.trim().replace(/[,()~%]/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return undefined;
  const parts = searchFields(fields).filter((f) => !/[,()~]/.test(f.name)).map((f) => `(${f.name},like,%${q}%)`);
  return parts.length ? parts.join("~or") : undefined;
}

// ---------------------------------------------------------------------------
// Records

export interface Row {
  id: string;
  /** By field name. */
  fields: Record<string, unknown>;
  created?: string;
}

export interface RecordView {
  title: string;
  subtitle: string;
  /** Short values as lines, long text separately. */
  lines: { name: string; value: string; field?: Field }[];
  long: { name: string; value: string }[];
  tag?: string;
}

/** What a record shows: its primary value as the title, the next values in the subtitle and the preview. */
export function recordView(row: Row, fields: Field[]): RecordView {
  const primary = primaryField(fields);
  const title = displayValue(primary ? row.fields[primary.name] : undefined).replace(/\s+/g, " ").trim();
  const known = new Set(fields.map((f) => f.name));
  // Fields the schema doesn't list (NocoDB's system ones, a new column) come last.
  const extra = Object.keys(row.fields).filter((k) => !known.has(k) && !/^(nc_|__)/.test(k))
    .map((name): Field => ({ id: name, name, kind: "other", type: "", primary: false, writable: false }));
  const lines: RecordView["lines"] = [];
  const long: RecordView["long"] = [];
  for (const f of [...fields, ...extra]) {
    if (f === primary) continue;
    const value = displayValue(row.fields[f.name]).trim();
    if (!value) continue;
    if (f.kind === "longText" || value.length > 80 || value.includes("\n")) long.push({ name: f.name, value });
    else lines.push({ name: f.name, value, field: f });
  }
  const sub = lines.filter((l) => l.field?.kind !== "select" && l.field?.kind !== "checkbox" && l.field?.type !== "ID")
    .slice(0, 2).map((l) => l.value);
  return {
    title: title || "Untitled",
    subtitle: sub.join(" · "),
    lines,
    long,
    tag: lines.find((l) => l.field?.kind === "select")?.value,
  };
}

const escapeMd = (s: string) => s.replace(/([\\`*_[\]<>#|])/g, "\\$1");

export function recordMarkdown(v: RecordView): string {
  return [
    `## ${escapeMd(v.title)}`,
    ...v.long.flatMap((l) => ["", `**${escapeMd(l.name)}**`, "", escapeMd(l.value)]),
  ].join("\n");
}

/** The record as `Field: value` lines, to paste somewhere. */
export function recordText(v: RecordView): string {
  return [v.title, ...v.lines.map((l) => `${l.name}: ${l.value}`), ...v.long.map((l) => `${l.name}:\n${l.value}`)]
    .join("\n");
}

export function fieldIcon(kind: FieldKind): string {
  switch (kind) {
    case "longText":
      return Icons.text;
    case "email":
      return Icons.mail;
    case "url":
      return Icons.link;
    case "number":
    case "rating":
      return Icons.hash;
    case "checkbox":
      return Icons.squareCheck;
    case "select":
    case "multiSelect":
      return Icons.tag;
    case "date":
    case "dateTime":
      return Icons.calendar;
    default:
      return Icons.dot;
  }
}

// ---------------------------------------------------------------------------
// Errors

export function apiError(kind: Kind, status: number, body: unknown): Error {
  const name = KIND_NAMES[kind];
  const b = body as {
    error?: string | { type?: string; message?: string };
    message?: string;
    msg?: string;
    detail?: unknown;
  } | undefined;
  const message = (typeof b?.error === "object" ? b.error?.message ?? b.error?.type : undefined) ??
    b?.msg ?? b?.message ??
    (typeof b?.detail === "string" ? b.detail : b?.detail ? displayValue(b.detail) : undefined) ??
    (typeof b?.error === "string" ? b.error : undefined) ?? "";
  if (status === 401) return new SetupError(`${name} refused the token`, kind);
  if (status === 403) {
    return new SetupError(
      `${name} doesn't allow this${message ? `: ${message}` : ""}. Check the token's scopes or permissions`,
      kind,
    );
  }
  if (status === 404) {
    return new Error(`Not found on ${name}${message ? `: ${message}` : ": it may have been deleted"}`);
  }
  if (status === 422 || status === 400) return new Error(`${name} refused it${message ? `: ${message}` : ""}`);
  if (status === 429) return new Error(`${name} is rate limiting: try again in a moment`);
  return new Error(`${name} answered ${status}${message ? `: ${message}` : ""}`);
}

// ---------------------------------------------------------------------------
// Setup

export function setupItem(e: SetupError): Item {
  return {
    id: "setup",
    title: e.message,
    subtitle: e.kind ? `${KIND_NAMES[e.kind]} settings` : "Airtable, NocoDB & Baserow settings",
    icon: { source: e.message.includes("token") ? Icons.key : Icons.plug, tint: "orange" },
    detail: {
      markdown: [
        `## ${e.message}`,
        "",
        "Set up one or more, in **Settings → Extensions → Airtable, NocoDB & Baserow → Configure**:",
        "",
        "**Airtable**: a personal access token from **airtable.com/create/tokens** with the scopes",
        "`data.records:read`, `data.records:write` and `schema.bases:read`, and access to your bases.",
        "",
        "**NocoDB**: its address (`https://app.nocodb.com` or your server) and a token from",
        "**Account settings → Tokens**.",
        "",
        "**Baserow**: its API address (`https://api.baserow.io` or your server) and a **database token**",
        "from **My settings → Database tokens**, allowed to read and create rows.",
        "",
        "Servers can be this computer, local names (`*.local`, `*.lan`, `*.home.arpa`…), private networks",
        "(`192.168.x.x`, `10.x.x.x`), Tailscale (`100.64.x.x`, `*.ts.net`) or DuckDNS.",
      ].join("\n"),
    },
    actions: [
      ...(e.base ? [open(e.base, `Open ${e.kind ? KIND_NAMES[e.kind] : "Server"}`, { icon: Icons.globe })] : []),
      open("https://airtable.com/create/tokens", "Create an Airtable Token", { icon: Icons.key }),
    ],
  };
}
