import { assert, assertEquals } from "@std/assert";
import {
  type App,
  candidates,
  CATEGORIES,
  currentDefault,
  desktopId,
  execProgram,
  fallbackName,
  mergeApps,
  osFamily,
  parseApp,
  parseQuery,
  parseTerminalsList,
  preferTerminal,
  terminalFromEnv,
} from "./lib.ts";

const cat = (id: string) => CATEGORIES.find((c) => c.id === id)!;

const FIREFOX = `[Desktop Entry]
Version=1.0
Name=Firefox
Name[fr]=Firefox
GenericName=Web Browser
Exec=/usr/lib/firefox/firefox %u
Type=Application
MimeType=text/html;text/xml;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;application/pdf;
Categories=Network;WebBrowser;

[Desktop Action new-window]
Name=New Window
Exec=/usr/lib/firefox/firefox --new-window %u
MimeType=should/not-count;
`;

const app = (id: string, name: string, mimes: string[], extra: Partial<App> = {}): App => ({
  id,
  name,
  exec: id.replace(".desktop", ""),
  mimes,
  categories: [],
  noDisplay: false,
  path: `/usr/share/applications/${id}`,
  ...extra,
});

Deno.test("parseApp reads the main group and skips hidden entries", () => {
  const ff = parseApp("firefox.desktop", "/usr/share/applications/firefox.desktop", FIREFOX)!;
  assertEquals(ff.name, "Firefox");
  assertEquals(ff.mimes.length, 6);
  assert(!ff.mimes.includes("should/not-count"));
  assertEquals(ff.categories, ["Network", "WebBrowser"]);
  assertEquals(parseApp("x.desktop", "/x", "[Desktop Entry]\nName=X\nHidden=true\n"), undefined);
  assertEquals(parseApp("x.desktop", "/x", "[Desktop Entry]\nName=X\nType=Link\n"), undefined);
  assert(parseApp("x.desktop", "/x", "[Desktop Entry]\nName=X\nNoDisplay=true\n")!.noDisplay);
});

Deno.test("desktopId and mergeApps follow the XDG rules", () => {
  assertEquals(desktopId("kde4/okular.desktop"), "kde4-okular.desktop");
  const user = app("firefox.desktop", "Firefox (mine)", []);
  const system = app("firefox.desktop", "Firefox", []);
  assertEquals(
    mergeApps([[user], [system, app("vlc.desktop", "VLC", [])]]).get("firefox.desktop")?.name,
    "Firefox (mine)",
  );
});

Deno.test("candidates ranks apps by how many types they cover, hidden apps last", () => {
  const apps = [
    app("org.gnome.Loupe.desktop", "Image Viewer", ["image/png", "image/jpeg", "image/webp", "image/gif"]),
    app("gimp.desktop", "GNU Image Manipulation Program", ["image/png", "image/jpeg"]),
    app("display-im6.q16.desktop", "ImageMagick", ["image/png"], { noDisplay: true }),
    app("vlc.desktop", "VLC", ["video/mp4"]),
  ];
  assertEquals(candidates(cat("images"), apps).map((a) => a.id), [
    "org.gnome.Loupe.desktop",
    "gimp.desktop",
    "display-im6.q16.desktop",
  ]);
  const foot = app("foot.desktop", "Foot", [], { categories: ["System", "TerminalEmulator"] });
  assertEquals(candidates(cat("terminal"), [...apps, foot]).map((a) => a.id), ["foot.desktop"]);
});

Deno.test("currentDefault spots mixed defaults", () => {
  const browser = currentDefault(cat("browser"), {
    "x-scheme-handler/http": "firefox.desktop",
    "x-scheme-handler/https": "firefox.desktop",
    "text/html": "firefox.desktop",
    "application/xhtml+xml": "chromium.desktop",
  }, "firefox.desktop");
  assertEquals([browser.id, browser.mixed], ["firefox.desktop", true]);
  const pdf = currentDefault(cat("pdf"), { "application/pdf": "org.gnome.Evince.desktop" });
  assertEquals([pdf.id, pdf.mixed], ["org.gnome.Evince.desktop", false]);
  const images = currentDefault(cat("images"), { "image/jpeg": "loupe.desktop", "image/gif": "loupe.desktop" });
  assertEquals([images.id, images.mixed], ["loupe.desktop", false]);
  const none = currentDefault(cat("video"), {});
  assertEquals([none.id, none.mixed], [undefined, false]);
});

Deno.test("parseQuery reads xdg-mime and xdg-settings answers", () => {
  assertEquals(parseQuery("org.gnome.Evince.desktop\n"), "org.gnome.Evince.desktop");
  assertEquals(parseQuery("okularApplication_pdf.desktop;okular.desktop;"), "okularApplication_pdf.desktop");
  assertEquals(parseQuery(""), undefined);
  assertEquals(parseQuery("xdg-settings: unknown desktop environment"), undefined);
});

Deno.test("xdg-terminals.list", () => {
  const text = "# preferred terminals\nkitty.desktop\nfoot.desktop:new-window\n\n";
  assertEquals(parseTerminalsList(text), ["kitty.desktop", "foot.desktop"]);
  assertEquals(
    preferTerminal(text, "org.gnome.Ptyxis.desktop"),
    "org.gnome.Ptyxis.desktop\nkitty.desktop\nfoot.desktop:new-window\n",
  );
  assertEquals(preferTerminal(text, "kitty.desktop"), "kitty.desktop\nfoot.desktop:new-window\n");
  assertEquals(preferTerminal("", "foot.desktop"), "foot.desktop\n");
});

Deno.test("execProgram, terminalFromEnv and fallbackName", () => {
  assertEquals(execProgram("env GDK_BACKEND=x11 /usr/bin/foot --server %U"), "foot");
  const apps = [
    app("org.wezfurlong.wezterm.desktop", "WezTerm", [], { exec: "wezterm start --cwd ." }),
    app("Alacritty.desktop", "Alacritty", [], { exec: "alacritty" }),
  ];
  assertEquals(terminalFromEnv("/usr/bin/wezterm", apps), "org.wezfurlong.wezterm.desktop");
  assertEquals(terminalFromEnv("alacritty -e", apps), "Alacritty.desktop");
  assertEquals(terminalFromEnv(undefined, apps), undefined);
  assertEquals(fallbackName("org.gnome.Nautilus.desktop"), "Nautilus");
  assertEquals(fallbackName("google-chrome.desktop"), "Google Chrome");
  assertEquals(osFamily("ID=fedora\n"), "fedora");
});
