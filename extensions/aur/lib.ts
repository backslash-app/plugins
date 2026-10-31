// The AUR's RPC answers, pacman's version comparison and the commands an AUR helper runs. Pure, tested in lib_test.ts.

export const AUR = "https://aur.archlinux.org";

/** A package as the RPC's `search` returns it; `info` adds the dependency lists. */
export interface AurPackage {
  ID: number;
  Name: string;
  PackageBase: string;
  PackageBaseID: number;
  Version: string;
  Description: string | null;
  URL: string | null;
  NumVotes: number;
  Popularity: number;
  /** Unix time it was flagged out of date, or null. */
  OutOfDate: number | null;
  /** null: orphaned. */
  Maintainer: string | null;
  Submitter?: string | null;
  FirstSubmitted: number;
  LastModified: number;
  URLPath?: string;
  Depends?: string[];
  MakeDepends?: string[];
  OptDepends?: string[];
  CheckDepends?: string[];
  Conflicts?: string[];
  Provides?: string[];
  Replaces?: string[];
  Groups?: string[];
  License?: string[];
  Keywords?: string[];
  CoMaintainers?: string[];
}

interface RpcAnswer {
  type?: string;
  error?: string;
  resultcount?: number;
  results?: AurPackage[];
}

/** The RPC answer's packages, or its error in words. */
export function parseRpc(json: unknown): AurPackage[] {
  const a = (json ?? {}) as RpcAnswer;
  if (a.type === "error" || a.error) throw new Error(rpcError(a.error ?? "The AUR answered with an error"));
  return Array.isArray(a.results) ? a.results.filter((p) => p && typeof p.Name === "string") : [];
}

export function rpcError(message: string): string {
  if (/too many package results/i.test(message)) return "Too many packages match: type a more precise word";
  if (/query arg too small/i.test(message)) return "Type at least 2 characters";
  if (/rate limit/i.test(message)) return "The AUR is limiting requests from your address: try again later";
  return message;
}

/** The word sent to the AUR (it searches one term) and the others, checked here. */
export function searchTerms(query: string): { term: string; rest: string[] } | undefined {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return undefined;
  const term = [...words].sort((a, b) => b.length - a.length)[0];
  return { term, rest: words.filter((w) => w !== term) };
}

export const searchUrl = (term: string, by = "name-desc") =>
  `${AUR}/rpc/v5/search/${encodeURIComponent(term)}?by=${by}`;

/** `info` for up to `size` names per request, to keep URLs short. */
export function infoUrls(names: string[], size = 100): string[] {
  const out: string[] = [];
  for (let i = 0; i < names.length; i += size) {
    const params = names.slice(i, i + size).map((n) => `arg[]=${encodeURIComponent(n)}`).join("&");
    out.push(`${AUR}/rpc/v5/info?${params}`);
  }
  return out;
}

/**
 * Exact name first, then by popularity, doubled when the name has every word: "aur helper" puts paru above
 * an unused `aur_helper`, "vscode" a popular `vscode-…` package above a rarely used one.
 */
export function rank(results: AurPackage[], query: string): AurPackage[] {
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const text = (p: AurPackage) => `${p.Name} ${p.Description ?? ""}`.toLowerCase();
  const exact = (p: AurPackage) => [q, words.join("-")].includes(p.Name.toLowerCase());
  const weight = (p: AurPackage) =>
    (p.Popularity + p.NumVotes / 1e5) * (words.every((w) => p.Name.toLowerCase().includes(w)) ? 2 : 1);
  return results
    .filter((p) => words.every((w) => text(p).includes(w)))
    .sort((a, b) => Number(exact(b)) - Number(exact(a)) || weight(b) - weight(a));
}

export const packageUrl = (name: string) => `${AUR}/packages/${encodeURIComponent(name)}`;
export const pkgbuildUrl = (base: string) => `${AUR}/cgit/aur.git/plain/PKGBUILD?h=${encodeURIComponent(base)}`;
export const pkgbuildPageUrl = (base: string) => `${AUR}/cgit/aur.git/tree/PKGBUILD?h=${encodeURIComponent(base)}`;
export const cloneUrl = (base: string) => `${AUR}/${base}.git`;

