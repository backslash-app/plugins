import { assert, assertEquals } from "@std/assert";
import {
  aspect,
  backendCandidates,
  backendPreference,
  compact,
  dedupeSizes,
  detectSession,
  downloadName,
  fileUri,
  imageSize,
  installCommand,
  mapUnsplash,
  mapWallhaven,
  orientation,
  parseFolders,
  parseGsettingsUri,
  persistenceHint,
  pickRandom,
  prettyName,
  resolutionLabel,
  sessionName,
  setCommands,
  type SizedFile,
  uniqueName,
  unsplashUrl,
  wallhavenUrl,
  xfceProperties,
} from "./lib.ts";

Deno.test("desktop from XDG_CURRENT_DESKTOP", () => {
  const d = (XDG_CURRENT_DESKTOP: string, extra = {}) =>
    detectSession({ XDG_CURRENT_DESKTOP, XDG_SESSION_TYPE: "wayland", ...extra }).desktop;
  assertEquals(d("ubuntu:GNOME"), "gnome");
  assertEquals(d("Budgie:GNOME"), "gnome");
  assertEquals(d("X-Cinnamon"), "cinnamon");
  assertEquals(d("MATE"), "mate");
  assertEquals(d("XFCE"), "xfce");
  assertEquals(d("KDE"), "kde");
  assertEquals(d("Hyprland"), "hyprland");
  assertEquals(d("", { SWAYSOCK: "/run/user/1000/sway-ipc.sock" }), "sway");
  assertEquals(d("i3"), "other");
  assertEquals(detectSession({ XDG_CURRENT_DESKTOP: "i3", XDG_SESSION_TYPE: "x11" }).wayland, false);
  assertEquals(sessionName({ desktop: "other", wayland: false }), "X11");
  assertEquals(sessionName({ desktop: "kde", wayland: true }), "KDE Plasma");
});

Deno.test("backends per desktop, and the preference", () => {
  assertEquals(backendCandidates({ desktop: "hyprland", wayland: true }), ["swww", "hyprpaper"]);
  assertEquals(backendCandidates({ desktop: "sway", wayland: true }), ["sway", "swww"]);
  assertEquals(backendCandidates({ desktop: "other", wayland: false }), ["feh", "nitrogen"]);
  assertEquals(backendCandidates({ desktop: "other", wayland: true }), ["swww"]);
  assertEquals(backendPreference(" KDE "), "kde");
  assertEquals(backendPreference("auto"), undefined);
  assertEquals(backendPreference("windows"), undefined);
});

Deno.test("commands that set the wallpaper", () => {
  const p = "/home/ada/Pictures/Wallpapers/Lac d'Annecy.jpg";
  const uri = "file:///home/ada/Pictures/Wallpapers/Lac%20d'Annecy.jpg";
  assertEquals(fileUri(p), uri);
  assertEquals(setCommands("gnome", p), [
    ["gsettings", ["set", "org.gnome.desktop.background", "picture-uri", uri]],
    ["gsettings", ["set", "org.gnome.desktop.background", "picture-uri-dark", uri]],
    ["gsettings", ["set", "org.gnome.desktop.background", "picture-options", "zoom"]],
  ]);
  assertEquals(setCommands("gnome", p, { variant: "dark" })[0][1][2], "picture-uri-dark");
  assertEquals(setCommands("gnome", p, { variant: "dark" }).length, 2);
  assertEquals(setCommands("cinnamon", p)[0], ["gsettings", [
    "set",
    "org.cinnamon.desktop.background",
    "picture-uri",
    uri,
  ]]);
  assertEquals(setCommands("mate", p)[0], ["gsettings", ["set", "org.mate.background", "picture-filename", p]]);
  assertEquals(setCommands("kde", p), [["plasma-apply-wallpaperimage", [p]]]);
  assertEquals(setCommands("hyprpaper", p), [
    ["hyprctl", ["hyprpaper", "preload", p]],
    ["hyprctl", ["hyprpaper", "wallpaper", `,${p}`]],
  ]);
  assertEquals(setCommands("swww", p)[0][1].slice(0, 2), ["img", p]);
  assertEquals(setCommands("sway", p), [["swaymsg", ["output", "*", "bg", p, "fill"]]]);
  assertEquals(setCommands("feh", p), [["feh", ["--no-fehbg", "--bg-fill", p]]]);
  assertEquals(setCommands("nitrogen", p), [["nitrogen", ["--set-zoom-fill", "--save", p]]]);
  const props = xfceProperties(
    [
      "/backdrop/screen0/monitoreDP-1/workspace0/color-style",
      "/backdrop/screen0/monitoreDP-1/workspace0/image-style",
      "/backdrop/screen0/monitoreDP-1/workspace0/last-image",
      "/backdrop/screen0/monitorHDMI-1/workspace0/last-image",
      "/desktop-icons/style",
    ].join("\n"),
  );
  assertEquals(props, [
    "/backdrop/screen0/monitoreDP-1/workspace0/last-image",
    "/backdrop/screen0/monitorHDMI-1/workspace0/last-image",
  ]);
  assertEquals(setCommands("xfce", p, { xfce: props })[1], ["xfconf-query", [
    "-c",
    "xfce4-desktop",
    "-p",
    "/backdrop/screen0/monitorHDMI-1/workspace0/last-image",
    "-s",
    p,
  ]]);
  assert(persistenceHint("hyprpaper", p)!.includes(`wallpaper = ,${p}`));
  assertEquals(persistenceHint("gnome", p), undefined);
});

