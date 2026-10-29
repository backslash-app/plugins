import {
  type Action,
  action,
  type Context,
  copy,
  detail,
  type DetailSpec,
  field,
  form,
  Icons,
  meta,
  paste,
  replace,
  storage,
  submenu,
  toast,
} from "@backslash/api";
import {
  customShape,
  type Format,
  FORMATS,
  generate,
  identifier,
  type Locale,
  LOCALES,
  newSeed,
  parseCount,
  render,
  type Shape,
  shape,
  SHAPES,
  type Value,
} from "../lib.ts";
import { localeOf, plural, size } from "../ui.ts";

interface Request {
  shape: string;
  fields: string;
  count: number;
  format: Format;
  locale: Locale;
  seed: string;
  table: string;
}

const LAST = "lastRequest";
/** The preview shows this much; copying always takes everything. */
const PREVIEW_CHARS = 12_000;

function fence(text: string, lang: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((t) => t.length));
  const f = "`".repeat(longest + 1);
  return `${f}${lang}\n${text}\n${f}`;
}

function resolveShape(r: Request): { shape: Shape; unknown: string[] } {
  if (r.shape !== "custom") return { shape: shape(r.shape) ?? SHAPES[0], unknown: [] };
  const custom = customShape(r.fields);
  if (!custom.shape.fields.length) {
    throw new Error("Name the fields of the custom shape, e.g. “id, full_name, email, iban, city”");
  }
  return {
    shape: { ...custom.shape, fields: ["id", ...custom.shape.fields.filter((f) => f !== "id")] },
    unknown: custom.unknown,
  };
}

function resultView(r: Request): DetailSpec {
  const started = performance.now();
  const { shape: s, unknown } = resolveShape(r);
  const rows: Record<string, Value>[] = generate(s, r.count, r.locale, r.seed);
  const table = identifier(r.table || s.table, s.table);
  const output = render(rows, r.format, table);
  const ms = Math.round(performance.now() - started);
  const fmt = FORMATS.find((f) => f.value === r.format)!;
  const lang = { json: "json", jsonl: "json", sql: "sql", markdown: "markdown" }[r.format as string] ?? "";
  const cut = output.length > PREVIEW_CHARS;
  const preview = cut ? output.slice(0, output.lastIndexOf("\n", PREVIEW_CHARS)) : output;
  const columns = Object.keys(rows[0] ?? {});

  const otherFormats: Action[] = FORMATS.filter((f) => f.value !== r.format).map((f) =>
    action(f.title, () => replace(resultView({ ...r, format: f.value })), { icon: Icons.braces })
  );
  return detail({
    title: `${plural(r.count, "row")} · ${s.title} · ${fmt.title}`,
    markdown: [
      ...(unknown.length ? [`> Unknown fields left out: ${unknown.join(", ")}`, ""] : []),
      fence(preview, lang),
      ...(cut ? ["", `_Preview of the first ${size(preview.length)}: Copy takes all ${size(output.length)}._`] : []),
    ].join("\n"),
    metadata: [
      meta.text("Rows", r.count.toLocaleString("en"), { icon: Icons.layers }),
      meta.tags("Columns", columns),
      meta.text("Format", fmt.title, { icon: Icons.braces }),
      ...(r.format === "sql" ? [meta.text("Table", table, { icon: Icons.database })] : []),
      meta.text("Locale", LOCALES.find((l) => l.value === r.locale)!.title, { icon: Icons.globe }),
      meta.text("Seed", r.seed, { icon: Icons.dice }),
      meta.text("Size", size(output.length)),
      meta.text("Generated in", `${ms} ms`, { icon: Icons.clock }),
    ],
    status: `Seed ${r.seed} · the same seed gives the same data`,
    actions: [
      copy(output, `Copy ${fmt.title}`),
      paste(output, `Paste ${fmt.title}`),
      action("Regenerate with a New Seed", () => replace(resultView({ ...r, seed: newSeed() })), {
        icon: Icons.refresh,
        shortcut: "<Ctrl>r",
      }),
      submenu("Show as…", otherFormats, { icon: Icons.braces, shortcut: "<Ctrl>f" }),
      copy(r.seed, "Copy Seed", { icon: Icons.dice, section: "Copy" }),
      ...(rows[0] ? [copy(JSON.stringify(rows[0], null, 2), "Copy First Row as JSON", { section: "Copy" })] : []),
      action("Change Settings", () => requestForm(r), { icon: Icons.settings, shortcut: "<Ctrl>e" }),
    ],
  });
}

function requestForm(last: Partial<Request> & { locale: Locale }) {
  return form({
    title: "Generate Fake Data",
    submitTitle: "Generate",
    fields: [
      field.dropdown(
        "shape",
        "Records",
        [...SHAPES.map((s) => ({ value: s.id, title: s.title })), { value: "custom", title: "Custom fields…" }],
        { value: last.shape ?? "person" },
      ),
      field.text("fields", "Custom fields", {
        placeholder: "full_name, email, phone, iban, siret, city, uuid, created_at…",
        value: last.fields ?? "",
      }),
      field.text("count", "How many", { value: String(last.count ?? 10), placeholder: "1 to 10,000" }),
      field.dropdown("format", "Format", FORMATS.map((f) => ({ value: f.value, title: f.title })), {
        value: last.format ?? "json",
      }),
      field.dropdown("locale", "Locale", LOCALES, { value: last.locale }),
      field.text("table", "SQL table name", {
        placeholder: "Default: people, customers, orders…",
        value: last.table ?? "",
      }),
      field.text("seed", "Seed", { placeholder: "Empty: a new random seed each time", value: "" }),
    ],
    async submit(values) {
      const r: Request = {
        shape: String(values.shape || "person"),
        fields: String(values.fields ?? ""),
        count: parseCount(String(values.count ?? "")),
        format: (FORMATS.find((f) => f.value === values.format)?.value ?? "json") as Format,
        locale: values.locale === "fr" ? "fr" : "en",
        seed: String(values.seed ?? "").trim() || newSeed(),
        table: String(values.table ?? "").trim(),
      };
      const view = resultView(r);
      await storage.set(LAST, { ...r, seed: "" }).catch(() => {});
      if (r.count >= 5000) await toast(`Generated ${plural(r.count, "row")}`, { style: "success" }).catch(() => {});
      return view;
    },
  });
}

export default async ({ preferences }: Context) => {
  const last = await storage.get<Partial<Request>>(LAST).catch(() => undefined) as Partial<Request> | undefined;
  return requestForm({ ...last, locale: last?.locale ?? localeOf(preferences.locale) });
};
