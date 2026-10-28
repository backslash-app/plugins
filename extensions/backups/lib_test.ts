import { assert, assertEquals, assertMatch } from "@std/assert";
import { parse } from "@std/toml";
import {
  ago,
  backgroundScript,
  backupArgs,
  backupFolder,
  borgError,
  dejaDupPath,
  duration,
  expandHome,
  formatBytes,
  freshness,
  hashId,
  isMounted,
  mountScript,
  parseBorgArchiveInfo,
  parseBorgInfo,
  parseBorgList,
  parseBorgTime,
  parseDejaDup,
  parseResticSnapshots,
  parseResticStats,
  type Repo,
  repoLabel,
  resticError,
  restoreCommand,
  secretPrelude,
  splitPaths,
  terminalScript,
  tildify,
  unitName,
} from "./lib.ts";
import { TERMINALS } from "./terminal.ts";

const RESTIC_SNAPSHOTS = `[
  {"time":"2024-03-01T10:00:00.123456789+01:00","tree":"a1","paths":["/home/ada"],"hostname":"laptop",
   "username":"ada","uid":1000,"gid":1000,"excludes":["/home/ada/.cache"],"tags":["daily"],
   "program_version":"restic 0.16.4","id":"4bba301e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e","short_id":"4bba301e"},
  {"time":"2024-03-02T10:00:05.5+01:00","parent":"4bba301e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e",
   "tree":"b2","paths":["/home/ada","/etc"],"hostname":"laptop","username":"ada","tags":null,
   "program_version":"restic 0.17.3",
   "summary":{"backup_start":"2024-03-02T10:00:05.5+01:00","backup_end":"2024-03-02T10:03:35.5+01:00",
     "files_new":12,"files_changed":3,"files_unmodified":40210,"dirs_new":1,"dirs_changed":4,"dirs_unmodified":5000,
     "data_blobs":20,"tree_blobs":6,"data_added":5242880,"data_added_packed":2621440,
     "total_files_processed":40225,"total_bytes_processed":21474836480},
   "id":"9f0e1d2c3b4a59687766554433221100ffeeddccbbaa99887766554433221100","short_id":"9f0e1d2c"}
]`;

const RESTIC_STATS = `{"total_size":53687091200,"total_uncompressed_size":80530636800,"compression_ratio":1.5,
"compression_progress":100,"compression_space_saving":33.3,"total_blob_count":123456,"snapshots_count":42}`;

const BORG_LIST = `{
  "archives": [
    {"archive":"laptop-2024-03-01T10:00:00","barchive":"laptop-2024-03-01T10:00:00","id":"aa11","name":"laptop-2024-03-01T10:00:00","start":"2024-03-01T10:00:00.000000","time":"2024-03-01T10:00:00.000000"},
    {"archive":"laptop-2024-03-03T10:00:00","barchive":"laptop-2024-03-03T10:00:00","id":"bb22","name":"laptop-2024-03-03T10:00:00","start":"2024-03-03T10:00:00.000000","time":"2024-03-03T10:00:00.000000"}
  ],
  "encryption": {"mode": "repokey-blake2"},
  "repository": {"id": "0f1e", "last_modified": "2024-03-03T10:05:00.000000", "location": "/mnt/backup/borg"}
}`;

const BORG_INFO = `{
  "cache": {"path": "/home/ada/.cache/borg/0f1e", "stats": {"total_chunks": 900000, "total_csize": 300000000000,
    "total_size": 400000000000, "total_unique_chunks": 120000, "unique_csize": 42949672960, "unique_size": 64424509440}},
  "encryption": {"mode": "repokey-blake2"},
  "repository": {"id": "0f1e", "last_modified": "2024-03-03T10:05:00.000000", "location": "/mnt/backup/borg"},
  "security_dir": "/home/ada/.config/borg/security/0f1e"
}`;

