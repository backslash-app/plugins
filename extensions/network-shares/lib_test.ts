import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  displayAddress,
  explain,
  findMount,
  gioCovers,
  kindOf,
  normalizeAddress,
  parseGioMounts,
  parseLocalPath,
  parseMounts,
  parseUri,
  pendingQuestion,
  type Share,
  slug,
  sshfsArgs,
  suggestName,
  systemKind,
  systemUri,
  unescapeMount,
  userMountable,
  withUser,
} from "./lib.ts";
import { TERMINALS } from "./terminal.ts";

Deno.test("addresses as people paste them", () => {
  assertEquals(normalizeAddress("smb://nas.local/public"), "smb://nas.local/public");
  assertEquals(normalizeAddress("  SMB://nas.local//public/photos "), "smb://nas.local/public/photos");
  assertEquals(normalizeAddress("\\\\NAS\\Public\\Photos"), "smb://NAS/Public/Photos");
  assertEquals(normalizeAddress("cifs://nas/share"), "smb://nas/share");
  assertEquals(normalizeAddress("ada@server.example.com:/srv/data"), "sftp://ada@server.example.com/srv/data");
  assertEquals(normalizeAddress("ada@server:projects"), "sftp://ada@server/~/projects");
  assertEquals(normalizeAddress("ada@server:"), "sftp://ada@server/");
  assertEquals(normalizeAddress("nas.lan:/volume1/media"), "nfs://nas.lan/volume1/media");
  assertEquals(normalizeAddress("ssh://ada@host:2222/home/ada"), "sftp://ada@host:2222/home/ada");
  assertEquals(
    normalizeAddress("https://cloud.example.com/remote.php/dav/files/ada/"),
    "davs://cloud.example.com/remote.php/dav/files/ada/",
  );
  assertEquals(normalizeAddress("http://192.168.1.5:8080/webdav"), "dav://192.168.1.5:8080/webdav");
  assertEquals(normalizeAddress("nfs://nas"), "nfs://nas/");
  assertThrows(() => normalizeAddress(""), Error, "Type the address");
  assertThrows(() => normalizeAddress("ftp://x.org/pub"), Error, "isn't supported");
  assertThrows(() => normalizeAddress("nas.local"), Error, "not a share address");
  assertThrows(() => normalizeAddress("smb:///share"), Error, "no server");
});

Deno.test("URI parts, users and domains", () => {
  assertEquals(parseUri("smb://WORKGROUP;ada@NAS.local:445/public/My%20Photos"), {
    scheme: "smb",
    user: "ada",
    domain: "WORKGROUP",
    host: "nas.local",
    port: 445,
    path: "/public/My Photos",
  });
  assertEquals(parseUri("sftp://[fe80::1]:22/").host, "[fe80::1]");
  assertEquals(
    withUser("smb://nas/public/My Photos", "ada lovelace", "HOME"),
    "smb://HOME;ada%20lovelace@nas/public/My%20Photos",
  );
  assertEquals(withUser("davs://cloud/dav", "ada@example.com"), "davs://ada%40example.com@cloud/dav");
  assertEquals(withUser("smb://nas/x", undefined), "smb://nas/x");
  assertEquals(kindOf("davs://cloud/dav"), "WebDAV");
  assertEquals(displayAddress("smb://ada@nas.local/public/"), "nas.local/public");
  assertEquals(displayAddress("sftp://host:2222/"), "host:2222");
  assertEquals(suggestName("smb://nas.local/public/"), "public on nas.local");
  assertEquals(suggestName("sftp://ada@host/~/"), "host");
  assertEquals(slug("Photos (NAS) — été"), "photos-nas-ete");
});

Deno.test("sshfs arguments", () => {
  assertEquals(sshfsArgs("sftp://ada@server:2222/srv/data", "/home/ada/mnt/data"), [
    "ada@server:/srv/data",
    "/home/ada/mnt/data",
    "-o",
    "reconnect,ServerAliveInterval=15,ServerAliveCountMax=3",
    "-p",
    "2222",
  ]);
  assertEquals(sshfsArgs("sftp://server/~/projects", "/m")[0], "server:projects");
  assertThrows(() => sshfsArgs("smb://nas/x", "/m"), Error, "SSH addresses only");
});

