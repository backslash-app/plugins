// List items for each kind of query.

import { type Action, copy, Icons, type Item, meta, type Metadata } from "@backslash/api";
import {
  cm,
  complete,
  decimal,
  EXAMPLES,
  fit,
  mpText,
  nearestRatio,
  type Query,
  ratioLabel,
  RATIOS,
  ratioText,
  reduce,
  reframe,
  RESOLUTIONS,
  resolutionsOf,
  sameRatio,
  scaled,
  screen,
  type Size,
  sizeCode,
  sizeText,
} from "./lib.ts";

const SYNTAX = [
  "## What you can type",
  "",
  "| Type | To get |",
  "|---|---|",
  "| `1920x1080` | its ratio, megapixels and other sizes |",
  "| `16:9 1280` or `16:9 h720` | the missing dimension |",
  "| `1920x1080 to 4:3` | crop and letterbox sizes |",
  "| `fit 4000x3000 in 1920x1080` | scaled to fit or to fill |",
  '| `27" 2560x1440` | pixel density and physical size |',
  "| `21:9`, `2.39`, `4k`, `1080p` | what it's used for |",
].join("\n");

function sizeActions(s: Size, extra: Action[] = []): Action[] {
  return [
    copy(sizeCode(s), "Copy Size", { icon: Icons.copy }),
    copy(sizeText(s), "Copy as W × H", { icon: Icons.text }),
    ...extra,
    copy(String(s.width), "Copy Width", { icon: Icons.arrowRight }),
    copy(String(s.height), "Copy Height", { icon: Icons.arrowUp }),
  ];
}

function sizeMetadata(s: Size): Metadata[] {
  const [a, b] = reduce(s.width, s.height);
  const known = resolutionsOf(s.width, s.height);
  return [
    meta.text("Width", `${s.width} px`, { icon: Icons.arrowRight }),
    meta.text("Height", `${s.height} px`, { icon: Icons.arrowUp }),
    meta.text("Ratio", ratioLabel(s.width, s.height)),
    meta.text("Exact ratio", `${a}:${b}`),
    meta.text("Decimal", `${decimal(s.width / s.height, 3)}:1`),
    meta.text("Pixels", `${new Intl.NumberFormat("en-US").format(s.width * s.height)} (${mpText(s)})`),
    meta.text("Orientation", s.width > s.height ? "Landscape" : s.width < s.height ? "Portrait" : "Square"),
    ...(known.length ? [meta.tags("Known as", known.map((r) => ({ text: r.name, color: "blue" as const })))] : []),
  ];
}

function sizeItem(s: Size, o: { id: string; section: string; subtitle?: string; title?: string }): Item {
  const known = resolutionsOf(s.width, s.height);
  return {
    id: o.id,
    title: o.title ?? sizeText(s),
    subtitle: o.subtitle ?? (known.map((r) => r.name).join(", ") || undefined),
    icon: { source: Icons.monitor, tint: "blue" },
    section: o.section,
    accessories: [{ text: ratioLabel(s.width, s.height) }, { text: mpText(s) }],
    detail: { markdown: `## ${sizeText(s)}`, metadata: sizeMetadata(s) },
    actions: sizeActions(s),
  };
}

function ratioMarkdown(value: number, text: string): string {
  const known = nearestRatio(value, 0.002);
  const lines = [`## ${text}`, "", `${decimal(value, 3)}:1`];
  if (known) lines.push("", `**${known.name}**: ${known.uses}.`);
  const res = sameRatio(value);
  if (res.length) {
    lines.push("", "| Resolution | Name |", "|---|---|", ...res.map((r) => `| ${sizeText(r)} | ${r.name} |`));
  }
  return lines.join("\n");
}

/** Heights of a ratio at common widths. */
function ratioSizes(value: number, text: string, even: boolean): Item[] {
  const known = sameRatio(value);
  const items: Item[] = known.map((r, i) => ({
    ...sizeItem(r, { id: `known:${i}`, section: `Resolutions in ${text}`, subtitle: r.name }),
    keywords: [r.category, ...(r.aliases ?? [])],
  }));
  if (known.length < 4) {
    for (const width of [640, 1280, 1920, 2560, 3840]) {
      const s = complete(value, { width }, even);
      items.push(sizeItem(s, { id: `width:${width}`, section: `${text} at common widths` }));
    }
  }
  return items;
}

