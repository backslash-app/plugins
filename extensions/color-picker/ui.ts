// Items and actions shared by Color History and Convert Color.

import {
  type Action,
  action,
  close,
  type Color,
  copy,
  Icons,
  meta,
  type Metadata,
  paste,
  submenu,
  toast,
} from "@backslash/api";
import {
  BLACK,
  contrast,
  describeName,
  type Format,
  formats,
  pickerInstall,
  type RGB,
  rgbToOklch,
  swatch,
  toHex,
  wcag,
  WHITE,
} from "./lib.ts";
import { family, Missing, pick, session } from "./system.ts";

const levelColor = (level: string): Color => (level === "Fail" ? "red" : level === "AA Large" ? "orange" : "green");

function contrastLine(label: string, c: RGB, other: RGB): Metadata {
  const ratio = contrast({ ...c, a: 1 }, other);
  const level = wcag(ratio);
  return meta.tags(label, [{ text: `${ratio.toFixed(2)} : 1` }, { text: level, color: levelColor(level) }]);
}

/** The side panel of a color: every format, its name and contrast. */
export function colorMetadata(c: RGB, upper: boolean, extra: Metadata[] = []): Metadata[] {
  const all = formats(c, { upper });
  return [
    ...all.filter((f) => f.id !== "name").slice(0, 5).map((f) => meta.text(f.title, f.value)),
    meta.separator(),
    meta.text("Name", describeName(c), { icon: Icons.tag }),
    meta.progress("Lightness", rgbToOklch(c).l, `${Math.round(rgbToOklch(c).l * 100)} %`),
    contrastLine("On white", c, WHITE),
    contrastLine("On black", c, BLACK),
    ...extra,
  ];
}

/** Copy (Enter), Paste (Ctrl+Enter), then every format as a submenu. */
export function colorActions(c: RGB, upper: boolean): Action[] {
  const all: Format[] = formats(c, { upper });
  const hex = toHex(c, { upper });
  return [
    copy(hex, `Copy ${hex}`),
    paste(hex, `Paste ${hex}`),
    submenu(
      "Copy As",
      all.map((f) => copy(f.value, `${f.title}  ${f.value}`, { icon: Icons.copy })),
      { icon: Icons.copy, shortcut: "<Ctrl><Shift>c", section: "Copy" },
    ),
    submenu(
      "Paste As",
      all.map((f) => paste(f.value, `${f.title}  ${f.value}`, { icon: Icons.paste })),
      { icon: Icons.paste, shortcut: "<Ctrl><Shift>v", section: "Copy" },
    ),
  ];
}

export const pickAction = (upper: boolean) =>
  action("Pick Color from Screen", async () => {
    try {
      await pick({ upper });
    } catch (e) {
      if (e instanceof Missing) {
        await toast(`${e.message}: ${pickerInstall(session(), (await family()) ?? "debian")}`, { style: "failure" });
        return;
      }
      throw e;
    }
    return close();
  }, { icon: Icons.pipette, shortcut: "<Ctrl>p" });

export { swatch };
