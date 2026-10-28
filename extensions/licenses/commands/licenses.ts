import {
  type Action,
  action,
  clipboard,
  close,
  type Context,
  copy,
  detail,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  submenu,
  toast,
} from "@backslash/api";
import { exists, holderName, HOME, licenseText } from "../api.ts";
import { LICENSES } from "../data.ts";
import {
  CATEGORIES,
  category,
  categoryInfo,
  chooseUrl,
  compare,
  defaultFileName,
  expandHome,
  FILE_NAMES,
  fill,
  folderName,
  KIND_COLOR,
  KIND_TITLE,
  type License,
  namesHolder,
  placeholders,
  type RuleKind,
  ruleLabels,
  sortLicenses,
  spdxIds,
  spdxUrl,
  tilde,
} from "../lib.ts";

const YEAR = String(new Date().getFullYear());
const KINDS: RuleKind[] = ["permissions", "conditions", "limitations"];

async function filledText(l: License, name: string, project?: string): Promise<string> {
  return fill(await licenseText(l), { year: YEAR, name, project });
}

function writeForm(l: License, name: string): ReturnType<typeof form> {
  return form({
    title: `Add ${l.spdx} to a Project`,
    submitTitle: "Write License File",
    fields: [
      field.text("folder", "Project folder", { required: true, placeholder: "~/Projects/my-app" }),
      field.dropdown("file", "File name", FILE_NAMES, { value: defaultFileName(l) }),
      field.text("name", "Copyright holder", { value: name, placeholder: "Your name or organization" }),
      field.text("year", "Year", { value: YEAR }),
      field.checkbox("overwrite", "Replace the file if it already exists"),
    ],
    async submit(values) {
      const folder = expandHome(String(values.folder ?? ""), HOME);
      if (!folder.startsWith("/")) throw new Error("Type the full path of the folder, e.g. ~/Projects/my-app");
      let info: Deno.FileInfo;
      try {
        info = await Deno.stat(folder);
      } catch {
        throw new Error(`${tilde(folder, HOME)} doesn't exist`);
      }
      if (!info.isDirectory) throw new Error(`${tilde(folder, HOME)} is not a folder`);
      const target = `${folder}/${values.file || defaultFileName(l)}`;
      if (await exists(target) && !values.overwrite) {
        throw new Error(`${tilde(target, HOME)} already exists: tick “Replace the file” to overwrite it`);
      }
      const text = fill(await licenseText(l), {
        year: String(values.year || YEAR).trim(),
        name: String(values.name ?? "").trim(),
        project: folderName(folder),
      });
      await Deno.writeTextFile(target, text.endsWith("\n") ? text : text + "\n");
      const left = placeholders(text);
      if (left.length) {
        await toast(`Wrote ${tilde(target, HOME)}`, { style: "info", message: `Still to fill in: ${left.join(", ")}` });
      }
      return close(`Wrote ${tilde(target, HOME)}`);
    },
  });
}

async function textView(l: License, name: string) {
  const text = await filledText(l, name);
  return detail({
    title: l.title,
    markdown: ["```", text.trimEnd(), "```"].join("\n"),
    metadata: [
      meta.text("SPDX", spdxIds(l)[0], { icon: Icons.tag }),
      meta.text("Holder", namesHolder(await licenseText(l)) ? name || "—" : "Not named in the text"),
      meta.text("Year", YEAR, { icon: Icons.calendar }),
      meta.text("Length", `${text.split("\n").length} lines`),
    ],
    actions: [
      copy(text, "Copy License Text"),
      action("Write License File…", () => writeForm(l, name), { icon: Icons.file, shortcut: "<Ctrl>s" }),
    ],
  });
}

function compareMenu(l: License): Action {
  return submenu(
    "Compare With…",
    () =>
      sortLicenses(LICENSES).filter((o) => o.key !== l.key).map((o) =>
        action(`${o.spdx} · ${o.title}`, () =>
          detail({
            title: `${l.spdx} vs ${o.spdx}`,
            markdown: compare(l, o),
            metadata: [
              meta.tags(l.spdx, [{ text: categoryInfo(l).title, color: categoryInfo(l).tint }]),
              meta.tags(o.spdx, [{ text: categoryInfo(o).title, color: categoryInfo(o).tint }]),
              meta.separator(),
              meta.link(l.spdx, "choosealicense.com", chooseUrl(l)),
              meta.link(o.spdx, "choosealicense.com", chooseUrl(o)),
            ],
          }), { icon: Icons.shield })
      ),
    { icon: Icons.layers, shortcut: "<Ctrl>m" },
  );
}