// ---------------------------------------------------------------------------
// Installed packages

export interface Installed {
  name: string;
  version: string;
}

/** `pacman -Qm`: `name version` per line. */
export function parseQm(text: string): Installed[] {
  return text.split("\n").map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 2 && p[0])
    .map(([name, version]) => ({ name, version }));
}

const VCS = /-(git|svn|hg|bzr|darcs|fossil|cvs|nightly)$/;
export const isVcs = (name: string) => VCS.test(name);

export type State = "update" | "current" | "newer" | "missing";

/** How an installed package compares with its AUR version. */
export function stateOf(local: Installed, aur: AurPackage | undefined): State {
  if (!aur) return "missing";
  const c = vercmp(aur.Version, local.version);
  return c > 0 ? "update" : c < 0 ? "newer" : "current";
}

// ---------------------------------------------------------------------------
// pacman's version comparison (libalpm's alpm_pkg_vercmp and rpmvercmp)

const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
const isAlpha = (c: string | undefined) => c !== undefined && /[A-Za-z]/.test(c);
const isAlnum = (c: string | undefined) => isDigit(c) || isAlpha(c);

/** rpmvercmp: compares alternating runs of digits and letters; separators only count by their length. */
export function rpmvercmp(a: string, b: string): number {
  if (a === b) return 0;
  let one = 0;
  let two = 0;
  let ptr1 = 0;
  let ptr2 = 0;
  while (one < a.length && two < b.length) {
    while (one < a.length && !isAlnum(a[one])) one++;
    while (two < b.length && !isAlnum(b[two])) two++;
    if (one >= a.length || two >= b.length) break;
    if (one - ptr1 !== two - ptr2) return one - ptr1 < two - ptr2 ? -1 : 1;
    ptr1 = one;
    ptr2 = two;
    let isnum: boolean;
    if (isDigit(a[ptr1])) {
      while (ptr1 < a.length && isDigit(a[ptr1])) ptr1++;
      while (ptr2 < b.length && isDigit(b[ptr2])) ptr2++;
      isnum = true;
    } else {
      while (ptr1 < a.length && isAlpha(a[ptr1])) ptr1++;
      while (ptr2 < b.length && isAlpha(b[ptr2])) ptr2++;
      isnum = false;
    }
    // A numeric segment is newer than an alpha one.
    if (ptr2 === two) return isnum ? 1 : -1;
    let s1 = a.slice(one, ptr1);
    let s2 = b.slice(two, ptr2);
    if (isnum) {
      s1 = s1.replace(/^0+/, "");
      s2 = s2.replace(/^0+/, "");
      if (s1.length !== s2.length) return s1.length > s2.length ? 1 : -1;
    }
    if (s1 !== s2) return s1 < s2 ? -1 : 1;
    one = ptr1;
    two = ptr2;
  }
  if (one >= a.length && two >= b.length) return 0;
  // A remaining alpha string never beats an empty one: 1.0 > 1.0a, 1.0.1 > 1.0.
  if ((one >= a.length && !isAlpha(b[two])) || isAlpha(a[one])) return -1;
  return 1;
}

/** `epoch:version-release` → its parts. */
export function parseEvr(evr: string): { epoch: string; version: string; release?: string } {
  let rest = evr;
  let epoch = "0";
  const colon = rest.match(/^(\d*):/);
  if (colon) {
    epoch = colon[1] || "0";
    rest = rest.slice(colon[0].length);
  }
  const dash = rest.lastIndexOf("-");
  return dash >= 0
    ? { epoch, version: rest.slice(0, dash), release: rest.slice(dash + 1) }
    : { epoch, version: rest, release: undefined };
}

