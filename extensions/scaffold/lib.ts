// Project templates: where they live, what they ask (cookiecutter.json, copier.yml), and the commands that apply them.

// deno-lint-ignore no-import-prefix
import { parse as parseYaml } from "jsr:@std/yaml@^1";
import { type Field, field, type FormValues } from "@backslash/api";

export type Kind = "cookiecutter" | "copier" | "git";

export const KINDS: Record<Kind, { title: string; site: string }> = {
  cookiecutter: { title: "Cookiecutter", site: "https://cookiecutter.readthedocs.io" },
  copier: { title: "Copier", site: "https://copier.readthedocs.io" },
  git: { title: "Git copy", site: "https://github.com/Rich-Harris/degit" },
};

// ---------------------------------------------------------------------------
// Sources

export interface Template {
  /** As the user wrote it. */
  raw: string;
  /** Forced with a `cookiecutter:`, `copier:` or `degit:` prefix. */
  kind?: Kind;
  host: "github" | "gitlab" | "codeberg" | "git" | "local";
  owner?: string;
  repo?: string;
  /** A folder inside the repository (degit's `owner/repo/sub/dir`). */
  subdir?: string;
  /** A branch, tag or commit (`#ref`). */
  ref?: string;
  /** For local templates. */
  path?: string;
  /** What git clones. */
  cloneUrl: string;
  webUrl?: string;
  name: string;
}

const HOSTS: Record<string, Template["host"]> = {
  "github.com": "github",
  "gitlab.com": "gitlab",
  "codeberg.org": "codeberg",
};

const PREFIXES: Record<string, Template["host"]> = {
  gh: "github",
  github: "github",
  gl: "gitlab",
  gitlab: "gitlab",
  cb: "codeberg",
  codeberg: "codeberg",
};

const DOMAINS: Record<string, string> = { github: "github.com", gitlab: "gitlab.com", codeberg: "codeberg.org" };