function licenseItem(l: License, name: string): Item {
  const cat = categoryInfo(l);
  const ids = spdxIds(l);
  const rules: Metadata[] = KINDS.flatMap((kind) => {
    const labels = ruleLabels(l, kind);
    return labels.length ? [meta.tags(KIND_TITLE[kind], labels.map((text) => ({ text, color: KIND_COLOR[kind] })))] : [
      meta.text(KIND_TITLE[kind], "None", { color: "gray" }),
    ];
  });
  const using = Object.entries(l.using);
  return {
    id: l.key,
    title: l.title,
    subtitle: ids[0],
    icon: { source: Icons.shield, tint: cat.tint },
    section: l.featured ? "Popular" : cat.title,
    keywords: [l.spdx, l.key, l.nickname ?? "", cat.title, ...ids],
    accessories: [
      {
        text: `${l.permissions.length} · ${l.conditions.length} · ${l.limitations.length}`,
        tooltip: "Permissions · conditions · limitations",
      },
      { tag: cat.title, color: cat.tint },
    ],
    detail: {
      markdown: [
        `**${l.title}**${l.nickname ? ` · ${l.nickname}` : ""}`,
        "",
        l.description,
        ...(l.note ? ["", `> ${l.note}`] : []),
        "",
        `*${l.how}*`,
      ].join("\n"),
      metadata: [
        ...rules,
        meta.separator(),
        meta.text("SPDX", ids.join(" · "), { icon: Icons.tag }),
        meta.text("Kind", cat.title, { color: cat.tint }),
        meta.text("File", defaultFileName(l), { icon: Icons.file }),
        ...(using.length ? [meta.separator(), ...using.map(([n, url]) => meta.link("Used by", n, url))] : []),
        meta.separator(),
        meta.link("choosealicense", `choosealicense.com/licenses/${l.key}`, chooseUrl(l)),
        meta.link("SPDX", `spdx.org/licenses/${ids[0]}`, spdxUrl(ids[0])),
      ],
    },
    actions: [
      action("Copy License Text", async () => {
        await clipboard.write(await filledText(l, name));
        return close(`${l.spdx} text copied`);
      }, { icon: Icons.copy }),
      action("Write License File…", () => writeForm(l, name), { icon: Icons.file, shortcut: "<Ctrl>s" }),
      action("Show Full Text", () => textView(l, name), { icon: Icons.text, shortcut: "<Ctrl>t" }),
      compareMenu(l),
      ...ids.map((id, i) =>
        copy(id, `Copy SPDX ID${ids.length > 1 ? ` (${id.endsWith("-only") ? "only" : "or later"})` : ""}`, {
          icon: Icons.tag,
          section: "Copy",
          ...(i === 0 ? { shortcut: "<Ctrl><Shift>c" } : {}),
        })
      ),
      copy(`SPDX-License-Identifier: ${ids[0]}`, "Copy SPDX Header", { icon: Icons.code, section: "Copy" }),
      action("Copy Text with Placeholders", async () => {
        await clipboard.write(await licenseText(l));
        return close("Copied with [year] and [fullname]");
      }, { icon: Icons.copy, section: "Copy" }),
      open(chooseUrl(l), "Open on choosealicense.com", { section: "Links", shortcut: "<Ctrl>o" }),
      open(spdxUrl(ids[0]), "Open SPDX Page", { section: "Links", icon: Icons.globe }),
    ],
  };
}

export default async (ctx: Context) => {
  const name = await holderName(ctx.preferences.fullName);
  return list({
    placeholder: "Search licenses by name or SPDX id…",
    filter: {
      options: [{ value: "all", title: "All" }, ...CATEGORIES.map((c) => ({ value: c.value, title: c.title }))],
    },
    status: (items) =>
      `${items.length} license${items.length === 1 ? "" : "s"} · © ${YEAR} ${
        name || "(set your name in the preferences)"
      }`,
    empty: { title: "No license found", description: "Try an SPDX id like MIT or Apache-2.0.", icon: Icons.shield },
    items: ({ filter }) =>
      sortLicenses(LICENSES)
        .filter((l) => !filter || filter === "all" || category(l) === filter)
        .map((l) => licenseItem(l, name))
        .map((item) => filter && filter !== "all" ? { ...item, section: undefined } : item),
  });
};
