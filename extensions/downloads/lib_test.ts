import { assertEquals } from "@std/assert";
import {
  checkName,
  extTag,
  fileUri,
  freeName,
  hostOf,
  kindOf,
  matchesFilter,
  parseGetfattr,
  parseUserDirs,
  previewable,
  section,
  when,
} from "./lib.ts";

Deno.test("user-dirs.dirs", () => {
  const dirs = parseUserDirs(
    `# This file is written by xdg-user-dirs-update
XDG_DESKTOP_DIR="$HOME/Bureau"
XDG_DOWNLOAD_DIR="$HOME/Téléchargements"
XDG_TEMPLATES_DIR="$HOME/"
XDG_DOCUMENTS_DIR="/data/Documents"
XDG_PICTURES_DIR="$HOME/Images/"
`,
    "/home/ada",
  );
  assertEquals(dirs, {
    DESKTOP: "/home/ada/Bureau",
    DOWNLOAD: "/home/ada/Téléchargements",
    DOCUMENTS: "/data/Documents",
    PICTURES: "/home/ada/Images",
  });
});

Deno.test("kinds and filters", () => {
  assertEquals(kindOf("photo.JPEG"), "image");
  assertEquals(kindOf("Invoice-2026.pdf"), "document");
  assertEquals(kindOf("backup.tar.zst"), "archive");
  assertEquals(kindOf("code_1.95_amd64.deb"), "installer");
  assertEquals(kindOf("Obsidian-1.7.4.AppImage"), "installer");
  assertEquals(kindOf("yay-12.4.2-1-x86_64.pkg.tar.zst"), "installer");
  assertEquals(kindOf("movie.mkv.crdownload"), "partial");
  assertEquals(kindOf("thing"), "other");
  assertEquals(kindOf("photos", true), "folder");
  assertEquals(matchesFilter("installer", "installers"), true);
  assertEquals(matchesFilter("image", "documents"), false);
  assertEquals(matchesFilter("other", "all"), true);
  assertEquals(previewable("a.png"), true);
  assertEquals(extTag("backup.tar.gz"), "TAR.GZ");
  assertEquals(extTag("report.PDF"), "PDF");
  assertEquals(extTag("README"), undefined);
});

Deno.test("sections and dates", () => {
  const now = new Date(2026, 9, 28, 15, 0); // Wednesday
  assertEquals(section(new Date(2026, 9, 28, 1), now), "Today");
  assertEquals(section(new Date(2026, 9, 27, 23), now), "Yesterday");
  assertEquals(section(new Date(2026, 9, 23), now), "This Week");
  assertEquals(section(new Date(2026, 9, 21), now), "Older");
  assertEquals(when(new Date(2026, 9, 28, 9, 5), now), "09:05");
  assertEquals(when(new Date(2026, 9, 27, 18, 30), now), "Yesterday 18:30");
  assertEquals(when(new Date(2026, 9, 26, 8), now), "Mon 26 Oct");
  assertEquals(when(new Date(2025, 2, 3), now), "3 Mar 2025");
});

Deno.test("getfattr output", () => {
  const out = `# file: /home/ada/Downloads/report final.pdf
user.xdg.origin.url="https://example.com/files/report%20final.pdf"
user.xdg.referrer.url="https://example.com/reports?id=3"

# file: /home/ada/Downloads/caf\\303\\251.png
user.xdg.origin.url="https://cdn.example.org/caf\\303\\251.png"

# file: /home/ada/Downloads/bin.dat
user.xdg.origin.url=0x68747470733a2f2f612e6f7267
`;
  const attrs = parseGetfattr(out);
  assertEquals(attrs.get("/home/ada/Downloads/report final.pdf"), {
    "user.xdg.origin.url": "https://example.com/files/report%20final.pdf",
    "user.xdg.referrer.url": "https://example.com/reports?id=3",
  });
  assertEquals(attrs.get("/home/ada/Downloads/café.png")?.["user.xdg.origin.url"], "https://cdn.example.org/café.png");
  assertEquals(attrs.get("/home/ada/Downloads/bin.dat")?.["user.xdg.origin.url"], "https://a.org");
});

Deno.test("names, links and uris", () => {
  assertEquals(checkName(""), "Type a name");
  assertEquals(checkName("a/b"), "A name can't contain “/”");
  assertEquals(checkName("ok.txt"), undefined);
  assertEquals(hostOf("https://www.github.com/x"), "github.com");
  assertEquals(hostOf("data:abc"), undefined);
  assertEquals(hostOf(undefined), undefined);
  assertEquals(fileUri("/home/ada/My File#1.pdf"), "file:///home/ada/My%20File%231.pdf");
  const taken = new Set(["report.pdf", "report (2).pdf", "a.tar.gz"]);
  assertEquals(freeName("report.pdf", (n) => taken.has(n)), "report (3).pdf");
  assertEquals(freeName("a.tar.gz", (n) => taken.has(n)), "a (2).tar.gz");
  assertEquals(freeName("new.txt", (n) => taken.has(n)), "new.txt");
});