const expand = (path: string, home: string) => path === "~" ? home : path.replace(/^~\//, `${home}/`);

function webUrl(host: Template["host"], base: string, ref: string | undefined, dir: string): string {
  if (!ref && !dir) return base;
  const r = ref ?? (host === "codeberg" ? "main" : "HEAD");
  const tree = host === "gitlab" ? "/-/tree/" : host === "codeberg" ? "/src/branch/" : "/tree/";
  return `${base}${tree}${r}${dir ? `/${dir}` : ""}`;
}

function fromHosted(raw: string, kind: Kind | undefined, host: Template["host"], rest: string, ref?: string): Template {
  const parts = rest.replace(/\.git$/, "").replace(/\/+$/, "").split("/").filter(Boolean);
  // GitLab groups nest; elsewhere, `owner/repo/sub/dir`. `/tree/<ref>/<dir>` from a browser URL too.
  let owner = parts[0], repo = parts[1], tail = parts.slice(2);
  if (host === "gitlab" && tail[0] === "-") tail = tail.slice(1);
  if (tail[0] === "tree" || (host === "codeberg" && tail[0] === "src" && tail[1] === "branch")) {
    if (tail[0] === "src") tail = tail.slice(1);
    ref ??= tail[1];
    tail = tail.slice(2);
  }
  if (host === "gitlab" && tail.length && !ref) {
    // gitlab.com/group/subgroup/repo: no way to tell a subgroup from a folder without the API.
    owner = [owner, repo, ...tail.slice(0, -1)].join("/");
    repo = tail[tail.length - 1];
    tail = [];
  }
  const domain = DOMAINS[host];
  return {
    raw,
    kind,
    host,
    owner,
    repo,
    subdir: tail.length ? tail.join("/") : undefined,
    ref,
    cloneUrl: `https://${domain}/${owner}/${repo}.git`,
    webUrl: webUrl(host, `https://${domain}/${owner}/${repo}`, ref, tail.join("/")),
    name: tail.length ? tail[tail.length - 1] : repo,
  };
}

/**
 * Reads a template source: `gh:owner/repo`, `owner/repo/sub/dir#ref` (degit),
 * `https://github.com/…`, `git@host:owner/repo.git`, `~/templates/x`, with an
 * optional `cookiecutter:`, `copier:` or `degit:` prefix.
 */
export function parseTemplate(input: string, home: string): Template | undefined {
  let raw = input.trim();
  if (!raw) return undefined;
  let kind: Kind | undefined;
  const k = /^(cookiecutter|copier|degit|git):(?!\/\/)/i.exec(raw);
  if (k) {
    kind = k[1].toLowerCase() === "cookiecutter" ? "cookiecutter" : k[1].toLowerCase() === "copier" ? "copier" : "git";
    raw = raw.slice(k[0].length).trim();
  }
  const original = input.trim();
  let ref: string | undefined;
  const hash = raw.lastIndexOf("#");
  if (hash > 0) {
    ref = raw.slice(hash + 1) || undefined;
    raw = raw.slice(0, hash);
  }
  // Local folders.
  if (/^(~|\/|\.\.?\/)/.test(raw)) {
    const path = expand(raw, home).replace(/\/+$/, "");
    return { raw: original, kind, host: "local", path, cloneUrl: path, ref, name: path.split("/").pop() || path };
  }
  const prefix = /^([a-z]+):(?!\/\/)(.+)$/i.exec(raw);
  if (prefix && PREFIXES[prefix[1].toLowerCase()]) {
    return fromHosted(original, kind, PREFIXES[prefix[1].toLowerCase()], prefix[2], ref);
  }
  const ssh = /^git@([^:]+):(.+)$/.exec(raw);
  if (ssh) {
    const host = HOSTS[ssh[1].toLowerCase()];
    if (host) return { ...fromHosted(original, kind, host, ssh[2], ref), cloneUrl: raw };
    return {
      raw: original,
      kind,
      host: "git",
      cloneUrl: raw,
      ref,
      name: ssh[2].replace(/\.git$/, "").split("/").pop()!,
    };
  }
  const url = /^https?:\/\/([^/]+)\/(.+)$/i.exec(raw);
  if (url) {
    const host = HOSTS[url[1].toLowerCase().replace(/^www\./, "")];
    if (host) return fromHosted(original, kind, host, url[2], ref);
    const name = url[2].replace(/\.git$/, "").replace(/\/+$/, "").split("/").pop()!;
    return { raw: original, kind, host: "git", cloneUrl: raw, webUrl: raw.replace(/\.git$/, ""), ref, name };
  }
  // degit's shorthand: owner/repo[/sub/dir] on GitHub.
  if (/^[\w.-]+\/[\w.-]+(\/[\w./-]+)?$/.test(raw)) return fromHosted(original, kind, "github", raw, ref);
  return undefined;
}

/** A preference listing templates: separated by commas or new lines. */
export function parseTemplateList(text: unknown, home: string): Template[] {
  return String(text ?? "").split(/[,\n]/).map((s) => parseTemplate(s, home)).filter((t): t is Template => !!t);
}

/** The source cookiecutter and copier understand (`gh:owner/repo`, a URL, a path). */
export function toolSource(t: Template): string {
  if (t.host === "local") return t.path!;
  if (t.host === "github") return `gh:${t.owner}/${t.repo}`;
  if (t.host === "gitlab") return `gl:${t.owner}/${t.repo}`;
  return t.cloneUrl;
}

/** Raw file URLs to try for `file` (ref given, else the default branch). */
export function rawUrls(t: Template, file: string): string[] {
  const path = t.subdir ? `${t.subdir}/${file}` : file;
  const refs = t.ref ? [t.ref] : t.host === "codeberg" ? ["main", "master"] : ["HEAD"];
  return refs.flatMap((ref) => {
    switch (t.host) {
      case "github":
        return [`https://raw.githubusercontent.com/${t.owner}/${t.repo}/${ref}/${path}`];
      case "gitlab":
        return [`https://gitlab.com/${t.owner}/${t.repo}/-/raw/${ref}/${path}`];
      case "codeberg":
        return [`https://codeberg.org/${t.owner}/${t.repo}/raw/branch/${ref}/${path}`];
      default:
        return [];
    }
  });
}

/** `url = https://github.com/…` in a clone's `.git/config` (origin first). */
export function gitOrigin(config: string): string | undefined {
  const sections = config.split(/^\[/m);
  const origin = sections.find((s) => /^remote "origin"\]/.test(s)) ?? sections.find((s) => /^remote "/.test(s));
  return origin ? /^\s*url\s*=\s*(.+?)\s*$/m.exec(origin)?.[1] : undefined;
}

// ---------------------------------------------------------------------------
// Questions

export interface Question {
  key: string;
  title: string;
  type: "text" | "bool" | "choice" | "secret" | "multiline";
  /** As a string for text fields; checkbox state for bool. */
  default: string | boolean;
  /** A Jinja expression: computed by the tool when left empty. */
  computed?: string;
  choices?: { value: string; title: string }[];
  help?: string;
}

const isJinja = (v: unknown) => typeof v === "string" && /\{\{|\{%/.test(v);

/** `project_slug` → `Project slug`. */
export const humanize = (key: string) => {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** cookiecutter.json: strings, choices (lists), booleans; `__prompts__` labels them. */
export function cookiecutterQuestions(text: string): Question[] {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const prompts = (data.__prompts__ ?? {}) as Record<string, unknown>;
  const out: Question[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith("_")) continue;
    const prompt = prompts[key];
    const label = typeof prompt === "string"
      ? prompt
      : typeof (prompt as { __prompt__?: unknown })?.__prompt__ === "string"
      ? (prompt as { __prompt__: string }).__prompt__
      : humanize(key);
    const title = label.replace(/[?:]\s*$/, "");
    if (Array.isArray(value)) {
      const labels = (prompt && typeof prompt === "object" ? prompt : {}) as Record<string, unknown>;
      const choices = value.map((v) => String(v)).map((v) => ({
        value: v,
        title: typeof labels[v] === "string" ? labels[v] as string : v,
      }));
      if (choices.length) out.push({ key, title, type: "choice", default: choices[0].value, choices });
    } else if (typeof value === "boolean") {
      out.push({ key, title, type: "bool", default: value });
    } else if (typeof value === "string" || typeof value === "number") {
      out.push(
        isJinja(value)
          ? { key, title, type: "text", default: "", computed: String(value) }
          : { key, title, type: "text", default: String(value) },
      );
    }
    // Dictionaries aren't prompted for with --no-input: their defaults apply.
  }
  return out;
}

/** What copier.yml says about itself: features that need `--trust`. */
export interface CopierInfo {
  questions: Question[];
  needsTrust: boolean;
  /** The YAML couldn't be read (custom tags, includes): run it in a terminal. */
  unreadable?: boolean;
}

function choiceList(choices: unknown): { value: string; title: string }[] | undefined {
  if (Array.isArray(choices)) {
    return choices.map((c) =>
      Array.isArray(c) ? { title: String(c[0]), value: String(c[1]) } : { title: String(c), value: String(c) }
    );
  }
  if (choices && typeof choices === "object") {
    return Object.entries(choices as Record<string, unknown>).map(([title, v]) => ({
      title,
      value: String(v && typeof v === "object" && "value" in v ? (v as { value: unknown }).value : v),
    }));
  }
  return undefined;
}

/** copier.yml / copier.yaml: `key: default` or `key: { type, help, default, choices, secret, when }`. */
export function copierQuestions(text: string): CopierInfo {
  let data: unknown;
  try {
    // Several documents are merged, as copier does.
    data = text.split(/^---\s*$/m).map((doc) => parseYaml(doc) ?? {}).reduce(
      (a: Record<string, unknown>, b) => ({ ...a, ...(b as Record<string, unknown>) }),
      {},
    );
  } catch {
    return { questions: [], needsTrust: false, unreadable: true };
  }
  if (!data || typeof data !== "object") return { questions: [], needsTrust: false };
  const d = data as Record<string, unknown>;
  const needsTrust = ["_tasks", "_migrations", "_jinja_extensions"].some((k) =>
    Array.isArray(d[k]) ? (d[k] as unknown[]).length > 0 : !!d[k]
  );
  const out: Question[] = [];
  for (const [key, spec] of Object.entries(d)) {
    if (key.startsWith("_")) continue;
    const s = spec && typeof spec === "object" && !Array.isArray(spec)
      ? spec as Record<string, unknown>
      : { default: spec };
    if (s.when === false) continue;
    const help = typeof s.help === "string" ? s.help.trim() : "";
    const title = (help.split("\n")[0] || humanize(key)).replace(/[?:]\s*$/, "");
    const def = s.default;
    const type = String(s.type ?? (typeof def === "boolean" ? "bool" : "str"));
    const choices = choiceList(s.choices);
    if (choices?.length && !s.multiselect) {
      const first = isJinja(def) || def === undefined ? choices[0].value : String(def);
      out.push({ key, title, type: "choice", default: first, choices, help: help || undefined });
    } else if (type === "bool") {
      out.push({ key, title, type: "bool", default: def === true, help: help || undefined });
    } else {
      const kind = s.secret ? "secret" : s.multiline ? "multiline" : "text";
      const value = def === undefined || def === null
        ? ""
        : typeof def === "object"
        ? JSON.stringify(def)
        : String(def);
      out.push(
        isJinja(value)
          ? { key, title, type: kind, default: "", computed: value, help: help || undefined }
          : { key, title, type: kind, default: value, help: help || undefined },
      );
    }
  }
  return { questions: out, needsTrust };
}

/** Form fields for the questions, ids prefixed so they can't clash with the form's own. */
export function questionFields(questions: Question[]): Field[] {
  return questions.map((q) => {
    const id = `v:${q.key}`;
    const placeholder = q.computed ? `Computed: ${q.computed.replace(/\s+/g, " ").slice(0, 60)}` : undefined;
    switch (q.type) {
      case "bool":
        return field.checkbox(id, q.title, { value: q.default === true });
      case "choice":
        return field.dropdown(id, q.title, q.choices!, { value: String(q.default) });
      case "secret":
        return field.password(id, q.title, { value: String(q.default), placeholder });
      case "multiline":
        return field.textArea(id, q.title, { value: String(q.default), placeholder });
      default:
        return field.text(id, q.title, { value: String(q.default), placeholder });
    }
  });
}

/** The answers that differ from the defaults (the tool fills in the rest). */
export function answers(questions: Question[], values: FormValues, kind: Kind): [string, string][] {
  const out: [string, string][] = [];
  for (const q of questions) {
    const v = values[`v:${q.key}`];
    if (v === undefined) continue;
    if (q.type === "bool") {
      if (Boolean(v) === q.default) continue;
      out.push([q.key, kind === "cookiecutter" ? (v ? "yes" : "no") : (v ? "true" : "false")]);
    } else {
      const text = String(v);
      if (text === String(q.default) || (q.computed && !text.trim())) continue;
      out.push([q.key, text]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Commands

/** A folder name for the new project: letters, digits, dots, dashes and underscores. */
export function checkFolderName(name: string): string {
  const n = name.trim();
  if (!n) throw new Error("Give the new project a folder name");
  if (n === "." || n === ".." || /[/\\\0]/.test(n)) throw new Error(`“${n}” can't be a folder name`);
  return n;
}

export interface Run {
  /** How the tool is started: `cookiecutter`, or `uvx cookiecutter`, `pipx run copier`. */
  tool: string[];
  interactive: boolean;
  trust?: boolean;
}

export function cookiecutterArgv(t: Template, parent: string, given: [string, string][], run: Run): string[] {
  return [
    ...run.tool,
    ...(run.interactive ? [] : ["--no-input"]),
    "--output-dir",
    parent,
    ...(t.ref ? ["--checkout", t.ref] : []),
    ...(t.subdir ? ["--directory", t.subdir] : []),
    toolSource(t),
    ...given.map(([k, v]) => `${k}=${v}`),
  ];
}

export function copierArgv(t: Template, dest: string, given: [string, string][], run: Run): string[] {
  return [
    ...run.tool,
    "copy",
    ...(run.interactive ? [] : ["--defaults"]),
    ...(run.trust ? ["--trust"] : []),
    ...(t.ref ? ["--vcs-ref", t.ref] : []),
    ...given.flatMap(([k, v]) => ["--data", `${k}=${v}`]),
    toolSource(t),
    dest,
  ];
}

/** git clone of the files only (degit-style): shallow, sparse for a sub-folder. */
export function cloneArgv(t: Template, dest: string): string[] {
  return [
    "git",
    "clone",
    "--depth",
    "1",
    ...(t.subdir ? ["--filter=blob:none", "--sparse"] : []),
    ...(t.ref ? ["--branch", t.ref] : []),
    t.cloneUrl,
    dest,
  ];
}

const q = (arg: string) => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
export const shellLine = (argv: string[]) => argv.map(q).join(" ");

/** The shell script that copies a git template in a terminal, keeping no history. */
export function gitScript(t: Template, dest: string): string[] {
  if (!t.subdir) return [shellLine(cloneArgv(t, dest)), `rm -rf ${q(`${dest}/.git`)}`];
  return [
    'tmp="$(mktemp -d)"',
    `${shellLine(cloneArgv(t, "TMPDIR_PLACEHOLDER")).replace("TMPDIR_PLACEHOLDER", '"$tmp/repo"')}`,
    `git -C "$tmp/repo" sparse-checkout set ${q(t.subdir)}`,
    `mv "$tmp/repo/"${q(t.subdir)} ${q(dest)}`,
    'rm -rf "$tmp"',
  ];
}

/** Runs the lines in a terminal, stops at the first failure, waits for Enter at the end. */
export function terminalScript(title: string, cwd: string, lines: string[]): string {
  return [
    `printf '\\033[1m==> %s\\033[0m\\n' ${q(title)}`,
    `cd ${q(cwd)} || exit 1`,
    `( set -e`,
    ...lines.map((l) => `  ${l}`),
    `)`,
    "code=$?",
    `if [ "$code" = 0 ]; then printf '\\n\\033[32mDone.\\033[0m '; else printf '\\n\\033[31mFailed (%s).\\033[0m ' "$code"; fi`,
    "printf 'Press Enter to close…'; read -r _",
  ].join("\n");
}

/** The folder a run created: the one entry that wasn't there before. */
export function newEntry(before: string[], after: string[]): string | undefined {
  const known = new Set(before);
  const added = after.filter((n) => !known.has(n) && !n.startsWith("."));
  return added.length === 1 ? added[0] : undefined;
}

/** Turns what the tool printed into a sentence. */
export function explainFailure(kind: Kind, output: string): string {
  // deno-lint-ignore no-control-regex
  const text = output.replace(/\x1b\[[0-9;]*m/g, "").trim();
  if (kind === "copier" && /unsafe|--trust/i.test(text)) {
    return "This template runs its own tasks: tick “Trust the template” or create it in a terminal";
  }
  if (/already exists/i.test(text)) return "A folder with that name already exists";
  if (/Repository not found|not found|404/i.test(text)) return "The template's repository wasn't found";
  if (/could not read Username|Authentication failed|Permission denied \(publickey\)/i.test(text)) {
    return "Git couldn't sign in to the template's repository";
  }
  const last = text.split("\n").filter(Boolean).pop() ?? "";
  return last.length > 200 ? `${last.slice(0, 200)}…` : last || "The template couldn't be applied";
}

export const tilde = (path: string, home: string) =>
  home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;

export { expand };