const BORG_ARCHIVE = `{
  "archives": [{
    "name": "laptop-2024-03-03T10:00:00", "id": "bb22", "hostname": "laptop", "username": "ada",
    "command_line": ["/usr/bin/borg", "create", "::{hostname}-{now}", "/home/ada"], "comment": "",
    "duration": 125.5, "start": "2024-03-03T10:00:00.000000", "end": "2024-03-03T10:02:05.500000",
    "limits": {"max_archive_size": 0.0001},
    "stats": {"compressed_size": 30000000000, "deduplicated_size": 12345678, "nfiles": 40225, "original_size": 40000000000}
  }],
  "encryption": {"mode": "repokey-blake2"}
}`;

const DEJA_DUP = `org.gnome.DejaDup backend 'local'
org.gnome.DejaDup delete-after 0
org.gnome.DejaDup exclude-list ['$TRASH', '$DOWNLOAD', '/home/ada/.cache']
org.gnome.DejaDup include-list ['$HOME', '/etc/nginx']
org.gnome.DejaDup last-backup '2024-03-01T09:12:44.211578Z'
org.gnome.DejaDup last-run '2024-03-04T09:00:00.000000Z'
org.gnome.DejaDup periodic true
org.gnome.DejaDup periodic-period 7
org.gnome.DejaDup prompt-check 'disabled'
org.gnome.DejaDup.Local folder '/run/media/ada/Backup/deja-dup'
org.gnome.DejaDup.Remote folder '$HOSTNAME'
org.gnome.DejaDup.Remote uri ''
`;

const restic: Repo = { kind: "restic", id: "1a2b3c4d", location: "sftp:nas:/srv/restic", password: "s3cret" };
const borg: Repo = { kind: "borg", id: "5e6f7a8b", location: "ssh://ada@nas/./borg" };

Deno.test("restic snapshots: newest first, with summary when restic has one", () => {
  const list = parseResticSnapshots(RESTIC_SNAPSHOTS, "r");
  assertEquals(list.map((s) => s.shortId), ["9f0e1d2c", "4bba301e"]);
  const [last, first] = list;
  assertEquals(last.paths, ["/home/ada", "/etc"]);
  assertEquals(last.tags, []);
  assertEquals(last.summary?.dataAdded, 5242880);
  assertEquals(last.summary?.filesNew, 12);
  assertEquals(last.end! - last.time, 210_000);
  assertEquals(first.summary, undefined);
  assertEquals(first.excludes, ["/home/ada/.cache"]);
  assertEquals(first.time, Date.parse("2024-03-01T09:00:00.123Z"));
  assertEquals(parseResticSnapshots("null", "r"), []);
});

Deno.test("restic stats", () => {
  assertEquals(parseResticStats(RESTIC_STATS), {
    size: 53687091200,
    originalSize: 80530636800,
    compressionRatio: 1.5,
    count: 42,
  });
});

Deno.test("borg list, info and archive info", () => {
  const { archives, encryption } = parseBorgList(BORG_LIST, "b");
  assertEquals(encryption, "repokey-blake2");
  assertEquals(archives.map((a) => a.id), ["laptop-2024-03-03T10:00:00", "laptop-2024-03-01T10:00:00"]);
  assertEquals(archives[0].time, new Date(2024, 2, 3, 10, 0, 0).getTime());
  const info = parseBorgInfo(BORG_INFO);
  assertEquals(info.size, 42949672960);
  assertEquals(info.originalSize, 400000000000);
  assertEquals(info.compressionRatio, 1.5);
  const a = parseBorgArchiveInfo(BORG_ARCHIVE);
  assertEquals(a.files, 40225);
  assertEquals(a.deduplicatedSize, 12345678);
  assertEquals(a.comment, undefined);
  assertEquals(a.end! - a.start!, 125_500);
  assertEquals(parseBorgTime("2024-03-03T10:00:00.000000+01:00"), Date.parse("2024-03-03T09:00:00Z"));
});

