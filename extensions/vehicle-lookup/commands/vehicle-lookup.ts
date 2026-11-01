import { action, copy, Icons, type Item, list, meta, type Metadata, open, refresh } from "@backslash/api";
import { decode, forget, forgetAll, recalls, recent, remember } from "../api.ts";
import {
  type Decoded,
  inspectVin,
  type LocalVin,
  parseQuery,
  plural,
  type Recall,
  recallPage,
  summaryText,
  vehicleName,
} from "../lib.ts";

const EXAMPLE_VIN = "1HGCM82633A004352";

const HELP = [
  "## Vehicle Lookup",
  "",
  "- Paste a **17-character VIN** (on the windshield, the driver's door frame or the registration): make, model, year, engine, plant and safety recalls.",
  "- Or type a **make, model and year** for recalls only: `honda accord 2003`, `land rover defender 2021`, `tesla, model 3 2019`.",
  "",
  "Decoding comes from NHTSA's vPIC database. It knows vehicles sold in the United States best: a European or Asian VIN often only gives its maker, plant and year.",
].join("\n");

function localMetadata(v: LocalVin): Metadata[] {
  const lines: Metadata[] = [
    meta.text("Maker prefix (WMI)", v.wmi),
    meta.text("Descriptor (VDS)", v.vds),
    meta.text("Identifier (VIS)", v.vis),
  ];
  if (v.manufacturer) lines.push(meta.text("Maker", v.manufacturer));
  if (v.country || v.region) lines.push(meta.text("Assigned to", [v.country, v.region].filter(Boolean).join(", ")));
  if (v.years.length) lines.push(meta.text("Model year", v.years.join(" or "), { icon: Icons.calendar }));
  if (v.checkDigit) {
    lines.push(meta.tags("Check digit", [
      v.checkDigit.ok ? { text: `${v.checkDigit.found} correct`, color: "green" } : {
        text: `${v.checkDigit.found}, expected ${v.checkDigit.expected}`,
        color: v.checkDigit.required ? "red" : "gray",
      },
    ]));
  }
  if (v.small) lines.push(meta.text("Small maker", "Positions 12–14 complete the maker code"));
  return lines;
}

function checkDigitNote(v: LocalVin): string {
  if (!v.checkDigit || v.checkDigit.ok) return "";
  return v.checkDigit.required
    ? `**The check digit is wrong** (${v.checkDigit.found}, expected ${v.checkDigit.expected}): a character was probably mistyped.`
    : `The check digit doesn't match (${v.checkDigit.found}, expected ${v.checkDigit.expected}), which is normal outside North America and China: makers there don't have to use it.`;
}

function vehicleMarkdown(d: Decoded, v: LocalVin): string {
  const lines = [`## ${vehicleName(d)}`, "", `\`${d.vin}\``, ""];
  if (d.quality === "partial") {
    lines.push(
      "> vPIC decoded this VIN only in part. " +
        (/^[1-5]/.test(d.vin)
          ? "Some characters may be wrong."
          : "It mostly knows vehicles sold in the United States, so European and Asian models often miss details."),
      "",
    );
  }
  const note = checkDigitNote(v);
  if (note) lines.push(note, "");
  if (d.standard.length) lines.push("### Standard safety equipment", "", ...d.standard.map((s) => `- ${s}`), "");
  if (d.optional.length) lines.push("### Optional", "", ...d.optional.map((s) => `- ${s}`), "");
  if (d.errors.length) {
    lines.push("### vPIC remarks", "", ...d.errors.map((e) => `- ${e.code}: ${e.text}`), "");
  }
  return lines.join("\n");
}

function vehicleMetadata(d: Decoded): Metadata[] {
  const rows: [string, string | undefined][] = [
    ["Make", d.make],
    ["Model", d.model],
    ["Year", d.year ? String(d.year) : undefined],
    ["Trim", d.trim],
    ["Series", d.series],
    ["Body", [d.body, d.doors].filter(Boolean).join(", ") || undefined],
    ["Type", d.type],
    ["Engine", d.engine],
    ["Fuel", d.fuel],
    ["Electrification", d.electrification],
    ["Drive", d.drive],
    ["Transmission", d.transmission],
    ["Seats", d.seats],
    ["Steering", d.steering],
    ["Weight class", d.weightClass],
    ["Plant", d.plant],
    ["Manufacturer", d.manufacturer],
  ];
  return rows.filter(([, v]) => v).map(([label, v]) => meta.text(label, v!));
}

