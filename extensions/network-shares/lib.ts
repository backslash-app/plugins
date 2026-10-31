// Share addresses, gio and /proc/mounts output, and matching saved shares to
// what is mounted. No I/O here.

export type Method = "gio" | "sshfs" | "fstab";

export interface Share {
  id: string;
  name: string;
  /** smb://, nfs://, sftp://, dav:// or davs://, as normalizeAddress makes it. */
  uri: string;
  method: Method;
  /** sshfs and fstab: where it is mounted. */
  mountpoint?: string;
  lastMounted?: number;
}

export type Kind = "SMB" | "NFS" | "SFTP" | "WebDAV";

export const KIND_OF_SCHEME: Record<string, Kind> = {
  smb: "SMB",
  nfs: "NFS",
  sftp: "SFTP",
  dav: "WebDAV",
  davs: "WebDAV",
};

export const DEFAULT_PORT: Record<string, number> = { smb: 445, nfs: 2049, sftp: 22, dav: 80, davs: 443 };

/**
 * What users paste, turned into the URI gio understands:
 * `smb://nas/share`, `\\nas\share`, `cifs://…` → smb://;
 * `ssh://`, `sftp://`, `user@host:/path` → sftp://;
 * `http(s)://`, `webdav(s)://` → dav(s)://; `nas:/export` and `nfs://` → nfs://.
 */
export function normalizeAddress(text: string): string {
  let t = text.trim();
  if (!t) throw new Error("Type the address of the share, like smb://nas.local/public");
  // Windows UNC path
  const unc = /^\\\\([^\\]+)\\?(.*)$/.exec(t);
  if (unc) t = `smb://${unc[1]}/${unc[2].replace(/\\/g, "/")}`;
  // scp-like user@host:path (SSH) and host:/export (NFS)
  const scp = /^(?:([^@/\s]+)@)?([\w.-]+|\[[0-9a-f:]+\]):(\/?[^/].*|\/?)$/i.exec(t);
  if (scp && !/^[a-z][\w+.-]*:\/\//i.test(t)) {
    const [, user, host, path] = scp;
    if (user || !path.startsWith("/")) {
      const p = path.startsWith("/") ? path : path ? `/~/${path}` : "/";
      t = `sftp://${user ? `${user}@` : ""}${host}${p}`;
    } else t = `nfs://${host}${path}`;
  }
  const m = /^([a-z][\w+.-]*):\/\/(.*)$/i.exec(t);
  if (!m) throw new Error(`“${text.trim()}” is not a share address: try smb://nas.local/public or ada@server:/srv`);
  let scheme = m[1].toLowerCase();
  scheme = ({ cifs: "smb", ssh: "sftp", http: "dav", https: "davs", webdav: "dav", webdavs: "davs" } as Record<
    string,
    string
  >)[scheme] ?? scheme;
  if (!KIND_OF_SCHEME[scheme]) {
    throw new Error(`${m[1]}:// isn't supported: use smb://, nfs://, sftp:// (SSH) or dav(s):// (WebDAV)`);
  }
  const rest = m[2];
  const slash = rest.indexOf("/");
  const authority = slash < 0 ? rest : rest.slice(0, slash);
  const path = slash < 0 ? "/" : rest.slice(slash).replace(/\/{2,}/g, "/");
  if (!authority || /^[@:;]|@$/.test(authority)) throw new Error(`“${text.trim()}” has no server name`);
  return `${scheme}://${authority}${path}`;
}

export interface Parts {
  scheme: string;
  user?: string;
  domain?: string;
  host: string;
  port?: number;
  path: string;
}

