import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import { HOSTS, installCommand, isAllowedHost, normalizeUrl } from "./api.ts";
import {
  ago,
  baseFromGui,
  bytes,
  conflictFindArgs,
  deviceState,
  type DeviceView,
  expandHome,
  folderState,
  type FolderStatus,
  type FolderView,
  parseConfigXml,
  parseConflictName,
  parseConflicts,
  percent,
  sortFolders,
  summary,
  tildify,
} from "./lib.ts";

const CONFIG = `<configuration version="37">
    <folder id="default" label="Default Folder" path="/home/me/Sync" type="sendreceive"></folder>
    <device id="ABCDEF7-..." name="laptop" compression="metadata"></device>
    <gui enabled="true" tls="false" debugging="false" sendBasicAuthPrompt="false">
        <address>127.0.0.1:8384</address>
        <apikey>kGvR3m9yQx&amp;2</apikey>
        <theme>default</theme>
    </gui>
    <options><listenAddress>default</listenAddress></options>
</configuration>`;

const status = (o: Partial<FolderStatus> = {}): FolderStatus => ({
  state: "idle",
  globalBytes: 1_000_000,
  globalFiles: 10,
  localBytes: 1_000_000,
  localFiles: 10,
  inSyncBytes: 1_000_000,
  needBytes: 0,
  needFiles: 0,
  errors: 0,
  pullErrors: 0,
  ...o,
});

const folder = (id: string, s?: FolderStatus, paused = false): FolderView => ({
  config: { id, label: id[0].toUpperCase() + id.slice(1), path: `~/${id}`, type: "sendreceive", paused, devices: [] },
  status: s,
});

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(isAllowedHost("127.0.0.1"));
  assert(isAllowedHost("nas.local"));
  assert(isAllowedHost("192.168.1.10"));
  assert(!isAllowedHost("example.com"));
  assert(!isAllowedHost("8.8.8.8"));
});

Deno.test("addresses", () => {
  assertEquals(normalizeUrl("localhost:8384/"), "http://localhost:8384");
  assertEquals(normalizeUrl("https://nas.local:8384/#settings"), "https://nas.local:8384");
  assertEquals(normalizeUrl(""), "");
});

Deno.test("config.xml", () => {
  const gui = parseConfigXml(CONFIG);
  assertEquals(gui, { apiKey: "kGvR3m9yQx&2", address: "127.0.0.1:8384", tls: false });
  assertEquals(baseFromGui(gui), "http://127.0.0.1:8384");
  assertEquals(baseFromGui({ address: "0.0.0.0:8384", tls: true }), "https://127.0.0.1:8384");
  assertEquals(baseFromGui({ address: "/run/user/1000/st.sock", tls: false }), undefined);
  assertEquals(parseConfigXml("<configuration/>"), { tls: false });
});

Deno.test("formatting", () => {
  assertEquals(bytes(0), "0 B");
  assertEquals(bytes(1_500), "1.5 KB");
  assertEquals(bytes(12_345_678_901), "12.3 GB");
  assertEquals(percent(0.999), "99 %");
  assertEquals(percent(1), "100 %");
  const now = Date.parse("2026-10-28T12:00:00Z");
  assertEquals(ago("2026-10-28T11:50:00Z", now), "10 min ago");
  assertEquals(ago("2026-10-26T12:00:00Z", now), "2 days ago");
  assertEquals(ago("1970-01-01T00:00:00Z", now), "never");
  assertEquals(ago("0001-01-01T00:00:00Z", now), "never");
  assertEquals(expandHome("~/Sync", "/home/me"), "/home/me/Sync");
  assertEquals(tildify("/home/me/Sync", "/home/me"), "~/Sync");
});

Deno.test("folder states", () => {
  assertEquals(folderState(folder("docs", status())).label, "Up to Date");
  const syncing = folderState(folder("docs", status({ state: "syncing", inSyncBytes: 420_000, needBytes: 580_000 })));
  assertEquals(syncing.label, "Syncing 42 %");
  assertEquals(syncing.progress, 0.42);
  assertEquals(folderState(folder("docs", status({ state: "error", error: "folder marker missing" }))).tint, "red");
  assertEquals(folderState(folder("docs", status({ pullErrors: 3 }))).label, "3 failed items");
  assertEquals(folderState(folder("docs", status(), true)).label, "Paused");
  assertEquals(folderState(folder("docs", status({ state: "scan-waiting" }))).label, "Waiting to scan");
});