Deno.test("current wallpaper from gsettings", () => {
  assertEquals(
    parseGsettingsUri("'file:///usr/share/backgrounds/warty-final-ubuntu.png'"),
    "/usr/share/backgrounds/warty-final-ubuntu.png",
  );
  assertEquals(parseGsettingsUri("'file:///home/ada/Lac%20d%27Annecy.jpg'"), "/home/ada/Lac d'Annecy.jpg");
  assertEquals(
    parseGsettingsUri("'/usr/share/backgrounds/mate/nature/Garden.jpg'"),
    "/usr/share/backgrounds/mate/nature/Garden.jpg",
  );
  assertEquals(parseGsettingsUri("''"), undefined);
});

Deno.test("folders and names", () => {
  assertEquals(parseFolders("", "/home/ada"), ["/home/ada/Pictures/Wallpapers"]);
  assertEquals(parseFolders("~/Pictures/Walls/, ~/Wallpapers,~/Pictures/Walls", "/home/ada"), [
    "/home/ada/Pictures/Walls",
    "/home/ada/Wallpapers",
  ]);
  assertEquals(prettyName("/x/mountain_lake-4k.jpg"), "Mountain lake 4k");
  assertEquals(prettyName("wallhaven-9dkeqd.png"), "Wallhaven 9dkeqd");
  assertEquals(uniqueName("a.jpg", new Set(["a.jpg", "a-2.jpg"])), "a-3.jpg");
  assertEquals(uniqueName("a.jpg", new Set()), "a.jpg");
});

const u16be = (n: number) => [n >> 8, n & 255];
const u32be = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

Deno.test("picture sizes from headers", () => {
  const png = new Uint8Array([
    0x89,
    ...ascii("PNG\r\n\x1a\n"),
    ...u32be(13),
    ...ascii("IHDR"),
    ...u32be(3840),
    ...u32be(2160),
  ]);
  assertEquals(imageSize(png), { width: 3840, height: 2160 });
  // SOI, an APP1 (EXIF) segment, then SOF2 (progressive).
  const jpeg = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe1,
    ...u16be(8),
    ...ascii("Exif\0\0"),
    0xff,
    0xc2,
    ...u16be(17),
    8,
    ...u16be(1440),
    ...u16be(2560),
    3,
  ]);
  assertEquals(imageSize(jpeg), { width: 2560, height: 1440 });
  const riff = (kind: string, body: number[]) =>
    new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii(kind), ...body]);
  // VP8X: flags, 3 reserved bytes, then width-1 and height-1 on 24 bits.
  const w = 1919, h = 1079;
  assertEquals(
    imageSize(
      riff("VP8X", [10, 0, 0, 0, 0, 0, 0, 0, w & 255, (w >> 8) & 255, w >> 16, h & 255, (h >> 8) & 255, h >> 16]),
    ),
    { width: 1920, height: 1080 },
  );
  // VP8 (lossy): chunk size, frame tag, start code, 14-bit sizes.
  assertEquals(
    imageSize(riff("VP8 ", [0, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, 800 & 255, 800 >> 8, 600 & 255, 600 >> 8])),
    { width: 800, height: 600 },
  );
  const gif = new Uint8Array([...ascii("GIF89a"), 300 & 255, 300 >> 8, 200, 0]);
  assertEquals(imageSize(gif), { width: 300, height: 200 });
  assertEquals(imageSize(new Uint8Array([1, 2, 3])), undefined);
});

