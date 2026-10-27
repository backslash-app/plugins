// Parsing editors' recent-project lists. Pure, tested in lib_test.ts.

export interface Recent {
  path: string;
  /** Unix ms, 0 when unknown. */
  opened: number;
  editor: string;
  command: string;
}

/** `file:///home/me/my%20app` → `/home/me/my app`; other schemes (remote) are skipped. */
export function fileUri(uri: string): string | undefined {
  if (!uri.startsWith("file://")) return undefined;
  return decodeURIComponent(uri.slice(7)).replace(/\/$/, "");
}

/** VS Code's `history.recentlyOpenedPathsList` value. Newest first. */
export function vscodeRecents(json: string, editor: string, command: string): Recent[] {
  const entries = (JSON.parse(json)?.entries ?? []) as any[];
  return entries.flatMap((e, i) => {
    const path = fileUri(e.folderUri ?? e.workspace?.configPath ?? "");
    // Keep the order: newer entries first, without real timestamps.
    return path ? [{ path, opened: -i, editor, command }] : [];
  });
}

const JETBRAINS: [RegExp, string, string][] = [
  [/^IntelliJIdea|^IdeaIC/, "IntelliJ IDEA", "idea"],
  [/^PyCharm/, "PyCharm", "pycharm"],
  [/^WebStorm/, "WebStorm", "webstorm"],
  [/^GoLand/, "GoLand", "goland"],
  [/^CLion/, "CLion", "clion"],
  [/^RustRover/, "RustRover", "rustrover"],
  [/^PhpStorm/, "PhpStorm", "phpstorm"],
  [/^Rider/, "Rider", "rider"],
  [/^RubyMine/, "RubyMine", "rubymine"],
  [/^DataGrip/, "DataGrip", "datagrip"],
];

/** `PyCharm2025.2` → its name and launcher. */
export function jetbrainsProduct(dir: string): [string, string] | undefined {
  const hit = JETBRAINS.find(([re]) => re.test(dir));
  return hit ? [hit[1], hit[2]] : undefined;
}

/** `options/recentProjects.xml` of a JetBrains IDE. */
export function jetbrainsRecents(xml: string, home: string, editor: string, command: string): Recent[] {
  const out: Recent[] = [];
  const entry = /<entry key="([^"]+)">([\s\S]*?)<\/entry>/g;
  for (const m of xml.matchAll(entry)) {
    const path = m[1].replace("$USER_HOME$", home);
    const ts = m[2].match(/name="projectOpenTimestamp" value="(\d+)"/);
    out.push({ path, opened: ts ? Number(ts[1]) : 0, editor, command });
  }
  return out;
}

/** Absolute paths stored by Zed (text or binary columns, depending on its version). */
export function zedPaths(value: unknown): string[] {
  const text = value instanceof Uint8Array ? new TextDecoder().decode(value) : String(value ?? "");
  return [...text.matchAll(/\/[^\p{Cc}"[\]]+/gu)].map((m) => m[0].replace(/\/$/, ""));
}

/** The newest entry per path. */
export function merge(recents: Recent[]): Recent[] {
  const byPath = new Map<string, Recent>();
  for (const r of recents) {
    const seen = byPath.get(r.path);
    if (!seen || r.opened > seen.opened) byPath.set(r.path, r);
  }
  return [...byPath.values()];
}

/** `git@github.com:me/app.git` or `https://…/app.git` → a web page. */
export function remotePage(remote: string): string | undefined {
  const ssh = remote.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  const https = remote.match(/^https?:\/\/(?:[^@/]+@)?(.+?)(?:\.git)?$/);
  return https ? `https://${https[1]}` : undefined;
}

/** `git status --porcelain=v1 --branch` → branch and changed file count. */
export function gitStatus(out: string): { branch: string; changes: number; ahead: number } {
  const [head, ...files] = out.split("\n");
  const branch = head?.replace(/^## /, "").split("...")[0].replace(/^No commits yet on /, "") ?? "";
  const ahead = Number(head?.match(/ahead (\d+)/)?.[1] ?? 0);
  return { branch, changes: files.filter(Boolean).length, ahead };
}