/** smb://WORKGROUP;ada@nas.local:445/public/photos → its parts (user and domain decoded). */
export function parseUri(uri: string): Parts {
  const m = /^([a-z]+):\/\/([^/]*)(\/.*)?$/i.exec(uri);
  if (!m) throw new Error(`Not a share address: ${uri}`);
  const [, scheme, authority, path = "/"] = m;
  const at = authority.lastIndexOf("@");
  const userinfo = at >= 0 ? authority.slice(0, at) : "";
  const hostport = at >= 0 ? authority.slice(at + 1) : authority;
  const hp = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(hostport);
  let user: string | undefined = userinfo ? decodeURIComponent(userinfo.replace(/:.*$/, "")) : undefined;
  let domain: string | undefined;
  if (user?.includes(";")) [domain, user] = user.split(";", 2);
  return {
    scheme: scheme.toLowerCase(),
    user: user || undefined,
    domain: domain || undefined,
    host: (hp?.[1] ?? hostport).toLowerCase(),
    port: hp?.[2] ? Number(hp[2]) : undefined,
    path: decodeURIComponentSafe(path),
  };
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export const kindOf = (uri: string): Kind => KIND_OF_SCHEME[parseUri(uri).scheme] ?? "SMB";

/** The address without the user, for display: `nas.local/public`. */
export function displayAddress(uri: string): string {
  const p = parseUri(uri);
  return `${p.host}${p.port ? `:${p.port}` : ""}${p.path === "/" ? "" : p.path.replace(/\/$/, "")}`;
}

/** The URI with a user (and SMB domain), for gio to ask only what is missing. */
export function withUser(uri: string, user?: string, domain?: string): string {
  if (!user) return uri;
  const p = parseUri(uri);
  const enc = encodeURIComponent;
  const info = `${p.scheme === "smb" && domain ? `${enc(domain)};` : ""}${enc(user)}@`;
  const port = p.port ? `:${p.port}` : "";
  return `${p.scheme}://${info}${p.host}${port}${p.path.split("/").map(encodeURIComponent).join("/")}`;
}

/** sshfs needs `user@host:/path` and the port apart. */
export function sshfsArgs(uri: string, mountpoint: string): string[] {
  const p = parseUri(uri);
  if (p.scheme !== "sftp") throw new Error("sshfs mounts SSH addresses only (sftp:// or user@host:/path)");
  const path = p.path.startsWith("/~/") ? p.path.slice(3) : p.path === "/~" ? "" : p.path;
  return [
    `${p.user ? `${p.user}@` : ""}${p.host}:${path}`,
    mountpoint,
    "-o",
    "reconnect,ServerAliveInterval=15,ServerAliveCountMax=3",
    ...(p.port ? ["-p", String(p.port)] : []),
  ];
}

/** "Photos (NAS)" → "photos-nas", for a default mount point. */
export function slug(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "share";
}

/** A name for a new share from its address: the share or last folder, else the host. */
export function suggestName(uri: string): string {
  const p = parseUri(uri);
  const last = p.path.split("/").filter((s) => s && s !== "~").pop();
  return last ? `${last} on ${p.host}` : p.host;
}

// ---------------------------------------------------------------------------
// What is mounted

export interface GioMount {
  name: string;
  uri: string;
}

/**
 * `gio mount -l`: the lines `Mount(0): public on nas.local -> smb://nas.local/public/`
 * (drives and volumes are other lines, indented or not).
 */
export function parseGioMounts(text: string): GioMount[] {
  const out: GioMount[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*Mount\(\d+\):\s*(.*?)\s*->\s*(\S+)\s*$/.exec(line);
    if (!m) continue;
    const scheme = m[2].split(":")[0].toLowerCase();
    if (KIND_OF_SCHEME[scheme]) out.push({ name: m[1], uri: m[2] });
  }
  return out;
}

export interface SystemMount {
  source: string;
  target: string;
  fstype: string;
  options: string[];
}

const NETWORK_FS = /^(nfs4?|cifs|smb3|smbfs|fuse\.sshfs|sshfs|davfs|fuse\.davfs2?|fuse\.rclone|afpfs|fuse\.afpfs)$/;

/** \040 → space, as /proc/mounts and fstab write them. */
export const unescapeMount = (s: string) => s.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));

/** The network file systems of `/proc/mounts` or `/etc/fstab`. */
export function parseMounts(text: string): SystemMount[] {
  return text.split("\n").flatMap((line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return [];
    const [source, target, fstype, options = ""] = t.split(/\s+/);
    if (!source || !target || !fstype) return [];
    const davfs = fstype === "fuse" && /^https?:\/\//.test(source);
    if (!NETWORK_FS.test(fstype) && !davfs) return [];
    return [{
      source: unescapeMount(source),
      target: unescapeMount(target),
      fstype: davfs ? "davfs" : fstype,
      options: options.split(","),
    }];
  });
}

/** What a system mount is, in the same words as shares. */
export function systemKind(m: SystemMount): Kind {
  if (m.fstype.startsWith("nfs")) return "NFS";
  if (/cifs|smb/.test(m.fstype)) return "SMB";
  if (/sshfs/.test(m.fstype)) return "SFTP";
  if (/davfs/.test(m.fstype)) return "WebDAV";
  return "SMB";
}

