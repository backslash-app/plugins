import { type Action, action, copy, Icons, type Item, list, type ListSpec, meta, open } from "@backslash/api";
import { addressLine, codesText, coordinates, flag, mapUrl, type Place, placeLine } from "./lib.ts";

function placeActions(p: Place, code?: string): Action[] {
  const main = code ?? p.codes[0];
  return [
    ...(main ? [copy(main, "Copy Postal Code")] : []),
    ...(p.codes.length > 1 && !code
      ? [action("Show All Codes", () => codesView(p), { icon: Icons.hash, shortcut: "<Ctrl>l" })]
      : []),
    ...(main
      ? [copy(addressLine(p, main), "Copy Code and Place", { icon: Icons.mail, shortcut: "<Ctrl><Shift>c" })]
      : []),
    ...(p.codes.length > 1 ? [copy(p.codes.join("\n"), "Copy All Codes", { icon: Icons.copy, section: "Copy" })] : []),
    open(mapUrl(p), "Open Map", { icon: Icons.pin, shortcut: "<Ctrl>o" }),
    copy(coordinates(p), "Copy Coordinates", { icon: Icons.globe, section: "Copy" }),
    copy(p.name, "Copy Place Name", { icon: Icons.text, section: "Copy" }),
  ];
}

function detailMarkdown(p: Place, code?: string): string {
  const lines = [`# ${code ?? codesText(p)}`, "", `**${p.name}**, ${placeLine(p)}`];
  if (!code && p.codes.length > 1) {
    lines.push("", "```", ...chunk(p.codes, 6).map((row) => row.join("  ")), "```");
  }
  if (p.cedex.length) {
    lines.push(
      "",
      `${p.cedex.length} special codes (CEDEX for large organizations, SP for the military): ${
        p.cedex.slice(0, 6).join(", ")
      }${p.cedex.length > 6 ? "…" : ""}`,
    );
  }
  return lines.join("\n");
}

const chunk = <T>(xs: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export function placeItem(p: Place, section: string, code?: string): Item {
  return {
    id: `${p.id}:${code ?? ""}`,
    title: code ? `${code} ${p.name}` : p.name,
    subtitle: placeLine(p),
    icon: flag(p.country) || Icons.pin,
    section,
    accessories: code ? [] : [{ text: codesText(p), icon: Icons.mail }],
    keywords: [...p.codes, p.state ?? "", p.county ?? ""].filter(Boolean),
    detail: {
      markdown: detailMarkdown(p, code),
      metadata: [
        meta.text("Place", p.name, { icon: Icons.home }),
        ...(p.county && p.county !== p.name ? [meta.text("County", p.county)] : []),
        ...(p.state ? [meta.text("Region", p.state)] : []),
        meta.text("Country", `${flag(p.country)} ${p.countryName}`, { icon: Icons.globe }),
        ...(p.population ? [meta.text("Population", p.population.toLocaleString("en-US"))] : []),
        meta.separator(),
        meta.text("Coordinates", coordinates(p), { icon: Icons.pin }),
      ],
    },
    actions: placeActions(p, code),
  };
}

/** Every code of a place, one per line. */
export function codesView(p: Place): ListSpec {
  return list({
    title: p.name,
    placeholder: `Postal codes of ${p.name}`,
    status: `${p.codes.length} codes`,
    items: p.codes.map((c) => placeItem(p, `${p.name} · ${p.countryName}`, c)),
  });
}