Deno.test("root subtitle", () => {
  assertEquals(summary([]), null);
  assertEquals(summary([folder("a", status()), folder("b", status())]), "Up to date");
  assertEquals(
    summary([
      folder("a", status({ state: "syncing", globalBytes: 1000, inSyncBytes: 300 })),
      folder("b", status({ state: "syncing", globalBytes: 1000, inSyncBytes: 540 })),
      folder("c", status()),
    ]),
    "Syncing 42 %",
  );
  assertEquals(summary([folder("a", status({ state: "error" })), folder("b", status())]), "1 folder with errors");
  assertEquals(summary([folder("a", undefined, true)]), "Paused");
});

Deno.test("folders needing attention come first", () => {
  const sorted = sortFolders([
    folder("music", status(), true),
    folder("photos", status()),
    folder("docs", status({ state: "error" })),
    folder("code", status({ state: "syncing", inSyncBytes: 10 })),
  ]);
  assertEquals(sorted.map((f) => f.config.id), ["docs", "code", "photos", "music"]);
});

Deno.test("device states", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  const base: DeviceView = { config: { deviceID: "PHONE12-XYZ", name: "Pixel", paused: false } };
  assertEquals(deviceState({ ...base, lastSeen: "2026-10-28T09:00:00Z" }, now).detail, "Last seen 3 h ago");
  assertEquals(deviceState(base, now).detail, "Never seen");
  assertEquals(
    deviceState({
      ...base,
      connection: { connected: true, paused: false },
      completion: { completion: 87.5, globalBytes: 100, needBytes: 12 },
    }, now).label,
    "Syncing 87 %",
  );
  assertEquals(
    deviceState({
      ...base,
      connection: { connected: true, paused: false },
      completion: { completion: 100, globalBytes: 1, needBytes: 0 },
    }, now)
      .label,
    "Up to Date",
  );
  assertEquals(deviceState({ ...base, config: { ...base.config, paused: true } }, now).label, "Paused");
});

Deno.test("conflict copies", () => {
  const parsed = parseConflictName("/home/me/Sync/Taxes/2026.sync-conflict-20261020-101530-PHONE12.ods");
  assertEquals(parsed?.original, "/home/me/Sync/Taxes/2026.ods");
  assertEquals(parsed?.device, "PHONE12");
  assertEquals(parsed?.date?.getMonth(), 9);
  assertEquals(parseConflictName("/x/Makefile.sync-conflict-20261020-101530-ABCDEF7")?.original, "/x/Makefile");
  assertEquals(parseConflictName("/x/notes.txt"), undefined);

  const out = [
    "1792483200.5\t2048\t/home/me/Sync/a.sync-conflict-20260101-000000-AAAAAAA.md",
    "1792569600.0\t10\t/home/me/Sync/b.sync-conflict-20260102-000000-BBBBBBB.md",
    "1792569600.0\t10\t/home/me/Sync/not-a-conflict.md",
    "",
  ].join("\n");
  const conflicts = parseConflicts(out);
  assertEquals(conflicts.map((c) => c.original), ["/home/me/Sync/b.md", "/home/me/Sync/a.md"]);
  assertEquals(conflicts[1].size, 2048);
  assert(conflictFindArgs("/home/me/Sync").includes("*.sync-conflict-*"));
  assertEquals(conflictFindArgs("/home/me/Sync")[0], "/home/me/Sync");
});

Deno.test("install hints", () => {
  assertEquals(installCommand("ID=fedora\nVERSION_ID=41"), "sudo dnf install syncthing");
  assertEquals(installCommand("ID=ubuntu\nID_LIKE=debian"), "sudo apt install syncthing");
  assertEquals(installCommand('ID="endeavouros"\nID_LIKE=arch'), "sudo pacman -S syncthing");
  assertEquals(installCommand('ID="opensuse-tumbleweed"'), "sudo zypper install syncthing");
});