export function exampleItems(): Item[] {
  const items: Item[] = EXAMPLES.map((e) => ({
    id: `example:${e.query}`,
    title: e.query,
    subtitle: e.title,
    icon: { source: Icons.lightbulb, tint: "yellow" },
    section: "Examples: type one",
    detail: { markdown: SYNTAX },
    actions: [copy(e.query, "Copy Example")],
  }));
  for (const r of RATIOS) {
    items.push({
      id: `ratio:${r.text}`,
      title: r.text,
      subtitle: r.name,
      icon: { source: Icons.square, tint: "teal" },
      section: "Common Ratios",
      keywords: [r.uses],
      accessories: [{ text: `${decimal(r.value, 3)}:1` }],
      detail: { markdown: ratioMarkdown(r.value, r.text) },
      actions: [copy(r.text, "Copy Ratio"), copy(decimal(r.value, 4), "Copy Decimal")],
    });
  }
  for (const [i, r] of RESOLUTIONS.entries()) {
    items.push({
      ...sizeItem(r, { id: `res:${i}`, section: `${r.category} Resolutions`, title: r.name, subtitle: sizeText(r) }),
      keywords: [sizeCode(r), ...(r.aliases ?? [])],
    });
  }
  return items;
}

export function errorItems(message: string): Item[] {
  return [{
    id: "error",
    title: message,
    subtitle: "Try 1920x1080, 16:9 1280 or 1920x1080 to 4:3",
    icon: { source: Icons.alert, tint: "red" },
    detail: { markdown: SYNTAX },
    actions: [],
  }, ...exampleItems().filter((i) => i.id?.startsWith("example:"))];
}