Deno.test("formats", () => {
  assertEquals(aspect(1920, 1080), "16:9");
  assertEquals(aspect(3440, 1440), "21:9");
  assertEquals(aspect(2560, 1600), "16:10");
  assertEquals(aspect(1080, 1920), "9:16");
  assertEquals(orientation(1920, 1080), "landscape");
  assertEquals(orientation(1000, 1020), "square");
  assertEquals(resolutionLabel(3840, 2160), "4K");
  assertEquals(resolutionLabel(2560, 1440), "QHD");
  assertEquals(resolutionLabel(1920, 1080), "Full HD");
  assertEquals(resolutionLabel(800, 600), undefined);
  assertEquals(compact(1234), "1.2K");
  assertEquals(compact(45_678), "46K");
  assertEquals(compact(2_100_000), "2.1M");
});

Deno.test("random pick avoids the current one", () => {
  const list = ["a", "b"];
  for (let i = 0; i < 10; i++) assertEquals(pickRandom(list, (x) => x === "a"), "b");
  assertEquals(pickRandom(["a"], (x) => x === "a"), "a");
  assertEquals(pickRandom([], () => false), undefined);
});

// Trimmed from a real https://wallhaven.cc/api/v1/search response.
const WALLHAVEN_SAMPLE = {
  data: [
    {
      id: "9dkeqd",
      url: "https://wallhaven.cc/w/9dkeqd",
      short_url: "https://whvn.cc/9dkeqd",
      views: 18244,
      favorites: 412,
      source: "",
      purity: "sfw",
      category: "general",
      dimension_x: 3840,
      dimension_y: 2160,
      resolution: "3840x2160",
      ratio: "1.78",
      file_size: 2789203,
      file_type: "image/jpeg",
      created_at: "2026-09-30 11:04:12",
      colors: ["#424153", "#000000", "#999999"],
      path: "https://w.wallhaven.cc/full/9d/wallhaven-9dkeqd.jpg",
      thumbs: {
        large: "https://th.wallhaven.cc/lg/9d/9dkeqd.jpg",
        original: "https://th.wallhaven.cc/orig/9d/9dkeqd.jpg",
        small: "https://th.wallhaven.cc/small/9d/9dkeqd.jpg",
      },
    },
    {
      id: "o5m9x9",
      url: "https://wallhaven.cc/w/o5m9x9",
      views: 950,
      favorites: 30,
      category: "anime",
      dimension_x: 2560,
      dimension_y: 1440,
      resolution: "2560x1440",
      file_size: 900000,
      file_type: "image/png",
      colors: [],
      path: "https://w.wallhaven.cc/full/o5/wallhaven-o5m9x9.png",
      thumbs: {
        large: "https://th.wallhaven.cc/lg/o5/o5m9x9.jpg",
        small: "https://th.wallhaven.cc/small/o5/o5m9x9.jpg",
      },
    },
  ],
  meta: { current_page: 1, last_page: 120, per_page: 24, total: 2870, query: "mountain", seed: null },
};

Deno.test("Wallhaven search and results", () => {
  const url = new URL(wallhavenUrl("mountain lake", { atleast: "1920x1080" }));
  assertEquals(url.host, "wallhaven.cc");
  assertEquals(url.searchParams.get("q"), "mountain lake");
  assertEquals(url.searchParams.get("purity"), "100");
  assertEquals(url.searchParams.get("sorting"), "relevance");
  assertEquals(url.searchParams.get("atleast"), "1920x1080");
  const top = new URL(wallhavenUrl("", { sketchy: true, atleast: "big" }));
  assertEquals([top.searchParams.get("sorting"), top.searchParams.get("purity")], ["toplist", "110"]);
  assertEquals(top.searchParams.get("atleast"), null);
  const [a, b] = mapWallhaven(WALLHAVEN_SAMPLE);
  assertEquals(a.title, "General · 3840×2160");
  assertEquals(a.thumb, "https://th.wallhaven.cc/small/9d/9dkeqd.jpg");
  assertEquals(a.preview, "https://th.wallhaven.cc/lg/9d/9dkeqd.jpg");
  assertEquals(a.full, "https://w.wallhaven.cc/full/9d/wallhaven-9dkeqd.jpg");
  assertEquals([a.width, a.height, a.size, a.views, a.likes], [3840, 2160, 2789203, 18244, 412]);
  assertEquals(downloadName(a), "wallhaven-9dkeqd.jpg");
  assertEquals(downloadName(b), "wallhaven-o5m9x9.png");
  assertEquals(mapWallhaven({}), []);
});

