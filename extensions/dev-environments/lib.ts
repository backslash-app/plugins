// Codespaces, Coder and DevPod workspaces as one shape: parsing their API and CLI output.

import { type Color, Icons } from "@backslash/api";

export type Provider = "codespaces" | "coder" | "devpod";

export const PROVIDERS: Record<Provider, { title: string; site: string }> = {
  codespaces: { title: "GitHub Codespaces", site: "https://github.com/codespaces" },
  coder: { title: "Coder", site: "https://coder.com/docs" },
  devpod: { title: "DevPod", site: "https://devpod.sh/docs" },
};

export type State = "running" | "stopped" | "starting" | "stopping" | "failed" | "deleting" | "unknown";

export interface Workspace {
  provider: Provider;
  /** What the provider's API or CLI calls it by (codespace name, owner/name, DevPod id). */
  id: string;
  title: string;
  state: State;
  /** The provider's own word for the state. */
  rawState: string;
  repo?: string;
  repoUrl?: string;
  branch?: string;
  machine?: string;
  owner?: string;
  template?: string;
  /** DevPod's provider (docker, kubernetes, aws…). */
  backend?: string;
  ide?: string;
  location?: string;
  created?: string;
  lastUsed?: string;
  /** Codespaces' and Coder's page for it. */
  webUrl?: string;
  ahead?: number;
  behind?: number;
  uncommitted?: boolean;
  unpushed?: boolean;
  /** A newer template version exists (Coder). */
  outdated?: boolean;
  /** When it stops by itself (Coder's deadline). */
  deadline?: string;
  idleTimeoutMinutes?: number;
  healthy?: boolean;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

// ---------------------------------------------------------------------------
// GitHub Codespaces (GET /user/codespaces)

export function codespaceState(state: string): State {
  switch (state) {
    case "Available":
      return "running";
    case "Shutdown":
    case "Archived":
      return "stopped";
    case "Created":
    case "Queued":
    case "Provisioning":
    case "Awaiting":
    case "Starting":
    case "Rebuilding":
    case "Updating":
    case "Exporting":
    case "Moved":
      return "starting";
    case "ShuttingDown":
      return "stopping";
    case "Failed":
    case "Unavailable":
      return "failed";
    case "Deleted":
      return "deleting";
    default:
      return "unknown";
  }
}

export function parseCodespaces(body: unknown): Workspace[] {
  const list = (body as { codespaces?: unknown[] } | undefined)?.codespaces;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw) => {
    const c = raw as Record<string, any>;
    const name = str(c.name);
    if (!name) return [];
    const repo = str(c.repository?.full_name);
    return [{
      provider: "codespaces" as const,
      id: name,
      title: str(c.display_name) || name,
      state: codespaceState(str(c.state)),
      rawState: str(c.state) || "Unknown",
      repo: repo || undefined,
      repoUrl: str(c.repository?.html_url) || undefined,
      branch: str(c.git_status?.ref) || undefined,
      machine: str(c.machine?.display_name) || str(c.machine?.name) || undefined,
      owner: str(c.owner?.login) || undefined,
      location: str(c.location) || undefined,
      created: str(c.created_at) || undefined,
      lastUsed: str(c.last_used_at) || undefined,
      webUrl: str(c.web_url) || undefined,
      ahead: num(c.git_status?.ahead),
      behind: num(c.git_status?.behind),
      uncommitted: c.git_status?.has_uncommitted_changes === true,
      unpushed: c.git_status?.has_unpushed_changes === true,
      idleTimeoutMinutes: num(c.idle_timeout_minutes),
      template: str(c.devcontainer_path) || undefined,
    }];
  });
}

/** Opens a codespace in the desktop VS Code (the GitHub Codespaces extension). */
export const codespaceVscodeUrl = (name: string) =>
  `vscode://github.codespaces/connect?name=${encodeURIComponent(name)}&windowId=_blank`;

// ---------------------------------------------------------------------------
// Coder (`coder list -o json`)

export function coderState(status: string): State {
  switch (status) {
    case "running":
      return "running";
    case "stopped":
    case "canceled":
    case "deleted":
      return "stopped";
    case "pending":
    case "starting":
      return "starting";
    case "stopping":
    case "canceling":
      return "stopping";
    case "failed":
      return "failed";
    case "deleting":
      return "deleting";
    default:
      return "unknown";
  }
}

export function parseCoder(out: string): Workspace[] {
  let list: unknown;
  try {
    list = JSON.parse(out);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw) => {
    const w = raw as Record<string, any>;
    const name = str(w.name);
    if (!name) return [];
    const owner = str(w.owner_name);
    const status = str(w.latest_build?.status);
    const agents = ((w.latest_build?.resources ?? []) as { agents?: { status?: string }[] }[])
      .flatMap((r) => r.agents ?? []);
    return [{
      provider: "coder" as const,
      id: owner ? `${owner}/${name}` : name,
      title: name,
      state: coderState(status),
      rawState: status || "unknown",
      owner: owner || undefined,
      template: str(w.template_display_name) || str(w.template_name) || undefined,
      created: str(w.created_at) || undefined,
      lastUsed: str(w.last_used_at) || undefined,
      outdated: w.outdated === true,
      deadline: str(w.latest_build?.deadline) || undefined,
      healthy: typeof w.health?.healthy === "boolean"
        ? w.health.healthy
        : agents.length
        ? agents.every((a) => a.status === "connected")
        : undefined,
    }];
  });
}