export function itemsFor(q: Query, even: boolean): Item[] {
  switch (q.kind) {
    case "empty":
      return exampleItems();
    case "error":
      return errorItems(q.message);
    case "named":
      return q.matches.map((r, i) => ({
        ...sizeItem(r, { id: `named:${i}`, section: "Resolutions", title: r.name, subtitle: sizeText(r) }),
      }));
    case "size": {
      const s = q.size;
      const r = ratioText(s.width, s.height);
      const items: Item[] = [{
        ...sizeItem(s, { id: "size", section: "Size" }),
        title: ratioLabel(s.width, s.height),
        subtitle: [sizeText(s), ...resolutionsOf(s.width, s.height).map((x) => x.name)].join(" · "),
        icon: { source: Icons.square, tint: "blue" },
        accessories: [{ text: mpText(s) }],
        detail: {
          stats: [
            { label: "Ratio", value: r.common && !r.approximate ? r.common.text : r.exact },
            { label: "Megapixels", value: (s.width * s.height / 1e6).toFixed(2) },
          ],
          markdown: [
            `## ${sizeText(s)}`,
            "",
            r.common
              ? `${
                r.approximate ? `Close to **${r.common.text}**` : `**${r.common.text}**`
              } (${r.common.name}): ${r.common.uses}.`
              : `Exactly ${r.exact}.`,
          ].join("\n"),
          metadata: sizeMetadata(s),
        },
        actions: sizeActions(s, [copy(r.exact, "Copy Ratio", { icon: Icons.square })]),
      }];
      for (const { factor, size } of scaled(s, even)) {
        items.push(sizeItem(size, { id: `scale:${factor}`, section: "Same Ratio, Other Sizes" }));
        items[items.length - 1].accessories = [{ tag: `${factor * 100} %` }, { text: mpText(size) }];
      }
      if (s.width !== s.height) {
        const turned = { width: s.height, height: s.width };
        items.push(sizeItem(turned, { id: "rotated", section: "Rotated", subtitle: "Turned 90°" }));
      }
      for (const [i, k] of sameRatio(s.width / s.height).entries()) {
        if (k.width === s.width && k.height === s.height) continue;
        items.push(sizeItem(k, { id: `same:${i}`, section: "Known Resolutions with This Ratio", subtitle: k.name }));
      }
      return items;
    }
    case "ratio": {
      const known = nearestRatio(q.ratio, 0.002);
      return [{
        id: "ratio",
        title: q.text,
        subtitle: known ? `${known.name}: ${known.uses}` : `${decimal(q.ratio, 3)}:1`,
        icon: { source: Icons.square, tint: "blue" },
        section: "Ratio",
        accessories: [{ text: `${decimal(q.ratio, 3)}:1` }],
        detail: { markdown: ratioMarkdown(q.ratio, q.text) },
        actions: [copy(q.text, "Copy Ratio"), copy(decimal(q.ratio, 4), "Copy Decimal")],
      }, ...ratioSizes(q.ratio, q.text, even)];
    }
    case "complete": {
      const s = complete(q.ratio, q.given, even);
      const exact = q.given.width !== undefined ? q.given.width / q.ratio : q.given.height! * q.ratio;
      const rounded = !Number.isInteger(Math.round(exact * 1000) / 1000) || (even && Math.round(exact) % 2 === 1);
      const item = sizeItem(s, {
        id: "complete",
        section: `${q.text} · ${q.given.width !== undefined ? `width ${q.given.width}` : `height ${q.given.height}`}`,
        subtitle: rounded
          ? `${q.given.width !== undefined ? "Height" : "Width"} ${decimal(exact, 2)}, rounded${even ? " to even" : ""}`
          : undefined,
      });
      return [item, ...ratioSizes(q.ratio, q.text, even).slice(0, 12)];
    }
    case "reframe": {
      const f = reframe(q.size, q.ratio, even);
      const from = sizeText(q.size);
      const items: Item[] = [];
      const crop = f.crop;
      items.push({
        ...sizeItem(crop, { id: "crop", section: `${from} to ${q.text}` }),
        subtitle: crop.cutX || crop.cutY
          ? `Crop: ${
            crop.cutX ? `${decimal(crop.cutX, 0)} px off each side` : `${decimal(crop.cutY, 0)} px off top and bottom`
          }`
          : "Already this ratio",
        icon: { source: Icons.minus, tint: "orange" },
        detail: {
          markdown: [
            `## Crop to ${sizeText(crop)}`,
            "",
            `The biggest ${q.text} part of ${from}: ${
              Math.round(crop.width * crop.height / (q.size.width * q.size.height) * 100)
            } % of the picture kept.`,
            "",
            "```sh",
            `ffmpeg -i in.mp4 -vf "crop=${crop.width}:${crop.height}" out.mp4`,
            "```",
          ].join("\n"),
          metadata: sizeMetadata(crop),
        },
        actions: sizeActions(crop, [
          copy(`crop=${crop.width}:${crop.height}`, "Copy ffmpeg Filter", { icon: Icons.terminal }),
        ]),
      });
      const pad = f.pad;
      if (pad.kind !== "none") {
        const bar = pad.kind === "letterbox" ? pad.barY : pad.barX;
        items.push({
          ...sizeItem(pad, { id: "pad", section: `${from} to ${q.text}` }),
          subtitle: `${pad.kind === "letterbox" ? "Letterbox" : "Pillarbox"}: ${decimal(bar, 0)} px bars ${
            pad.kind === "letterbox" ? "above and below" : "on each side"
          }`,
          icon: { source: Icons.square, tint: "purple" },
          detail: {
            markdown: [
              `## ${pad.kind === "letterbox" ? "Letterbox" : "Pillarbox"} to ${sizeText(pad)}`,
              "",
              `The whole picture on a ${q.text} canvas, with ${
                pad.kind === "letterbox" ? "bars above and below" : "bars on the sides"
              }.`,
              "",
              "```sh",
              `ffmpeg -i in.mp4 -vf "pad=${pad.width}:${pad.height}:(ow-iw)/2:(oh-ih)/2" out.mp4`,
              "```",
            ].join("\n"),
            metadata: sizeMetadata(pad),
          },
          actions: sizeActions(pad, [
            copy(`pad=${pad.width}:${pad.height}:(ow-iw)/2:(oh-ih)/2`, "Copy ffmpeg Filter", { icon: Icons.terminal }),
          ]),
        });
      }
      items.push(sizeItem(q.size, { id: "original", section: "Original" }));
      return items;
    }
    case "fit": {
      const f = fit(q.size, q.box, even);
      const box = sizeText(q.box);
      const pct = (scale: number) => `${decimal(scale * 100, scale * 100 < 10 ? 1 : 0)} %`;
      return [
        {
          ...sizeItem(f.contain, { id: "contain", section: `${sizeText(q.size)} in ${box}` }),
          subtitle: `Fit inside, nothing cut · ${pct(f.contain.scale)}`,
          icon: { source: Icons.arrowDown, tint: "green" },
          actions: sizeActions(f.contain, [
            copy(`scale=${f.contain.width}:${f.contain.height}`, "Copy ffmpeg Filter", { icon: Icons.terminal }),
          ]),
        },
        {
          ...sizeItem(f.cover, { id: "cover", section: `${sizeText(q.size)} in ${box}` }),
          subtitle: `Fill, then cut ${
            f.cover.cutX ? `${f.cover.cutX} px of width` : f.cover.cutY ? `${f.cover.cutY} px of height` : "nothing"
          } · ${pct(f.cover.scale)}`,
          icon: { source: Icons.arrowUp, tint: "orange" },
          actions: sizeActions(f.cover, [
            copy(
              `scale=${f.cover.width}:${f.cover.height},crop=${q.box.width}:${q.box.height}`,
              "Copy ffmpeg Filter",
              { icon: Icons.terminal },
            ),
          ]),
        },
        sizeItem(q.size, { id: "original", section: "Original" }),
        sizeItem(q.box, { id: "box", section: "Box" }),
      ];
    }
    case "screen": {
      const sc = screen(q.size, q.diagonal);
      const ppi = Math.round(sc.ppi);
      const title = `${ppi} PPI`;
      const metadata: Metadata[] = [
        meta.text("Pixel density", `${decimal(sc.ppi, 1)} pixels per inch (${decimal(sc.ppi / 2.54, 1)} per cm)`),
        meta.text("Dot pitch", `${decimal(sc.dotPitch, 3)} mm`),
        meta.text("Width", `${decimal(sc.width, 1)} in · ${decimal(cm(sc.width), 1)} cm`),
        meta.text("Height", `${decimal(sc.height, 1)} in · ${decimal(cm(sc.height), 1)} cm`),
        meta.text("Diagonal", `${q.diagonal} in · ${decimal(cm(q.diagonal), 1)} cm`),
        meta.text("Area", `${decimal(cm(sc.width) * cm(sc.height) / 100, 0)} dm²`),
        meta.text(
          "Pixels disappear from",
          `${decimal(cm(sc.retinaDistance), 0)} cm (${decimal(sc.retinaDistance, 0)} in)`,
        ),
        meta.separator(),
        ...sizeMetadata(q.size),
      ];
      const scaleHint = sc.ppi > 200
        ? "Dense: desktops usually scale it 200 %."
        : sc.ppi > 140
        ? "Fairly dense: 125 to 150 % scaling is comfortable."
        : "Fine at 100 % scaling.";
      return [
        {
          id: "screen",
          title,
          subtitle: `${q.diagonal}″ ${sizeText(q.size)} · ${decimal(cm(sc.width), 1)} × ${
            decimal(cm(sc.height), 1)
          } cm`,
          icon: { source: Icons.monitor, tint: "blue" },
          section: "Screen",
          accessories: [{ text: ratioLabel(q.size.width, q.size.height) }],
          detail: {
            stats: [
              { label: "PPI", value: decimal(sc.ppi, 1) },
              { label: "Dot pitch", value: `${decimal(sc.dotPitch, 3)} mm` },
            ],
            markdown: [
              `## ${q.diagonal}″ at ${sizeText(q.size)}`,
              "",
              scaleHint,
              "",
              `Sitting farther than ${decimal(cm(sc.retinaDistance), 0)} cm, a 20/20 eye can't see single pixels.`,
            ].join("\n"),
            metadata,
          },
          actions: [
            copy(String(ppi), "Copy PPI"),
            copy(
              `${q.diagonal}″ ${sizeText(q.size)}: ${decimal(sc.ppi, 1)} PPI, ${decimal(sc.dotPitch, 3)} mm dot pitch`,
              "Copy Summary",
              { icon: Icons.text },
            ),
          ],
        },
        ...[1.25, 1.5, 2].map((factor): Item => {
          const looks = { width: Math.round(q.size.width / factor), height: Math.round(q.size.height / factor) };
          return {
            id: `scaling:${factor}`,
            title: `${factor * 100} % scaling`,
            subtitle: `Looks like ${sizeText(looks)} · ${decimal(sc.ppi / factor, 0)} PPI effective`,
            icon: { source: Icons.layers, tint: "gray" },
            section: "Display Scaling",
            detail: { markdown: `## ${factor * 100} % scaling`, metadata },
            actions: [copy(sizeCode(looks), "Copy Size")],
          };
        }),
      ];
    }
  }
}
