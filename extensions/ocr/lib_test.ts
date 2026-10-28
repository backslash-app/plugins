import { assert, assertEquals } from "@std/assert";
import {
  describeLanguages,
  detectSession,
  firstLine,
  grabArea,
  grabberCandidates,
  grabberInstall,
  installLanguage,
  installTesseract,
  languageName,
  normalizeLanguages,
  ocrScript,
  osFamily,
  parseLanguages,
  parseVersion,
  systemdRunArgs,
  verbatim,
  words,
} from "./lib.ts";

Deno.test("selection tool per session", () => {
  assertEquals(grabberCandidates(detectSession({ XDG_SESSION_TYPE: "wayland", XDG_CURRENT_DESKTOP: "GNOME" })), [
    "gnome-screenshot",
  ]);
  assertEquals(grabberCandidates(detectSession({ XDG_SESSION_TYPE: "wayland", XDG_CURRENT_DESKTOP: "Hyprland" })), [
    "grim",
  ]);
  assertEquals(grabberCandidates(detectSession({ XDG_SESSION_TYPE: "x11", XDG_CURRENT_DESKTOP: "KDE" })), [
    "spectacle",
    "maim",
    "scrot",
    "import",
  ]);
  assertEquals(grabArea("grim"), `geometry=$(slurp) || exit 0; grim -g "$geometry" "$img"`);
  assertEquals(grabArea("spectacle"), `spectacle -b -n -r -o "$img"`);
});

Deno.test("languages preference", () => {
  assertEquals(normalizeLanguages("eng"), "eng");
  assertEquals(normalizeLanguages("eng, fra"), "eng+fra");
  assertEquals(normalizeLanguages(" English + French "), "eng+fra");
  assertEquals(normalizeLanguages("chi_sim+eng+eng"), "chi_sim+eng");
  assertEquals(normalizeLanguages("français"), "fra");
  assertEquals(normalizeLanguages(""), undefined);
  assertEquals(normalizeLanguages("$(rm -rf)"), undefined);
  assertEquals(describeLanguages("eng+fra"), "English + French");
  assertEquals(languageName("script/Latin"), "Latin (script)");
});

Deno.test("tesseract output", () => {
  const out = `List of available languages in "/usr/share/tesseract-ocr/5/tessdata/" (4):
eng
fra
osd
deu`;
  assertEquals(parseLanguages(out), ["eng", "fra", "deu"]);
  const version = `tesseract 5.3.4
 leptonica-1.82.0
  libgif 5.2.1 : libjpeg 8d (libjpeg-turbo 2.1.2) : libpng 1.6.43`;
  assertEquals(parseVersion(version), "5.3.4");
  assertEquals(parseVersion("tesseract v5.0.0-alpha-20201231"), "5.0.0");
});

Deno.test("background script", () => {
  const script = ocrScript({
    tool: "grim",
    languages: "eng+fra",
    historyDir: "/home/ada/.cache/backslash/ocr",
    wayland: true,
  });
  const lines = script.split("\n");
  assertEquals(lines[0], "sleep 0.4");
  assert(lines[3].startsWith("geometry=$(slurp)"));
  assert(script.includes(`tesseract "$img" - -l 'eng+fra'`));
  assert(script.includes(`printf '%s' "$text" | wl-copy`));
  assert(script.includes("tail -n +31"));
  assert(script.includes(`'/home/ada/.cache/backslash/ocr'/"$(date +%s)".txt`));
  assert(
    ocrScript({ tool: "maim", languages: "eng", historyDir: "/h", wayland: false, wait: 0.9 }).startsWith("sleep 0.9"),
  );
  const args = systemdRunArgs("backslash-ocr-1", "x", { DISPLAY: ":0", WAYLAND_DISPLAY: undefined });
  assertEquals(args.slice(-5), ["--property=KillMode=process", "--setenv=DISPLAY=:0", "/bin/sh", "-c", "x"]);
});

Deno.test("text helpers", () => {
  assertEquals(firstLine("\n\n  Invoice #42  \nTotal: 12 €"), "Invoice #42");
  assertEquals(firstLine("a".repeat(100), 10), "aaaaaaaaa…");
  assertEquals(words(" Hello   world\nagain "), 3);
  assertEquals(verbatim("a ```b``` c\n"), "```\na ˋˋˋbˋˋˋ c\n```");
});

Deno.test("what to install", () => {
  assertEquals(osFamily(`ID=arch`), "arch");
  assertEquals(
    installTesseract("debian", ["eng", "fra"]),
    "sudo apt install tesseract-ocr tesseract-ocr-eng tesseract-ocr-fra",
  );
  assertEquals(installTesseract("arch"), "sudo pacman -S tesseract tesseract-data-eng");
  assertEquals(installLanguage("fedora", "chi_sim"), "sudo dnf install tesseract-langpack-chi_sim");
  assertEquals(installLanguage("debian", "chi_sim"), "sudo apt install tesseract-ocr-chi-sim");
  assertEquals(installLanguage("suse", "fra"), "sudo zypper install tesseract-ocr-traineddata-french");
  assertEquals(
    grabberInstall({ wayland: true, desktop: "sway" }, "fedora"),
    "sudo dnf install grim slurp wl-clipboard",
  );
  assertEquals(
    grabberInstall({ wayland: true, desktop: "kde" }, "debian"),
    "sudo apt install kde-spectacle wl-clipboard",
  );
});

Deno.test("every generated script is valid sh", async () => {
  for (const tool of ["grim", "gnome-screenshot", "spectacle", "maim", "scrot", "import"] as const) {
    for (const wayland of [true, false]) {
      const script = ocrScript({ tool, languages: "eng+fra", historyDir: "/h/it's/ocr", wayland });
      const { success, stderr } = await new Deno.Command("sh", { args: ["-n", "-c", script], stderr: "piped" })
        .output();
      assert(success, new TextDecoder().decode(stderr));
    }
  }
});
