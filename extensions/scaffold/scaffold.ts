// Finding templates, reading their questions, and applying them.

import { storage } from "@backslash/api";
import {
  checkFolderName,
  cloneArgv,
  expand,
  explainFailure,
  gitOrigin,
  type Kind,
  newEntry,
  parseTemplate,
  rawUrls,
  type Template,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";

/** Where projects may be created: same folders as `[permissions] write`. */
export const FOLDERS = [
  "Projects",
  "projects",
  "Code",
  "code",
  "dev",
  "Developer",
  "src",
  "git",
  "repos",
  "workspace",
  "work",
  "Work",
];

const CACHE = `${HOME}/.cookiecutters`;

export const SUGGESTIONS = [
  "gh:audreyfeldroy/cookiecutter-pypackage",
  "gh:cookiecutter/cookiecutter-django",
  "gh:simonw/python-lib",
  "gh:pawamoy/copier-uv",
  "gh:fastapi/full-stack-fastapi-template",
  "degit:vitejs/vite/packages/create-vite/template-react-ts",
];

// ---------------------------------------------------------------------------
// Templates

/** Templates the user added from the launcher (the preference holds the others). */
export const added = async () => (await storage.get<string[]>("added")) ?? [];

export async function addTemplate(source: string): Promise<void> {
  const list = await added();
  if (!list.includes(source)) await storage.set("added", [...list, source]);
}

export async function removeTemplate(source: string): Promise<void> {
  await storage.set("added", (await added()).filter((s) => s !== source));
}

/** Templates Cookiecutter cloned before, by their origin (and read from the local copy). */
export async function usedBefore(): Promise<{ template: Template; local: string }[]> {
  const out: { template: Template; local: string }[] = [];
  try {
    for await (const e of Deno.readDir(CACHE)) {
      if (!e.isDirectory) continue;
      const local = `${CACHE}/${e.name}`;
      const origin = gitOrigin(await Deno.readTextFile(`${local}/.git/config`).catch(() => ""));
      const template = parseTemplate(origin ?? local, HOME);
      if (template) out.push({ template: { ...template, kind: template.kind ?? "cookiecutter" }, local });
    }
  } catch { /* never used */ }
  return out.sort((a, b) => a.template.name.localeCompare(b.template.name));
}

// ---------------------------------------------------------------------------
// What a template is and asks

export interface Detected {
  kind: Kind;
  /** cookiecutter.json or copier.yml's text. */
  config?: string;
  /** Couldn't be read: shown, and the form falls back to a terminal. */
  error?: string;
}

const FILES: [string, Kind][] = [["cookiecutter.json", "cookiecutter"], ["copier.yml", "copier"], [
  "copier.yaml",
  "copier",
]];

async function fetchText(url: string, signal?: AbortSignal): Promise<string | undefined> {
  const res = await fetch(url, { signal });
  if (res.ok) return await res.text();
  await res.body?.cancel();
  if (res.status === 404) return undefined;
  throw new Error(`${new URL(url).host} answered ${res.status}`);
}

async function detectNow(t: Template, local?: string, signal?: AbortSignal): Promise<Detected> {
  const wanted = FILES.filter(([, k]) => !t.kind || t.kind === k);
  if (t.kind === "git") return { kind: "git" };
  const dir = local ?? (t.host === "local" ? t.path : undefined);
  if (dir) {
    const base = t.subdir ? `${dir}/${t.subdir}` : dir;
    for (const [file, kind] of wanted) {
      const text = await Deno.readTextFile(`${base}/${file}`).catch(() => undefined);
      if (text !== undefined) return { kind, config: text };
    }
    return { kind: t.kind ?? "git" };
  }
  if (t.host === "git") {
    // Any other git host: nothing to read without cloning; let the tool ask.
    return { kind: t.kind ?? "git", error: t.kind ? "Questions are asked in the terminal" : undefined };
  }
  try {
    const found = await Promise.all(wanted.map(async ([file, kind]) => {
      for (const url of rawUrls(t, file)) {
        const text = await fetchText(url, signal);
        if (text !== undefined) return { kind, config: text };
      }
      return undefined;
    }));
    return found.find((f) => f) ?? { kind: t.kind ?? "git" };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { kind: t.kind ?? "git", error: `Couldn't read the template: ${e instanceof Error ? e.message : e}` };
  }
}

const DAY = 86_400_000;

/** Detection is cached for a day per source. */
export async function detect(t: Template, local?: string, signal?: AbortSignal): Promise<Detected> {
  const key = `detected:${t.raw}`;
  const cached = await storage.get<{ at: number; kind: Kind; config?: string }>(key).catch(() => undefined);
  if (cached && Date.now() - cached.at < DAY && t.host !== "local" && !local) {
    return { kind: cached.kind, config: cached.config };
  }
  const d = await detectNow(t, local, signal);
  if (!d.error && t.host !== "local") {
    await storage.set(key, { at: Date.now(), kind: d.kind, config: d.config ?? null });
  }
  return d;
}

export const forget = (t: Template) => storage.delete(`detected:${t.raw}`);

// ---------------------------------------------------------------------------
// Running

async function works(program: string, args: string[]): Promise<boolean> {
  try {
    const { code } = await new Deno.Command(program, { args, stdin: "null", stdout: "null", stderr: "null" })
      .output();
    return code === 0;
  } catch {
    return false;
  }
}

/** How to start cookiecutter or copier: installed, else through uvx or pipx. */
export async function findTool(kind: "cookiecutter" | "copier"): Promise<string[] | undefined> {
  if (await works(kind, ["--version"])) return [kind];
  if (await works("uvx", ["--version"])) return ["uvx", kind];
  if (await works("pipx", ["--version"])) return ["pipx", "run", kind];
  return undefined;
}

/** The folder to create projects in, checked against the folders this extension may write. */
export async function parentFolder(input: unknown): Promise<string> {
  const path = expand(String(input ?? "").trim() || "~/Projects", HOME).replace(/\/+$/, "");
  const allowed = FOLDERS.some((f) => path === `${HOME}/${f}` || path.startsWith(`${HOME}/${f}/`));
  if (!allowed) {
    throw new Error(`Projects can be created in ~/Projects, ~/code, ~/src and similar folders, not ${path}`);
  }
  await Deno.mkdir(path, { recursive: true });
  return path;
}

export async function entries(dir: string): Promise<string[]> {
  const out: string[] = [];
  for await (const e of Deno.readDir(dir)) out.push(e.name);
  return out;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** Runs a tool in `cwd`; throws a readable sentence on failure. */
export async function runTool(kind: Kind, argv: string[], cwd: string): Promise<void> {
  const [program, ...args] = argv;
  let out: Deno.CommandOutput;
  try {
    out = await new Deno.Command(program, { args, cwd, stdin: "null", stdout: "piped", stderr: "piped" }).output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error(`${program} isn't installed`);
    throw e;
  }
  if (out.code !== 0) {
    const decode = (b: Uint8Array) => new TextDecoder().decode(b);
    throw new Error(explainFailure(kind, `${decode(out.stdout)}\n${decode(out.stderr)}`));
  }
}

/** Copies a git template's files (degit-style) into `parent/name`, without its history. */
export async function copyGit(t: Template, parent: string, name: string): Promise<string> {
  const dest = `${parent}/${checkFolderName(name)}`;
  if (await exists(dest)) throw new Error(`${name} already exists in ${parent}`);
  if (!t.subdir) {
    await runTool("git", cloneArgv(t, dest), parent);
    await Deno.remove(`${dest}/.git`, { recursive: true });
    return dest;
  }
  const tmp = `${parent}/.backslash-scaffold-${crypto.randomUUID().slice(0, 8)}`;
  try {
    await runTool("git", cloneArgv(t, tmp), parent);
    await runTool("git", ["git", "-C", tmp, "sparse-checkout", "set", t.subdir], parent);
    if (!(await exists(`${tmp}/${t.subdir}`))) throw new Error(`No folder ${t.subdir} in the template`);
    await Deno.rename(`${tmp}/${t.subdir}`, dest);
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
  return dest;
}

/** The project a cookiecutter run created: the new folder in `parent`. */
export async function created(parent: string, before: string[]): Promise<string | undefined> {
  const name = newEntry(before, await entries(parent));
  return name ? `${parent}/${name}` : undefined;
}

export async function gitInit(dir: string): Promise<void> {
  if (await exists(`${dir}/.git`)) return;
  await runTool("git", ["git", "init", "--quiet"], dir);
}