Deno.test("Déjà Dup settings", () => {
  const d = parseDejaDup(DEJA_DUP);
  assertEquals(d.backend, "local");
  assertEquals(d.lastBackup, Date.parse("2024-03-01T09:12:44.211Z"));
  assertEquals(d.lastRun, Date.parse("2024-03-04T09:00:00Z"));
  assertEquals(d.periodic, true);
  assertEquals(d.periodDays, 7);
  assertEquals(d.include, ["$HOME", "/etc/nginx"]);
  assertEquals(d.exclude.length, 3);
  assertEquals(d.destination, "/run/media/ada/Backup/deja-dup");
  assertEquals(parseDejaDup("org.gnome.DejaDup last-backup ''").lastBackup, undefined);
  assertEquals(dejaDupPath("$HOME"), "~");
  assertEquals(dejaDupPath("$DOWNLOAD"), "~/Downloads");
  assertEquals(dejaDupPath("$TRASH"), "Trash");
  assertEquals(dejaDupPath("$HOME/Projects"), "~/Projects");
});

Deno.test("errors in words", () => {
  assertMatch(resticError(12, "Fatal: wrong password or no key found"), /refused the password/);
  assertMatch(
    resticError(
      1,
      "Fatal: unable to open config file: stat /x/config: no such file or directory\nIs there a repository at the following location?\n/x",
    ),
    /No restic repository/,
  );
  assertMatch(resticError(11, "unable to create lock in backend: repository is already locked"), /locked/);
  assertEquals(resticError(1, "Fatal: something odd\n"), "Fatal: something odd");
  assertMatch(
    borgError(2, "passphrase supplied in BORG_PASSPHRASE, by BORG_PASSCOMMAND or via BORG_PASSPHRASE_FD is incorrect."),
    /refused the passphrase/,
  );
  assertMatch(borgError(2, "Repository /x does not exist."), /No Borg repository/);
  assertMatch(borgError(2, "Failed to create/acquire the lock /x/lock.exclusive (timeout)."), /locked/);
  assertMatch(borgError(2, "Remote: Host key verification failed."), /known_hosts/);
});

Deno.test("scripts never put the password on a command line", () => {
  const prelude = secretPrelude(restic, "/home/ada/.cache/backslash-backups/.secret-x");
  assert(prelude[0].includes(`RESTIC_PASSWORD="$(cat /home/ada/.cache/backslash-backups/.secret-x)"`));
  assert(prelude[0].includes("rm -f /home/ada/.cache/backslash-backups/.secret-x"));
  assertEquals(prelude[1], "export RESTIC_REPOSITORY=sftp:nas:/srv/restic");
  const term = terminalScript(restic, backupArgs(restic, { paths: ["/home/ada"], interactive: true }), "Backing up…");
  assert(!term.join(" ").includes("s3cret"));
  assert(term[2].includes("restic backup --verbose --exclude-caches --tag backslash /home/ada"));
  assert(term[2].endsWith("read -r _"));
  const bg = backgroundScript(
    borg,
    backupArgs(borg, { paths: ["/home/ada"], interactive: false }),
    "Borg nas",
    "unit-x",
  );
  assert(bg[2].includes("export BORG_REPO=ssh://ada@nas/./borg"));
  assert(bg[2].includes("export BORG_RSH='ssh -o BatchMode=yes'"));
  assert(bg[2].includes("borg create --stats --exclude-caches '::{hostname}-{now:%Y-%m-%dT%H:%M:%S}' /home/ada"));
  assert(bg[2].includes("notify-send -a Backslash -i drive-harddisk 'Backup finished' 'Borg nas'"));
  assert(bg[2].includes("journalctl --user -u unit-x"));
  assertEquals(
    secretPrelude({ ...restic, password: undefined, passwordFile: "/p" })[0],
    "export RESTIC_PASSWORD_FILE=/p",
  );
});

