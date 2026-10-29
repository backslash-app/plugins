// Where each client keeps its MCP servers, reading them all, and turning a server on or off in place.

import { parse as parseToml } from "@std/toml";
import { find, parseJsonc, parseTree, setProperty } from "./jsonc.ts";
import {
  approvalLists,
  type ClaudeProject,
  type ClientId,
  type Entry,
  parseClaudeJson,
  parseCodex,
  parseMcpJson,
  parseMcpServers,
  parseVscode,
  parseZed,
  type Source,
  tilde,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";

const h = (p: string) => `${HOME}/${p}`;

export const CLAUDE_JSON = h(".claude.json");

const VSCODES = ["Code", "Code - Insiders", "VSCodium"];

/** The folders project configs may be read from (the manifest's `read` list). */
export const CODE_FOLDERS = [
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
].map(h);

export const readable = (dir: string) => CODE_FOLDERS.some((root) => dir === root || dir.startsWith(`${root}/`));

export interface Problem {
  file: string;
  message: string;
}

export interface Loaded {
  entries: Entry[];
  problems: Problem[];
  /** Files that exist and were read. */
  files: string[];
  /** Claude Code projects outside the folders this extension may read. */
  unreadable: string[];
}

const denied = (e: unknown) => e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied;

async function readText(file: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(file);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound || e instanceof Deno.errors.NotADirectory || denied(e)) return undefined;
    throw e;
  }
}

/** Reads a config file and turns it into entries; a broken file becomes a problem, not an error. */
async function load(
  file: string,
  parse: (data: unknown) => Entry[],
  out: Loaded,
  toml = false,
): Promise<unknown> {
  const text = await readText(file);
  if (text === undefined) return undefined;
  out.files.push(file);
  try {
    const data = toml ? parseToml(text) : parseJsonc(text);
    out.entries.push(...parse(data));
    return data;
  } catch (e) {
    out.problems.push({ file, message: (e as Error).message });
    return undefined;
  }
}

/** Every server of every client, user configs and the projects' own files. */
export async function loadAll(extraProjects: string[] = []): Promise<Loaded> {
  const out: Loaded = { entries: [], problems: [], files: [], unreadable: [] };
  let projects: ClaudeProject[] = [];
  await Promise.all([
    load(CLAUDE_JSON, (d) => {
      const r = parseClaudeJson(d, CLAUDE_JSON);
      projects = r.projects;
      return r.entries;
    }, out),
    load(
      h(".config/Claude/claude_desktop_config.json"),
      (d) => parseMcpServers(d, h(".config/Claude/claude_desktop_config.json"), "claude-desktop", "User"),
      out,
    ),
    load(h(".cursor/mcp.json"), (d) => parseMcpServers(d, h(".cursor/mcp.json"), "cursor", "User"), out),
    load(
      h(".codeium/windsurf/mcp_config.json"),
      (d) => parseMcpServers(d, h(".codeium/windsurf/mcp_config.json"), "windsurf", "User"),
      out,
    ),
    load(h(".gemini/settings.json"), (d) => parseMcpServers(d, h(".gemini/settings.json"), "gemini", "User"), out),
    load(h(".config/zed/settings.json"), (d) => parseZed(d, h(".config/zed/settings.json")), out),
    load(h(".codex/config.toml"), (d) => parseCodex(d, h(".codex/config.toml")), out, true),
    ...VSCODES.flatMap((app) => {
      const user = h(`.config/${app}/User`);
      const cline = `${user}/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`;
      return [
        load(`${user}/mcp.json`, (d) => parseVscode(d, `${user}/mcp.json`, app === "Code" ? "User" : app), out),
        load(
          `${user}/settings.json`,
          (d) => parseVscode(d, `${user}/settings.json`, app === "Code" ? "User" : app),
          out,
        ),
        load(cline, (d) => parseMcpServers(d, cline, "cline", "User"), out),
      ];
    }),
  ]);

  // Each project: its .mcp.json (Claude Code), .cursor/mcp.json and .vscode/mcp.json.
  const dirs = new Map<string, ClaudeProject | { path: string }>();
  for (const p of projects) dirs.set(p.path, p);
  for (const p of extraProjects) if (!dirs.has(p)) dirs.set(p, { path: p });
  await Promise.all([...dirs.values()].map(async (p) => {
    if (!readable(p.path)) {
      out.unreadable.push(p.path);
      return;
    }
    await Promise.all([
      load(`${p.path}/.mcp.json`, (d) => parseMcpJson(d, `${p.path}/.mcp.json`, p), out),
      load(
        `${p.path}/.cursor/mcp.json`,
        (d) => parseMcpServers(d, `${p.path}/.cursor/mcp.json`, "cursor", "Project", p.path),
        out,
      ),
      load(`${p.path}/.vscode/mcp.json`, (d) => parseVscode(d, `${p.path}/.vscode/mcp.json`, "Workspace", p.path), out),
    ]);
  }));
  return out;
}

/** Changes one value in a JSON(C) file, keeping its comments and formatting. */
async function edit(file: string, path: string[], value: unknown): Promise<void> {
  let text: string;
  try {
    text = await Deno.readTextFile(file);
  } catch (e) {
    if (denied(e)) throw new Error(`This extension may not read ${tilde(file, HOME)}`);
    throw e;
  }
  const next = setProperty(text, path, value);
  // Never write something we can't read back.
  parseTree(next);
  try {
    await Deno.writeTextFile(file, next);
  } catch (e) {
    if (denied(e)) throw new Error(`This extension may not change ${tilde(file, HOME)}`);
    throw e;
  }
}

/** Turns a server on or off in the client that `src` belongs to. */
export async function setEnabled(src: Source, name: string, enable: boolean): Promise<void> {
  const t = src.toggle;
  if (!t) throw new Error(`${src.client} has no setting to turn a server off in its config file`);
  if (t.kind === "flag") {
    await edit(src.file, [...src.path, t.key], t.key === "enabled" ? enable : !enable);
    return;
  }
  // Claude Code: the project's approval lists in ~/.claude.json.
  const text = await Deno.readTextFile(CLAUDE_JSON);
  const project = find(parseTree(text), ["projects", t.project]);
  if (project?.type !== "object") throw new Error(`${tilde(t.project, HOME)} is not in ~/.claude.json`);
  const data = parseJsonc(text) as { projects: Record<string, Record<string, unknown>> };
  const p = data.projects[t.project];
  const lists = approvalLists(
    {
      enabled: (p.enabledMcpjsonServers as string[] | undefined) ?? [],
      disabled: (p.disabledMcpjsonServers as string[] | undefined) ?? [],
    },
    name,
    enable,
  );
  await edit(CLAUDE_JSON, ["projects", t.project, "enabledMcpjsonServers"], lists.enabled);
  await edit(CLAUDE_JSON, ["projects", t.project, "disabledMcpjsonServers"], lists.disabled);
}

export const CLIENT_FILES: Partial<Record<ClientId, string>> = {
  "claude-code": CLAUDE_JSON,
  "claude-desktop": h(".config/Claude/claude_desktop_config.json"),
  cursor: h(".cursor/mcp.json"),
  vscode: h(".config/Code/User/mcp.json"),
  zed: h(".config/zed/settings.json"),
  windsurf: h(".codeium/windsurf/mcp_config.json"),
  codex: h(".codex/config.toml"),
  gemini: h(".gemini/settings.json"),
};