/** A system mount's source as a share address: //nas/share → smb://nas/share, host:/x → nfs://host/x… */
export function systemUri(m: SystemMount): string | undefined {
  try {
    if (/^\/\//.test(m.source)) return normalizeAddress(`smb:${m.source}`);
    if (m.fstype === "davfs") return normalizeAddress(m.source);
    if (/sshfs/.test(m.fstype)) {
      const s = /^(?:([^@]+)@)?([^:]+):(.*)$/.exec(m.source);
      if (!s) return undefined;
      const path = s[3].startsWith("/") ? s[3] : s[3] ? `/~/${s[3]}` : "/";
      return normalizeAddress(`sftp://${s[1] ? `${s[1]}@` : ""}${s[2]}${path}`);
    }
    if (m.fstype.startsWith("nfs")) return normalizeAddress(`nfs://${m.source.replace(/:(?=\/)/, "")}`);
  } catch {
    // Unusual source: shown as is.
  }
  return undefined;
}

/** fstab entries a user may mount themselves (`user`, `users` or `owner`). */
export const userMountable = (m: SystemMount) => m.options.some((o) => o === "user" || o === "users" || o === "owner");

const trimSlash = (s: string) => s.replace(/\/+$/, "") || "/";

/**
 * Whether a gio mount covers this share. SFTP mounts the whole host; SMB a
 * share (first folder); WebDAV and NFS a folder and what is below.
 */
export function gioCovers(mount: GioMount, uri: string): boolean {
  let a: Parts, b: Parts;
  try {
    a = parseUri(mount.uri);
    b = parseUri(uri);
  } catch {
    return false;
  }
  if (a.scheme !== b.scheme || a.host !== b.host) return false;
  if ((a.port ?? DEFAULT_PORT[a.scheme]) !== (b.port ?? DEFAULT_PORT[b.scheme])) return false;
  if (a.user && b.user && a.user !== b.user) return false;
  const root = trimSlash(a.path);
  const want = trimSlash(b.path);
  if (a.scheme === "sftp") return true;
  if (a.scheme === "smb") return root.split("/")[1]?.toLowerCase() === want.split("/")[1]?.toLowerCase();
  return want === root || want.startsWith(`${root === "/" ? "" : root}/`);
}

export interface Mounted {
  /** gio: the mount's root URI, to unmount it. */
  root?: string;
  /** Where to open it: a local folder, or the URI. */
  location: string;
}

/** Where a saved share is mounted, if it is. */
export function findMount(share: Share, gio: GioMount[], system: SystemMount[]): Mounted | undefined {
  if (share.method === "gio") {
    const m = gio.find((g) => gioCovers(g, share.uri));
    return m ? { root: m.uri, location: share.uri } : undefined;
  }
  const target = share.mountpoint ? trimSlash(share.mountpoint) : undefined;
  const m = target ? system.find((s) => trimSlash(s.target) === target) : undefined;
  return m ? { location: m.target } : undefined;
}

/** The local folder GVfs gives a URI, from `gio info`'s `local path:` line. */
export function parseLocalPath(info: string): string | undefined {
  return /^local path:\s*(.+)$/m.exec(info)?.[1]?.trim();
}

// ---------------------------------------------------------------------------
// gio's questions

export type Question = "user" | "domain" | "password";

/**
 * What `gio mount` waits for at the end of its output (with LC_ALL=C):
 * `User [ada]: `, `Domain [WORKGROUP]: `, `Password: `.
 */
export function pendingQuestion(output: string): Question | undefined {
  const tail = output.slice(-200);
  if (/User(?: \[[^\]\n]*\])?: ?$/.test(tail)) return "user";
  if (/Domain(?: \[[^\]\n]*\])?: ?$/.test(tail)) return "domain";
  if (/Password: ?$/.test(tail)) return "password";
  return undefined;
}

/** gio, sshfs and mount errors, said for people. */
export function explain(message: string, kind?: Kind): string {
  const m = message.replace(/^[\w.-]+ exited with \d+: /, "").trim();
  if (/already mounted/i.test(m)) return "Already mounted";
  if (/Permission denied|Login failed|Access denied|authentication|NT_STATUS_LOGON_FAILURE|Unauthorized|401/i.test(m)) {
    return "The server refused the user name or password";
  }
  if (/Host key verification failed/i.test(m)) {
    return "The server's SSH key isn't known yet: mount it once in a terminal (Ctrl+T) to accept it";
  }
  if (
    /Could not resolve|Name or service not known|Failed to retrieve share list|No such host|Temporary failure in name resolution/i
      .test(m)
  ) {
    return "The server can't be found: check its name, and that you are on its network";
  }
  if (/Connection refused/i.test(m)) {
    return `The server refused the connection: is ${kind ?? "the"} sharing enabled on it?`;
  }
  if (/timed out|No route to host|Network is unreachable|Host is down/i.test(m)) {
    return "The server doesn't answer: is it on, and are you on its network?";
  }
  if (/No such file|not found|NT_STATUS_BAD_NETWORK_NAME|does not exist|404/i.test(m)) {
    return "The server has no share or folder by that name";
  }
  if (/not supported|Operation not supported|No backend|Unknown scheme|doesn.t implement mount/i.test(m)) {
    return `GVfs can't mount ${
      kind ? `${kind} shares` : "this share"
    } here: install gvfs-backends (Debian, Ubuntu) or gvfs-smb / gvfs-nfs / gvfs-goa`;
  }
  if (/only root can|must be superuser|not in fstab|mount\.nfs: access denied|can't find in \/etc\/fstab/i.test(m)) {
    return "Only root can mount it: add the user option to its /etc/fstab line, or mount it with gio";
  }
  if (/fuse: device not found|fusermount.*not found|fuse: failed/i.test(m)) {
    return "FUSE isn't available: install fuse3";
  }
  if (/target is busy|device is busy|Device or resource busy/i.test(m)) {
    return "It is in use: close the files and terminals open in it, then unmount again";
  }
  return m.split("\n").filter(Boolean).pop() ?? m;
}

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export const newId = (name: string) => `${slug(name)}-${Date.now().toString(36)}`;
