import { type Context, detail, Icons, list, type ListSpec, meta } from "@backslash/api";
import { capturePackages, installMarkdown } from "../lib.ts";
import { type Ecc } from "../qr.ts";
import { clipboardImage, decodeFile, family, MissingTool, remember, session } from "../system.ts";
import { eccOf, entryItem } from "../ui.ts";

/** Decodes the picture in the clipboard and lists what it holds. */
export async function scanClipboardImage(ecc: Ecc): Promise<ListSpec | ReturnType<typeof detail>> {
  const file = await clipboardImage();
  if (!file) {
    return list({
      title: "Scan Image in Clipboard",
      items: [{
        id: "none",
        title: "No picture in the clipboard",
        subtitle: "Copy a screenshot or an image first",
        icon: { source: Icons.image, tint: "gray" },
        detail: {
          markdown:
            "Copy a picture (or take a screenshot to the clipboard), then run this again. Needs **wl-clipboard** on Wayland or **xclip** on X11.",
        },
      }],
    });
  }
  let found: string[];
  try {
    found = await decodeFile(file);
  } catch (e) {
    if (!(e instanceof MissingTool)) throw e;
    return detail({
      title: "Scan Image in Clipboard",
      markdown: installMarkdown(
        `**${e.message}.** Install it, then try again.`,
        e.packages.length ? e.packages : capturePackages(session()),
        await family(),
      ),
    });
  }
  if (!found.length) {
    return list({
      title: "Scan Image in Clipboard",
      items: [{
        id: "none",
        title: "No QR code in this picture",
        icon: { source: Icons.scan, tint: "gray" },
        detail: { image: file, metadata: [meta.text("Tip", "Crop closer to the code, with a little margin")] },
      }],
    });
  }
  const entries = found.map((text) => ({ kind: "scanned" as const, text, at: Date.now(), image: file }));
  await remember(entries.map(({ image: _, ...e }) => e));
  return list({ title: "Scanned", items: await Promise.all(entries.map((e) => entryItem(e, ecc))) });
}

export default (ctx: Context) => scanClipboardImage(eccOf(ctx));