// gio mount -l, GLib 2.80, with a USB drive, a Samba share, an SFTP host and a Nextcloud
const GIO = `Drive(0): Samsung SSD 980 PRO 1TB
  Type: GProxyDrive (GProxyVolumeMonitorUDisks2)
Drive(1): SanDisk Ultra
  Type: GProxyDrive (GProxyVolumeMonitorUDisks2)
  Volume(0): KEY
    Type: GProxyVolume (GProxyVolumeMonitorUDisks2)
    Mount(0): KEY -> file:///run/media/ada/KEY
      Type: GProxyMount (GProxyVolumeMonitorUDisks2)
Mount(0): public on nas.local -> smb://nas.local/public/
  Type: GDaemonMount
Mount(1): ada on server.example.com -> sftp://ada@server.example.com/
  Type: GDaemonMount
Mount(2): WebDAV on cloud.example.com -> davs://ada@cloud.example.com/remote.php/dav/files/ada
  Type: GDaemonMount
`;

Deno.test("gio mount -l: network mounts only", () => {
  assertEquals(parseGioMounts(GIO), [
    { name: "public on nas.local", uri: "smb://nas.local/public/" },
    { name: "ada on server.example.com", uri: "sftp://ada@server.example.com/" },
    { name: "WebDAV on cloud.example.com", uri: "davs://ada@cloud.example.com/remote.php/dav/files/ada" },
  ]);
  assertEquals(parseGioMounts(""), []);
});

Deno.test("which gio mount covers a share", () => {
  const [smb, sftp, dav] = parseGioMounts(GIO);
  assert(gioCovers(smb, "smb://NAS.local/Public/photos"));
  assert(gioCovers(smb, "smb://ada@nas.local:445/public"));
  assert(!gioCovers(smb, "smb://nas.local/private"));
  assert(gioCovers(sftp, "sftp://ada@server.example.com/srv/data"));
  assert(!gioCovers(sftp, "sftp://bob@server.example.com/"));
  assert(!gioCovers(sftp, "sftp://ada@server.example.com:2222/"));
  assert(gioCovers(dav, "davs://cloud.example.com/remote.php/dav/files/ada/Documents"));
  assert(!gioCovers(dav, "davs://cloud.example.com/remote.php/dav/files/adam"));
  assert(!gioCovers(dav, "dav://cloud.example.com/remote.php/dav/files/ada"));
});

const PROC = `sysfs /sys sysfs rw,nosuid,nodev,noexec,relatime 0 0
/dev/nvme0n1p2 / btrfs rw,relatime,ssd,space_cache=v2,subvol=/@ 0 0
gvfsd-fuse /run/user/1000/gvfs fuse.gvfsd-fuse rw,nosuid,nodev,relatime,user_id=1000,group_id=1000 0 0
nas.lan:/volume1/media /mnt/media nfs4 rw,relatime,vers=4.2,rsize=131072,wsize=131072,hard,proto=tcp 0 0
//nas.lan/backups /mnt/nas\\040backups cifs rw,relatime,vers=3.1.1,cache=strict,username=ada 0 0
ada@server.example.com:/srv/data /home/ada/mnt/data fuse.sshfs rw,nosuid,nodev,relatime,user_id=1000 0 0
https://cloud.example.com/remote.php/dav/files/ada/ /home/ada/cloud fuse rw,nosuid,nodev,relatime,user_id=1000 0 0
`;

Deno.test("/proc/mounts: network file systems, escapes", () => {
  const m = parseMounts(PROC);
  assertEquals(m.map((x) => [x.fstype, x.target]), [
    ["nfs4", "/mnt/media"],
    ["cifs", "/mnt/nas backups"],
    ["fuse.sshfs", "/home/ada/mnt/data"],
    ["davfs", "/home/ada/cloud"],
  ]);
  assertEquals(m.map(systemKind), ["NFS", "SMB", "SFTP", "WebDAV"]);
  assertEquals(m.map(systemUri), [
    "nfs://nas.lan/volume1/media",
    "smb://nas.lan/backups",
    "sftp://ada@server.example.com/srv/data",
    "davs://cloud.example.com/remote.php/dav/files/ada/",
  ]);
  assertEquals(unescapeMount("a\\040b\\011c"), "a b\tc");
});

