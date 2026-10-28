import { assertEquals } from "@std/assert";
import {
  ago,
  bar,
  biggest,
  cacheOwner,
  childrenOf,
  formatBytes,
  packageCache,
  parseDf,
  parseDu,
  parseFindLine,
  parseHumanSize,
  parseJournalUsage,
  parseSystemDf,
  rootSize,
  safeCache,
  shareColor,
  tilde,
  topFolders,
} from "./lib.ts";
import { shellLine, terminalArgs } from "./terminal.ts";

// `du -x -d 2 -b /home/ada`, as du prints it: children before parents.
const DU = `4096\t/home/ada/.cache/fontconfig
1288490188\t/home/ada/.cache/mozilla
524288000\t/home/ada/.cache/pip
1813512284\t/home/ada/.cache
8589934592\t/home/ada/.local/share
120000\t/home/ada/.local/state
8590054592\t/home/ada/.local
21474836480\t/home/ada/Videos/Holidays
22548578304\t/home/ada/Videos
3221225472\t/home/ada/Downloads
36173373992\t/home/ada
`;

Deno.test("du output", () => {
  const entries = parseDu(DU);
  assertEquals(entries.length, 11);
  assertEquals(topFolders(entries, "/home/ada").map((e) => e.path), [
    "/home/ada/Videos",
    "/home/ada/.local",
    "/home/ada/Downloads",
    "/home/ada/.cache",
  ]);
  assertEquals(childrenOf(entries, "/home/ada/.cache").map((e) => e.path), [
    "/home/ada/.cache/mozilla",
    "/home/ada/.cache/pip",
    "/home/ada/.cache/fontconfig",
  ]);
  assertEquals(rootSize(entries, "/home/ada"), 36173373992);
  // While scanning, before du prints the root: the sum of what is known.
  assertEquals(rootSize(entries.slice(0, 4), "/home/ada"), 1813512284);
  // A tab in a file name stays in the path.
  assertEquals(parseDu("12\t/home/ada/a\tb\n")[0].path, "/home/ada/a\tb");
});

Deno.test("df, journal and container usage", () => {
  assertEquals(
    parseDf("   1B-blocks         Used        Avail Mounted on\n510770802688 312345067520 172421853184 /home\n"),
    { size: 510770802688, used: 312345067520, available: 172421853184, mount: "/home" },
  );
  assertEquals(parseDf(""), undefined);
  assertEquals(
    parseJournalUsage("Archived and active journals take up 1.2G in the file system."),
    Math.round(1.2 * 1024 ** 3),
  );
  assertEquals(parseJournalUsage("Archived and active journals take up 24.0M in the file system."), 24 * 1024 ** 2);
  assertEquals(parseJournalUsage("No journal files were found."), undefined);
  assertEquals(parseHumanSize("2.5GB"), 2_500_000_000);
  assertEquals(parseHumanSize("0B"), 0);
  const df = parseSystemDf(
    [
      '{"Active":"3","Reclaimable":"4.1GB (61%)","Size":"6.72GB","TotalCount":"12","Type":"Images"}',
      '{"Active":"2","Reclaimable":"0B (0%)","Size":"12.3MB","TotalCount":"4","Type":"Containers"}',
      '{"Active":"1","Reclaimable":"55MB","Size":"310MB","TotalCount":"3","Type":"Local Volumes"}',
      '{"Active":"0","Reclaimable":"1.2GB","Size":"1.2GB","TotalCount":"40","Type":"Build Cache"}',
    ].join("\n"),
  );
  assertEquals(df[0], { type: "Images", total: 12, active: 3, size: 6_720_000_000, reclaimable: 4_100_000_000 });
  assertEquals(df.reduce((s, u) => s + u.reclaimable, 0), 5_355_000_000);
});

Deno.test("big files from find", () => {
  const a = parseFindLine("4294967296\t1729000000.1234567890\t/home/ada/VMs/win11.qcow2")!;
  assertEquals(a, { size: 4294967296, modified: 1729000000123, path: "/home/ada/VMs/win11.qcow2" });
  assertEquals(parseFindLine("garbage"), undefined);
  const files = [a, { ...a, size: 1, path: "/x" }, a, { ...a, size: 9e9, path: "/y" }];
  assertEquals(biggest(files).map((f) => f.path), ["/y", "/home/ada/VMs/win11.qcow2", "/x"]);
});

Deno.test("caches and package caches", () => {
  assertEquals(cacheOwner("mozilla"), "Firefox");
  assertEquals(cacheOwner("something"), undefined);
  assertEquals(safeCache("pip"), true);
  assertEquals(safeCache("huggingface"), false);
  assertEquals(packageCache("arch")?.path, "/var/cache/pacman/pkg");
  assertEquals(packageCache("debian")?.clean, ["sudo", "apt-get", "clean"]);
  assertEquals(packageCache(undefined), undefined);
});

Deno.test("formatting", () => {
  assertEquals(formatBytes(1813512284), "1.7 GB");
  assertEquals(formatBytes(512), "512 B");
  assertEquals(tilde("/home/ada/Videos", "/home/ada"), "~/Videos");
  assertEquals(bar(0.25, 8), "▓▓░░░░░░");
  assertEquals(shareColor(0.3), "red");
  assertEquals(shareColor(0.01), "blue");
  const now = Date.UTC(2026, 9, 28);
  assertEquals(ago(now - 3 * 86400000, now), "3 days ago");
  assertEquals(ago(now - 70 * 86400000, now), "2 months ago");
  assertEquals(ago(now - 800 * 86400000, now), "2 years ago");
});

Deno.test("terminal command lines", () => {
  assertEquals(terminalArgs("kitty", ["sh", "-c", "x"]), ["sh", "-c", "x"]);
  assertEquals(terminalArgs("gnome-terminal", ["sh"]), ["--", "sh"]);
  assertEquals(shellLine(["sudo", "journalctl", "--vacuum-size=200M"]), "sudo journalctl --vacuum-size=200M");
  assertEquals(shellLine(["echo", "it's"]), `echo 'it'\\''s'`);
});
