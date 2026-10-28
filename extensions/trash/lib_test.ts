import { assertEquals } from "@std/assert";
import {
  daySection,
  decodePath,
  formatBytes,
  kindOf,
  looksLikeText,
  parseDirectorySizes,
  parseTrashInfo,
  previewable,
  restoredName,
  summary,
  when,
} from "./lib.ts";

Deno.test("trashinfo files", () => {
  const info = parseTrashInfo(
    "[Trash Info]\nPath=/home/ada/Documents/Rapport%20final%20%C3%A9t%C3%A9.pdf\nDeletionDate=2026-10-27T14:03:11\n",
  );
  assertEquals(info?.path, "/home/ada/Documents/Rapport final été.pdf");
  assertEquals(info?.deleted, new Date(2026, 9, 27, 14, 3, 11));
  // Relative paths (trash on another drive) and missing dates.
  assertEquals(parseTrashInfo("[Trash Info]\nPath=photos/cat.jpg\n"), { path: "photos/cat.jpg", deleted: undefined });
  assertEquals(parseTrashInfo("Path=/x\n"), undefined);
  assertEquals(decodePath("100%"), "100%");
});

Deno.test("directorysizes cache", () => {
  const sizes = parseDirectorySizes("4096 1729000000 old%20project\n123456789 1729000001 node_modules\nbroken line\n");
  assertEquals(sizes.get("old project"), 4096);
  assertEquals(sizes.get("node_modules"), 123456789);
  assertEquals(sizes.size, 2);
});

Deno.test("kinds and previews", () => {
  assertEquals(kindOf("cat.JPG", false), "image");
  assertEquals(kindOf("notes.md", false), "text");
  assertEquals(kindOf("app.AppImage", false), "archive");
  assertEquals(kindOf("photos", true), "folder");
  assertEquals(kindOf("README", false), "file");
  assertEquals(previewable("a.webp"), true);
  assertEquals(previewable("a.heic"), false);
  assertEquals(looksLikeText(new TextEncoder().encode("hello\nworld\té")), true);
  assertEquals(looksLikeText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1])), false);
});

Deno.test("sections by deletion day", () => {
  const now = new Date(2026, 9, 28, 10, 0); // Wednesday 28 October 2026
  assertEquals(daySection(new Date(2026, 9, 28, 0, 5), now), "Today");
  assertEquals(daySection(new Date(2026, 9, 27, 23, 59), now), "Yesterday");
  assertEquals(daySection(new Date(2026, 9, 26, 9), now), "Monday 26 October");
  assertEquals(daySection(new Date(2026, 8, 3), now), "3 September");
  assertEquals(daySection(new Date(2025, 11, 31), now), "31 December 2025");
  assertEquals(daySection(undefined, now), "Unknown Date");
  assertEquals(when(new Date(2026, 9, 28, 9, 7), now), "09:07");
  assertEquals(when(new Date(2026, 9, 3, 18, 30), now), "3 Oct, 18:30");
});

Deno.test("names and summary", () => {
  assertEquals(restoredName("/home/ada/report.pdf"), "/home/ada/report (restored).pdf");
  assertEquals(restoredName("/home/ada/.bashrc"), "/home/ada/.bashrc (restored)");
  assertEquals(restoredName("/home/ada/photos"), "/home/ada/photos (restored)");
  assertEquals(summary(3, 5 * 1024 * 1024), "3 items · 5.0 MB");
  assertEquals(summary(1, 10), "1 item · 10 B");
  assertEquals(summary(0, 0), "Empty");
  assertEquals(formatBytes(1536), "1.5 KB");
});
