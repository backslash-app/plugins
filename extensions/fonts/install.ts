import { close, exec, field, form, type FormSpec } from "@backslash/api";
import { basename, expandPath, FONT_EXTENSIONS, isFontFile } from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";
/** Where fontconfig looks for the user's own fonts (XDG). */
export const USER_FONTS = `${HOME}/.local/share/fonts`;
/** The legacy folder, still read by fontconfig. */
export const LEGACY_FONTS = `${HOME}/.fonts`;
export const PREVIEWS = `${HOME}/.cache/backslash/fonts`;

/** Copies a font file into ~/.local/share/fonts and refreshes fontconfig's cache. Returns the new path. */
export async function installFont(input: string): Promise<string> {
  const source = expandPath(input, HOME);
  if (!source) throw new Error("Type the path of a font file (.ttf, .otf…)");
  if (!source.startsWith("/")) throw new Error(`Use an absolute path, e.g. ~/Downloads/${basename(source)}`);
  if (!isFontFile(source)) {
    throw new Error(
      `Not a font file: ${basename(source)} (expected ${FONT_EXTENSIONS.map((e) => `.${e}`).join(", ")})`,
    );
  }
  await Deno.mkdir(USER_FONTS, { recursive: true });
  const target = `${USER_FONTS}/${basename(source)}`;
  if (await Deno.stat(target).then(() => true, () => false)) {
    throw new Error(`${basename(source)} is already installed in ~/.local/share/fonts`);
  }
  // cp reads the file wherever it is, so the extension needs no read access to your folders.
  await exec("cp", ["--no-clobber", "--", source, target]).catch((err) => {
    const msg = String(err?.message ?? err);
    if (/No such file/i.test(msg)) throw new Error(`File not found: ${source}`);
    throw new Error(msg.replace(/^cp exited with \d+: /, ""));
  });
  await exec("fc-cache", ["-f", USER_FONTS]).catch(() => {});
  return target;
}

export function installForm(path: string, standalone: boolean): FormSpec {
  return form({
    title: "Install Font",
    submitTitle: "Install",
    fields: [
      field.text("path", "Font file", {
        required: true,
        placeholder: "~/Downloads/Inter-Regular.ttf",
        value: path,
      }),
    ],
    async submit(values) {
      const target = await installFont(String(values.path));
      return close(`Installed ${basename(target)}${standalone ? "" : ": reopen Fonts to see it"}`);
    },
  });
}