// Trimmed from a real https://api.unsplash.com/search/photos response.
const UNSPLASH_SAMPLE = {
  total: 10000,
  total_pages: 334,
  results: [
    {
      id: "eOLpJytrbsQ",
      created_at: "2014-11-18T14:35:36Z",
      width: 4000,
      height: 3000,
      color: "#A7A2A1",
      likes: 286,
      description: "A man drinking a coffee.",
      alt_description: "man in blue crew neck shirt drinking coffee",
      user: {
        username: "johndoe",
        name: "John Doe",
        links: { html: "https://unsplash.com/@johndoe" },
        profile_image: { medium: "https://images.unsplash.com/profile-1441298803695?w=64" },
      },
      urls: {
        raw: "https://images.unsplash.com/photo-1416339306562-f3d12fefd36f",
        full: "https://images.unsplash.com/photo-1416339306562-f3d12fefd36f?q=85&fm=jpg",
        regular: "https://images.unsplash.com/photo-1416339306562-f3d12fefd36f?w=1080",
        small: "https://images.unsplash.com/photo-1416339306562-f3d12fefd36f?w=400",
      },
      links: {
        html: "https://unsplash.com/photos/eOLpJytrbsQ",
        download_location: "https://api.unsplash.com/photos/eOLpJytrbsQ/download?ixid=abc",
      },
    },
  ],
};

Deno.test("Unsplash search and results", () => {
  const url = new URL(unsplashUrl("forest"));
  assertEquals(url.host, "api.unsplash.com");
  assertEquals(url.pathname, "/search/photos");
  assertEquals(url.searchParams.get("orientation"), "landscape");
  assertEquals(new URL(unsplashUrl(" ")).pathname, "/photos");
  const [p] = mapUnsplash(UNSPLASH_SAMPLE);
  assertEquals(p.title, "Man in blue crew neck shirt drinking coffee");
  assertEquals(p.full, "https://images.unsplash.com/photo-1416339306562-f3d12fefd36f?w=3840&fm=jpg&q=85");
  assertEquals(p.downloadLocation, "https://api.unsplash.com/photos/eOLpJytrbsQ/download?ixid=abc");
  assertEquals(p.page, "https://unsplash.com/photos/eOLpJytrbsQ?utm_source=backslash&utm_medium=referral");
  assertEquals(p.author, "John Doe");
  assertEquals(p.colors, ["#a7a2a1"]);
  assertEquals(downloadName(p), "unsplash-eOLpJytrbsQ.jpg");
  // /photos returns a bare array.
  assertEquals(mapUnsplash(UNSPLASH_SAMPLE.results).length, 1);
});

Deno.test("install commands", () => {
  assertEquals(installCommand(["gsettings"], "debian"), "sudo apt install libglib2.0-bin");
  assertEquals(installCommand(["swww"], "arch"), "sudo pacman -S swww");
});

Deno.test("one entry per wallpaper shipped in several sizes", () => {
  const f = (path: string, system = true): SizedFile => ({
    path,
    name: path.split("/").pop()!,
    folder: path.split("/").slice(0, -1).join("/"),
    system,
  });
  const out = dedupeSizes([
    f("/usr/share/backgrounds/sway/Sway_Wallpaper_Blue_1366x768.png"),
    f("/usr/share/backgrounds/sway/Sway_Wallpaper_Blue_1920x1080.png"),
    f("/usr/share/backgrounds/sway/Sway_Wallpaper_Blue_768x1024_Portrait.png"),
    f("/usr/share/wallpapers/Next/contents/images/1920x1080.png"),
    f("/usr/share/wallpapers/Next/contents/images/5120x2880.png"),
    f("/usr/share/wallpapers/Next/contents/images_dark/3840x2160.png"),
    f("/home/ada/Pictures/Wallpapers/city_2560x1440.jpg", false),
    f("/home/ada/Pictures/Wallpapers/city_3840x2160.jpg", false),
  ]);
  assertEquals(out.map((w) => w.name), [
    "city_2560x1440.jpg",
    "city_3840x2160.jpg",
    "Sway_Wallpaper_Blue_1920x1080.png",
    "Sway_Wallpaper_Blue_768x1024_Portrait.png",
    "Next.png",
    "Next (dark).png",
  ]);
  assertEquals([out[4].width, out[4].height], [5120, 2880]);
});