Deno.test("mounts", () => {
  const m = mountScript(restic, "/home/ada/.cache/backslash-backups/mnt/restic-1a2b3c4d");
  assert(m[2].endsWith("exec restic mount --no-lock /home/ada/.cache/backslash-backups/mnt/restic-1a2b3c4d"));
  assert(mountScript(borg, "/m")[2].endsWith("exec borg mount --foreground :: /m"));
  const b = parseResticSnapshots(RESTIC_SNAPSHOTS, "r")[0];
  assertEquals(backupFolder("/m", b, "restic"), "/m/ids/9f0e1d2c");
  assertEquals(backupFolder("/m", parseBorgList(BORG_LIST, "b").archives[0], "borg"), "/m/laptop-2024-03-03T10:00:00");
  const mounts = "resticfs /home/ada/.cache/backslash-backups/mnt/restic-1a2b3c4d fuse.restic ro 0 0\n" +
    "borgfs /home/ada/My\\040Backups fuse rw 0 0";
  assert(isMounted(mounts, "/home/ada/.cache/backslash-backups/mnt/restic-1a2b3c4d"));
  assert(isMounted(mounts, "/home/ada/My Backups"));
  assert(!isMounted(mounts, "/home/ada/.cache/backslash-backups/mnt/borg-5e6f7a8b"));
  assertEquals(unitName("mount", restic), "backslash-mount-restic-1a2b3c4d");
  assertEquals(unitName("backup", borg, 17), "backslash-backup-borg-5e6f7a8b-17");
  assertEquals(
    restoreCommand(restic, b, "/home/ada/Restored"),
    "restic -r sftp:nas:/srv/restic restore 9f0e1d2c --target /home/ada/Restored",
  );
});

Deno.test("helpers", () => {
  assertEquals(hashId("restic:/x"), hashId("restic:/x"));
  assertMatch(hashId("restic:/x"), /^[0-9a-f]{8}$/);
  assert(hashId("restic:/x") !== hashId("restic:/y"));
  assertEquals(splitPaths("~, ~/Documents\n/etc", "/home/ada"), ["/home/ada", "/home/ada/Documents", "/etc"]);
  assertEquals(expandHome("~user", "/home/ada"), "~user");
  assertEquals(tildify("/home/ada/Documents", "/home/ada"), "~/Documents");
  assertEquals(tildify("/home/adam", "/home/ada"), "/home/adam");
  assertEquals(repoLabel("sftp:nas:/srv/restic/"), "restic (sftp)");
  assertEquals(repoLabel("/run/media/ada/Backup/borg"), "borg");
  assertEquals(repoLabel("ssh://ada@nas/./borg"), "borg");
  assertEquals(formatBytes(53687091200), "50.0 GB");
  assertEquals(duration(210_000), "3 min 30 s");
  const now = Date.parse("2024-03-10T12:00:00Z");
  assertEquals(freshness(undefined, 7, now), "never");
  assertEquals(freshness(now - 3 * 86400_000, 7, now), "fresh");
  assertEquals(freshness(now - 8 * 86400_000, 7, now), "stale");
  assertEquals(ago(now - 2 * 86400_000, now), "2 days ago");
});

Deno.test("manifest: programs, commands and preferences", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { run: string[] };
    commands: { name: string; title: string }[];
    preferences: Record<string, unknown>[];
  };
  const run = new Set(manifest.permissions.run);
  for (const p of [...TERMINALS, "restic", "borg", "systemd-run", "systemctl", "gsettings", "flatpak", "deja-dup"]) {
    assert(run.has(p), `${p} is not in run`);
  }
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
  const allowed = new Set(["name", "title", "description", "required", "default", "type"]);
  for (const p of manifest.preferences) {
    for (const k of Object.keys(p)) assert(allowed.has(k), `preference ${p.name}: unknown key ${k}`);
  }
});