function recallItem(r: Recall, vehicle: string, section: string): Item {
  const flags = [
    ...(r.parkIt ? [{ tag: "Do not drive", color: "red" as const }] : []),
    ...(r.parkOutside ? [{ tag: "Park outside", color: "orange" as const }] : []),
    ...(r.overTheAir ? [{ tag: "Over-the-air fix", color: "blue" as const }] : []),
  ];
  return {
    id: `recall:${r.campaign}`,
    title: r.component,
    subtitle: r.date ? `${r.date} · ${r.campaign}` : r.campaign,
    icon: { source: Icons.alert, tint: r.parkIt ? "red" : "orange" },
    section,
    keywords: [r.campaign, r.summary],
    accessories: flags,
    detail: {
      markdown: [
        `## ${r.component}`,
        "",
        r.parkIt ? "> **Don't drive this vehicle** until the repair is done." : "",
        r.parkOutside ? "> **Park it outside**, away from buildings, until the repair is done." : "",
        r.summary,
        r.consequence ? `### Risk\n\n${r.consequence}` : "",
        r.remedy ? `### Remedy\n\n${r.remedy}` : "",
        r.notes ? `### Notes\n\n${r.notes}` : "",
      ].filter(Boolean).join("\n\n"),
      metadata: [
        meta.text("Campaign", r.campaign),
        ...(r.date ? [meta.text("Reported", r.date, { icon: Icons.calendar })] : []),
        ...(r.manufacturer ? [meta.text("Manufacturer", r.manufacturer)] : []),
        meta.text("Vehicle", vehicle),
      ],
    },
    actions: [
      open(recallPage(r.campaign), "Open on NHTSA"),
      copy(r.campaign, "Copy Campaign Number"),
      copy(`${r.component} (${r.campaign}): ${r.summary}`, "Copy Recall", { icon: Icons.text }),
    ],
  };
}

function recallsSection(list: Recall[], vehicle: string): Item[] {
  const section = list.length ? `Safety recalls · ${list.length}` : "Safety recalls";
  if (!list.length) {
    return [{
      id: "recalls:none",
      title: "No recalls found",
      subtitle: `NHTSA lists no safety recall for the ${vehicle}`,
      icon: { source: Icons.check, tint: "green" },
      section,
      detail: {
        markdown:
          "NHTSA has no recall campaign for this make, model and year. It only covers vehicles sold in the United States: check with the maker or your country's road safety agency for others.",
      },
    }];
  }
  return list.map((r) => recallItem(r, vehicle, section));
}

async function vinItems(vin: string, signal: AbortSignal): Promise<Item[]> {
  const local = inspectVin(vin);
  const d = await decode(vin, signal);
  const name = vehicleName(d);
  const items: Item[] = [];
  if (d.quality === "failed") {
    items.push({
      id: "vin:local",
      title: local.manufacturer ? `A ${local.manufacturer} VIN` : "vPIC doesn't know this VIN",
      subtitle: [local.country ?? local.region, local.years.length ? `model year ${local.years.join(" or ")}` : ""]
        .filter(Boolean).join(" · "),
      icon: { source: Icons.question, tint: "orange" },
      section: "From the VIN itself",
      detail: {
        markdown: [
          `## \`${vin}\``,
          "",
          "vPIC found no maker for this VIN. What the characters themselves tell is on the right.",
          "",
          checkDigitNote(local),
          ...(d.errors.length ? ["", ...d.errors.map((e) => `- ${e.code}: ${e.text}`)] : []),
        ].join("\n"),
        metadata: localMetadata(local),
      },
      actions: [copy(vin, "Copy VIN")],
    });
    return items;
  }
  await remember(vin, name);
  const found = d.make && d.model && d.year
    ? await recalls(d.make, d.model, d.year, signal).catch(() => undefined)
    : [];
  const quality = d.quality === "clean"
    ? { tag: "Decoded", color: "green" as const }
    : { tag: "Partial", color: "orange" as const };
  items.push({
    id: "vin:vehicle",
    title: name,
    subtitle: [d.body, d.engine, d.fuel].filter(Boolean).join(" · "),
    icon: { source: Icons.key, tint: "blue" },
    section: "Vehicle",
    accessories: [
      quality,
      ...(found?.length ? [{ tag: plural(found.length, "recall"), color: "red" as const }] : []),
    ],
    detail: {
      markdown: vehicleMarkdown(d, local),
      metadata: [...vehicleMetadata(d), meta.separator(), ...localMetadata(local)],
    },
    actions: [
      copy(summaryText(d, found), "Copy Summary"),
      copy(vin, "Copy VIN", { shortcut: "<Ctrl><Shift>c" }),
      copy(name, "Copy Vehicle Name", { icon: Icons.text }),
    ],
  });
  if (found === undefined) {
    items.push({
      id: "recalls:error",
      title: "Recalls couldn't be loaded",
      subtitle: "NHTSA's recall service didn't answer; try again later",
      icon: { source: Icons.alert, tint: "gray" },
      section: "Safety recalls",
      actions: [action("Try Again", () => refresh(), { icon: Icons.refresh })],
    });
  } else if (d.make && d.model && d.year) {
    items.push(...recallsSection(found, name));
  }
  return items;
}