/** Like `vercmp`: > 0 when `a` is newer, < 0 when `b` is, 0 when equal. */
export function vercmp(a: string, b: string): number {
  if (a === b) return 0;
  const x = parseEvr(a);
  const y = parseEvr(b);
  const e = rpmvercmp(x.epoch, y.epoch);
  if (e) return e;
  const v = rpmvercmp(x.version, y.version);
  if (v) return v;
  if (x.release !== undefined && y.release !== undefined) return rpmvercmp(x.release, y.release);
  return 0;
}

// ---------------------------------------------------------------------------
// Commands

export type Helper = "paru" | "yay";

const quote = (arg: string) => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
export const shellLine = (argv: string[]) => argv.map(quote).join(" ");

/** Installs or updates packages with the helper; without one, clones and runs makepkg. */
export function installCommand(names: string[], helper?: Helper, base = names[0]): string {
  if (helper) return shellLine([helper, "-S", ...names]);
  const dir = `"\${XDG_CACHE_HOME:-$HOME/.cache}/backslash-aur"`;
  return [
    `mkdir -p ${dir}`,
    `cd ${dir}`,
    `rm -rf ${quote(base)}`,
    shellLine(["git", "clone", cloneUrl(base)]),
    `cd ${quote(base)}`,
    `\${PAGER:-less} PKGBUILD`,
    "makepkg -si",
  ].join(" && ");
}

/** Updates every AUR package (`-Sua`: the AUR only, not the repositories). */
export const updateAllCommand = (helper: Helper) => shellLine([helper, "-Sua"]);

export const removeCommand = (names: string[]) => shellLine(["sudo", "pacman", "-Rns", ...names]);

/** A shell script for the terminal: runs the command, then waits for Enter so the output stays readable. */
export function holdOpen(command: string): string[] {
  return [
    "sh",
    "-c",
    `${command}\nstatus=$?\necho\nif [ "$status" = 0 ]; then printf '\\033[32mDone.\\033[0m '; else printf '\\033[31mFailed (exit %s).\\033[0m ' "$status"; fi\nprintf 'Press Enter to close this window.'\nread -r _`,
  ];
}

/** "openssl>=3" → "openssl", "python-foo: for bar support" → "python-foo". */
export const depName = (dep: string) => dep.split(/[<>=:]/)[0].trim();

// ---------------------------------------------------------------------------
// Formatting

/** A short age: "today", "3d", "5mo", "2y". */
export function age(unix: number, now = Date.now()): string {
  const days = Math.floor((now - unix * 1000) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

export const date = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

export const popularity = (p: number) => (p >= 10 ? p.toFixed(1) : p >= 0.01 ? p.toFixed(2) : p > 0 ? "<0.01" : "0");

export const votes = (
  n: number,
) => (n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** The PKGBUILD as a markdown code block, with a few lines worth checking called out. */
export function pkgbuildMarkdown(name: string, text: string): string {
  const warnings = pkgbuildWarnings(text);
  return [
    `**${name}**: read it before building; it runs on your computer.`,
    ...(warnings.length ? ["", ...warnings.map((w) => `- ⚠ ${w}`)] : []),
    "",
    "```bash",
    text.replace(/```/g, "ˋˋˋ").trimEnd(),
    "```",
  ].join("\n");
}

/** Things in a PKGBUILD a careful reader looks twice at. Hints, not a verdict. */
export function pkgbuildWarnings(text: string): string[] {
  const out: string[] = [];
  if (/\b(curl|wget)\b[^\n|]*\|\s*(ba|z)?sh\b/.test(text)) out.push("Downloads a script and runs it");
  if (/\bsudo\b/.test(text)) out.push("Uses sudo inside the build");
  if (/sha(256|512|1)?sums(_\w+)?=\(\s*'SKIP'\s*\)/.test(text) && !/git\+|svn\+|hg\+/.test(text)) {
    out.push("Doesn't check the source's checksum");
  }
  if (/\bbase64\s+(-d|--decode)\b/.test(text)) out.push("Decodes base64 data");
  return out;
}