/** `https://coder.acme.dev` from `~/.config/coderv2/url`. */
export function coderUrl(text: string | undefined): string | undefined {
  const url = (text ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(url) ? url : undefined;
}

export const coderWebUrl = (base: string, w: Workspace) => `${base}/@${w.owner ?? "me"}/${w.title}`;

// ---------------------------------------------------------------------------
// DevPod (`devpod list --output json`, `devpod status <id> --output json`)

export function devpodState(state: string): State {
  switch (state) {
    case "Running":
      return "running";
    case "Stopped":
      return "stopped";
    case "Busy":
      return "starting";
    case "NotFound":
      return "failed";
    default:
      return "unknown";
  }
}

export function parseDevpod(out: string): Workspace[] {
  let list: unknown;
  try {
    list = JSON.parse(out);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw) => {
    const w = raw as Record<string, any>;
    const id = str(w.id);
    if (!id) return [];
    const git = str(w.source?.gitRepository);
    const local = str(w.source?.localFolder);
    const image = str(w.source?.image);
    return [{
      provider: "devpod" as const,
      id,
      title: id,
      state: "unknown" as const,
      rawState: "Unknown",
      repo: git ? git.replace(/^https?:\/\/(www\.)?/, "").replace(/\.git$/, "") : local || image || undefined,
      repoUrl: /^https?:\/\//.test(git) ? git.replace(/\.git$/, "") : undefined,
      branch: str(w.source?.gitBranch) || undefined,
      backend: str(w.provider?.name) || undefined,
      ide: str(w.ide?.name) || undefined,
      created: str(w.creationTimestamp) || undefined,
      lastUsed: str(w.lastUsed) || undefined,
    }];
  });
}

/** `{"id":"…","state":"Running"}`; an unknown state when DevPod printed something else. */
export function parseDevpodStatus(out: string): string {
  try {
    return str((JSON.parse(out) as { state?: unknown }).state) || "Unknown";
  } catch {
    return /\b(Running|Stopped|Busy|NotFound)\b/.exec(out)?.[1] ?? "Unknown";
  }
}

// ---------------------------------------------------------------------------
// Display

export function stateLook(state: State): { icon: string; tint: Color; text: string } {
  switch (state) {
    case "running":
      return { icon: Icons.play, tint: "green", text: "Running" };
    case "stopped":
      return { icon: Icons.pause, tint: "gray", text: "Stopped" };
    case "starting":
      return { icon: Icons.inProgress, tint: "blue", text: "Starting" };
    case "stopping":
      return { icon: Icons.inProgress, tint: "orange", text: "Stopping" };
    case "failed":
      return { icon: Icons.alert, tint: "red", text: "Failed" };
    case "deleting":
      return { icon: Icons.trash, tint: "red", text: "Deleting" };
    default:
      return { icon: Icons.question, tint: "gray", text: "Unknown" };
  }
}

/** Something is changing: worth checking again in a few seconds. */
export const isTransitional = (s: State) => s === "starting" || s === "stopping" || s === "deleting";

/** Running first, then the most recently used. */
export function sortWorkspaces(list: Workspace[]): Workspace[] {
  const rank = (
    w: Workspace,
  ) => (w.state === "running" ? 0 : isTransitional(w.state) ? 1 : w.state === "failed" ? 2 : 3);
  const used = (w: Workspace) => Date.parse(w.lastUsed ?? w.created ?? "") || 0;
  return [...list].sort((a, b) => rank(a) - rank(b) || used(b) - used(a) || a.title.localeCompare(b.title));
}

/** "just now", "5m ago", "3h ago", "2d ago", "25 Oct". */
export function ago(iso: string | undefined, now = new Date()): string {
  const t = Date.parse(iso ?? "");
  if (!t) return "";
  const s = (now.getTime() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return new Date(t).toLocaleDateString("en", { day: "numeric", month: "short" });
}

/** "in 2h 10m" until a deadline; empty once passed. */
export function until(iso: string | undefined, now = new Date()): string {
  const t = Date.parse(iso ?? "");
  if (!t || t <= now.getTime()) return "";
  const m = Math.round((t - now.getTime()) / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `in ${h}h${m % 60 ? ` ${m % 60}m` : ""}` : `in ${Math.floor(h / 24)}d`;
}

/** "↑2 ↓1, uncommitted changes". */
export function gitSummary(w: Workspace): string {
  const parts: string[] = [];
  if (w.ahead) parts.push(`↑${w.ahead}`);
  if (w.behind) parts.push(`↓${w.behind}`);
  const flags = [w.uncommitted ? "uncommitted changes" : "", w.unpushed && !w.ahead ? "unpushed commits" : ""]
    .filter(Boolean);
  return [parts.join(" "), flags.join(", ")].filter(Boolean).join(", ");
}

/** A command line as a shell would read it back. */
export const shellLine = (argv: string[]) =>
  argv.map((a) => /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`).join(" ");

/**
 * Runs `argv` in a terminal. On failure, or always with `wait` (commands that
 * print and exit), it waits for Enter so the output stays readable.
 */
export function terminalScript(argv: string[], wait = false): string {
  const line = shellLine(argv);
  return [
    `printf '\\033[2m$ %s\\033[0m\\n' ${shellLine([line])}`,
    line,
    "code=$?",
    `if [ "$code" != 0 ]; then printf '\\n\\033[31mFailed (%s).\\033[0m Press Enter to close…' "$code"; read -r _;`,
    wait ? `else printf '\\n\\033[32mDone.\\033[0m Press Enter to close…'; read -r _; fi` : "fi",
  ].join("\n");
}