async function recallItems(make: string, model: string, year: number, signal: AbortSignal): Promise<Item[]> {
  const found = await recalls(make, model, year, signal);
  const vehicle = `${year} ${make} ${model}`;
  if (!found.length) {
    return [{
      id: "recalls:none",
      title: `No recalls for the ${vehicle}`,
      subtitle: "Check the spelling of the make and model as NHTSA writes them",
      icon: { source: Icons.check, tint: "green" },
      detail: {
        markdown: [
          `## ${vehicle}`,
          "",
          "NHTSA lists no recall for this make, model and year. If you expected some, the model may be written differently (`f-150`, `model 3`, `cr-v`), or the make may take two words: separate it with a comma, `land rover, range rover 2015`.",
          "",
          "NHTSA only covers vehicles sold in the United States.",
        ].join("\n"),
      },
    }];
  }
  return found.map((r) => recallItem(r, vehicle, `${vehicle} · ${plural(found.length, "recall")}`));
}

function partialItem(v: LocalVin): Item {
  return {
    id: "vin:partial",
    title: v.problem ?? "Not a complete VIN",
    subtitle: "A VIN has 17 letters and digits, without I, O or Q",
    icon: { source: Icons.alert, tint: "orange" },
    detail: { markdown: HELP, metadata: v.vin.length >= 3 ? localMetadata({ ...v, checkDigit: undefined }) : [] },
    actions: [copy(v.vin, "Copy Input")],
  };
}

async function emptyItems(): Promise<Item[]> {
  const items: Item[] = (await recent()).map((r) => ({
    id: `recent:${r.vin}`,
    title: r.name,
    subtitle: r.vin,
    icon: { source: Icons.history, tint: "gray" },
    section: "Recent lookups",
    keywords: [r.vin],
    detail: { markdown: `## ${r.name}\n\n\`${r.vin}\`\n\nType or paste the VIN again to see its details and recalls.` },
    actions: [
      copy(r.vin, "Copy VIN"),
      action("Remove from Recent", async () => {
        await forget(r.vin);
        return refresh();
      }, { icon: Icons.trash, shortcut: "<Ctrl>x" }),
      action("Clear Recent Lookups", async () => {
        await forgetAll();
        return refresh();
      }, { icon: Icons.trash, destructive: true, confirm: "Forget all recent lookups?" }),
    ],
  }));
  items.push(
    {
      id: "help:vin",
      title: "Paste a VIN",
      subtitle: `For example ${EXAMPLE_VIN}`,
      icon: { source: Icons.lightbulb, tint: "yellow" },
      section: "How to use",
      detail: { markdown: HELP },
      actions: [copy(EXAMPLE_VIN, "Copy Example VIN")],
    },
    {
      id: "help:recalls",
      title: "Or type a make, model and year",
      subtitle: "honda accord 2003 — recalls only",
      icon: { source: Icons.lightbulb, tint: "yellow" },
      section: "How to use",
      detail: { markdown: HELP },
      actions: [copy("honda accord 2003", "Copy Example")],
    },
  );
  return items;
}

export default list({
  placeholder: "VIN, or make model year: honda accord 2003",
  empty: { title: "Nothing found", description: "Paste a 17-character VIN", icon: Icons.search },
  status: (items) => {
    const first = items[0];
    if (!first) return "";
    if (first.id === "vin:vehicle") {
      const n = items.filter((i) => i.id?.startsWith("recall:")).length;
      return n ? `${plural(n, "recall")} for this vehicle` : "Decoded by NHTSA vPIC";
    }
    if (first.id?.startsWith("recall:")) return plural(items.length, "recall");
    return "NHTSA vPIC · recalls";
  },
  async search(query, ctx) {
    const q = parseQuery(query);
    switch (q.kind) {
      case "empty":
        return await emptyItems();
      case "vin":
        return await vinItems(q.vin, ctx.signal);
      case "recalls":
        return await recallItems(q.make, q.model, q.year, ctx.signal);
      case "partial":
        return [partialItem(q.vin)];
      case "help":
        return [{
          id: "help",
          title: "Paste a VIN, or type make model year",
          subtitle: `“${q.text}” is neither`,
          icon: { source: Icons.info, tint: "blue" },
          detail: { markdown: HELP },
          actions: [copy(EXAMPLE_VIN, "Copy Example VIN")],
        }];
    }
  },
});