Deno.test("fstab lines a user may mount", () => {
  const tab = parseMounts(`# <file system> <mount point> <type> <options> <dump> <pass>
UUID=1234 / ext4 defaults 0 1
nas.lan:/volume1/media  /mnt/media  nfs  noauto,user,_netdev  0 0
//nas.lan/private /mnt/private cifs credentials=/root/.smb,noauto 0 0
`);
  assertEquals(tab.length, 2);
  assert(userMountable(tab[0]));
  assert(!userMountable(tab[1]));
});

Deno.test("saved shares find their mount", () => {
  const gio = parseGioMounts(GIO);
  const system = parseMounts(PROC);
  const share = (s: Partial<Share>): Share => ({
    id: "x",
    name: "x",
    uri: "smb://nas.local/public",
    method: "gio",
    ...s,
  });
  assertEquals(findMount(share({}), gio, system), {
    root: "smb://nas.local/public/",
    location: "smb://nas.local/public",
  });
  assertEquals(findMount(share({ uri: "smb://nas.local/other" }), gio, system), undefined);
  assertEquals(
    findMount(
      share({ uri: "sftp://ada@server.example.com/srv/data", method: "sshfs", mountpoint: "/home/ada/mnt/data/" }),
      gio,
      system,
    ),
    { location: "/home/ada/mnt/data" },
  );
  assertEquals(findMount(share({ method: "fstab", mountpoint: "/mnt/elsewhere" }), gio, system), undefined);
});

Deno.test("gio's questions and its local path", () => {
  assertEquals(
    pendingQuestion(
      "Authentication Required\nEnter user and password for share “public” on “nas.local”:\nUser [ada]: ",
    ),
    "user",
  );
  assertEquals(pendingQuestion("User [ada]: \nDomain [WORKGROUP]: "), "domain");
  assertEquals(pendingQuestion("Domain [WORKGROUP]: \nPassword: "), "password");
  assertEquals(pendingQuestion("Enter password for ada@server:\nPassword:"), "password");
  assertEquals(pendingQuestion("Mounted.\n"), undefined);
  assertEquals(
    parseLocalPath(`display name: public on nas.local
edit name: public on nas.local
name: /
type: directory
size:  0
uri: smb://nas.local/public/
local path: /run/user/1000/gvfs/smb-share:server=nas.local,share=public
attributes:
  standard::name: /`),
    "/run/user/1000/gvfs/smb-share:server=nas.local,share=public",
  );
  assertEquals(parseLocalPath("uri: smb://x/"), undefined);
});

Deno.test("errors said for people", () => {
  assertEquals(
    explain("gio exited with 2: gio: smb://nas/x/: Failed to mount Windows share: Permission denied"),
    "The server refused the user name or password",
  );
  assertEquals(explain("gio: smb://nas/: Location is already mounted"), "Already mounted");
  assertEquals(
    explain("read: Connection reset by peer\nHost key verification failed."),
    "The server's SSH key isn't known yet: mount it once in a terminal (Ctrl+T) to accept it",
  );
  assertEquals(
    explain("mount: /mnt/media: must be superuser to use mount."),
    "Only root can mount it: add the user option to its /etc/fstab line, or mount it with gio",
  );
  assertEquals(
    explain("umount: /mnt/media: target is busy."),
    "It is in use: close the files and terminals open in it, then unmount again",
  );
  assertEquals(
    explain("gio: nfs://nas/x: The specified location is not supported"),
    "GVfs can't mount this share here: install gvfs-backends (Debian, Ubuntu) or gvfs-smb / gvfs-nfs / gvfs-goa",
  );
  assertEquals(
    explain("gio: smb://127.0.0.1/x: volume doesn’t implement mount", "SMB"),
    "GVfs can't mount SMB shares here: install gvfs-backends (Debian, Ubuntu) or gvfs-smb / gvfs-nfs / gvfs-goa",
  );
  assertEquals(explain("something odd\nlast line"), "last line");
});

Deno.test("manifest lists every terminal", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { run: string[] };
  };
  for (const t of TERMINALS) assert(manifest.permissions.run.includes(t), t);
});
