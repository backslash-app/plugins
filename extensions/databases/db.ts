// Reading the connection files, looking up passwords, detecting clients and
// checking servers. Shared by both commands.

import {
  action,
  clipboard,
  close,
  copy,
  exec,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  pop,
  storage,
  toast,
} from "@backslash/api";
import {
  type Client,
  clientCommand,
  CLIENTS,
  type Connection,
  type DbType,
  DEFAULT_PORTS,
  type Family,
  installCommand,
  interpretStatus,
  matchPgpass,
  myCnfConnections,
  osFamily,
  parseMyCnf,
  parsePasswords,
  parsePgpass,
  parsePgService,
  pgpassConnections,
  type PgpassEntry,
  type SavedConnection,
  savedConnections,
  serviceConnections,
  sortConnections,
  type Status,
  statusCommand,
  toSaved,
  TYPE_NAMES,
  TYPES,
  upsertSaved,
} from "./lib.ts";
import { runInTerminal } from "./terminal.ts";

export interface Prefs {
  passwords?: string;
  terminal?: string;
}

export const HOME = Deno.env.get("HOME") ?? "";

const readText = (path: string) => Deno.readTextFile(path).catch(() => "");

export interface Sources {
  connections: Connection[];
  pgpass: PgpassEntry[];
  /** Passwords found in the user's own files, by connection id. */
  filePasswords: Map<string, string>;
  /** Files that exist, for the empty state. */
  files: string[];
}

export async function loadSources(): Promise<Sources> {
  const [pgpassText, serviceText, myCnfText, saved] = await Promise.all([
    readText(`${HOME}/.pgpass`),
    readText(`${HOME}/.pg_service.conf`),
    readText(`${HOME}/.my.cnf`),
    storage.get("connections").catch(() => undefined),
  ]);
  const pgpass = parsePgpass(pgpassText);
  const services = parsePgService(serviceText);
  const groups = parseMyCnf(myCnfText);
  const filePasswords = new Map<string, string>();
  for (const s of services) if (s.password) filePasswords.set(`service:${s.name}`, s.password);
  for (const g of groups) if (g.password) filePasswords.set(`mycnf:${g.suffix}`, g.password);
  const connections = sortConnections([
    ...savedConnections(saved),
    ...serviceConnections(services),
    ...pgpassConnections(pgpass),
    ...myCnfConnections(groups),
  ]);
  const files = [
    pgpassText && "~/.pgpass",
    serviceText && "~/.pg_service.conf",
    myCnfText && "~/.my.cnf",
  ].filter(Boolean) as string[];
  return { connections, pgpass, filePasswords, files };
}

/** Where the password comes from, and the password itself, if any. */
export function passwordOf(
  c: Connection,
  src: Sources,
  prefs: Prefs,
): { password?: string; origin?: string } {
  if (c.source === "saved") {
    const pref = parsePasswords(prefs.passwords).get(c.name);
    if (pref !== undefined) return { password: pref, origin: "Passwords preference" };
  }
  const own = src.filePasswords.get(c.id);
  if (own !== undefined) return { password: own, origin: c.source === "mycnf" ? "~/.my.cnf" : "~/.pg_service.conf" };
  if (c.type === "postgres" && !c.service) {
    const hit = matchPgpass(src.pgpass, c);
    if (hit) return { password: hit.password, origin: "~/.pgpass" };
  }
  return {};
}

/** Whether the client reads the password from its own file, so none has to be passed. */
export function readsOwnPassword(origin?: string): boolean {
  return origin === "~/.pgpass" || origin === "~/.pg_service.conf" || origin === "~/.my.cnf";
}

// --- Clients ------------------------------------------------------------------

let installed: Promise<Set<Client>> | undefined;

/** Clients found on this machine (tried once per process). */
export function installedClients(): Promise<Set<Client>> {
  installed ??= (async () => {
    const all = Object.values(CLIENTS).flat();
    const found = await Promise.all(all.map(async (client) => {
      try {
        await new Deno.Command(client, { args: ["--version"], stdin: "null", stdout: "null", stderr: "null" })
          .output();
        return client;
      } catch {
        return undefined;
      }
    }));
    return new Set(found.filter((c): c is Client => !!c));
  })();
  return installed;
}

let family: Promise<Family | undefined> | undefined;
export function distro(): Promise<Family | undefined> {
  family ??= readText("/etc/os-release").then(osFamily);
  return family;
}

export function openIn(c: Connection, client: Client, src: Sources, prefs: Prefs): string {
  const { password, origin } = passwordOf(c, src, prefs);
  const inv = clientCommand(c, client, readsOwnPassword(origin) ? undefined : password);
  return runInTerminal(inv.argv, prefs.terminal || undefined, inv.env);
}

// --- Status -------------------------------------------------------------------

/** Asks the server (or the file) whether it answers, in at most 5 s. */
export async function checkStatus(c: Connection, signal?: AbortSignal): Promise<Status> {
  const argv = statusCommand(c);
  if (!argv) return { health: "unknown", text: "No file" };
  const timeout = AbortSignal.timeout(5000);
  try {
    const out = await exec(argv[0], argv.slice(1), { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    return interpretStatus(c.type, out);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return { health: "missing", text: `${argv[0]} not installed` };
    }
    if (timeout.aborted) return { health: "down", text: "No answer in 5 s" };
    return interpretStatus(c.type, undefined, err);
  }
}

// --- Saved connections ----------------------------------------------------------

export async function savedList(): Promise<SavedConnection[]> {
  const all = await storage.get("connections").catch(() => undefined);
  return Array.isArray(all) ? all as unknown as SavedConnection[] : [];
}

export async function saveConnection(next: SavedConnection, previous?: string) {
  await storage.set("connections", JSON.parse(JSON.stringify(upsertSaved(await savedList(), next, previous))));
  notifyChanged();
}

export async function deleteConnection(name: string) {
  await storage.set("connections", JSON.parse(JSON.stringify((await savedList()).filter((s) => s.name !== name))));
  notifyChanged();
}

export function connectionForm(
  options: { connection?: SavedConnection; type?: DbType; standalone?: boolean; name?: string } = {},
): FormSpec {
  const c = options.connection;
  return form({
    title: c ? `Edit “${c.name}”` : "New Database Connection",
    submitTitle: c ? "Save Connection" : "Add Connection",
    fields: [
      field.text("name", "Name", {
        required: true,
        placeholder: "prod-db, local cache…",
        value: c?.name ?? options.name ?? "",
      }),
      field.dropdown("type", "Type", TYPES.map((t) => ({ value: t, title: TYPE_NAMES[t] })), {
        value: c?.type ?? options.type ?? "postgres",
      }),
      field.text("host", "Host", { placeholder: "localhost", value: c?.host ?? "" }),
      field.text("port", "Port", {
        placeholder: "5432, 3306, 6379 (default for the type)",
        value: c?.port && c.port !== DEFAULT_PORTS[c.type] ? String(c.port) : "",
      }),
      field.text("database", "Database", {
        placeholder: "Database name; Redis: db number; SQLite: file path",
        value: c?.type === "sqlite" ? c.path ?? "" : c?.database ?? "",
      }),
      field.text("user", "User", { placeholder: "Optional", value: c?.user ?? "" }),
    ],
    async submit(values) {
      const next = toSaved(values as Record<string, string>, HOME);
      await saveConnection(next, c?.name);
      await toast(c ? "Connection saved" : `Added ${next.name}`, {
        style: "success",
        message: next.type === "sqlite" ? undefined : "Passwords go in the Passwords preference or ~/.pgpass",
      });
      return options.standalone ? close(`Added ${next.name}`) : pop();
    },
  });
}

// --- Live reload ------------------------------------------------------------------

const changes = new EventTarget();
export const notifyChanged = () => changes.dispatchEvent(new Event("change"));

/** Resolves on the next change, or when `signal` aborts. */
export function nextChange(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      changes.removeEventListener("change", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    changes.addEventListener("change", done);
    signal.addEventListener("abort", done);
  });
}

// --- Helpers for items -----------------------------------------------------------

export function copySecret(text: string, title: string, o: { shortcut?: string; section?: string } = {}) {
  return action(title, async () => {
    await clipboard.write(text, { concealed: true });
    return close("Copied");
  }, { icon: Icons.key, ...o });
}

export async function missingClientItem(type: DbType): Promise<Item> {
  const cmd = installCommand(type, await distro());
  return {
    id: `missing:${type}`,
    title: `No ${TYPE_NAMES[type]} client installed`,
    subtitle: cmd,
    icon: { source: Icons.alert, tint: "orange" },
    section: "Setup",
    detail: {
      markdown: [
        `Opening ${TYPE_NAMES[type]} connections needs **${CLIENTS[type].join("**, **")}**.`,
        "",
        "```sh",
        cmd,
        "```",
      ].join("\n"),
    },
    actions: [copy(cmd, "Copy Install Command", { icon: Icons.terminal })],
  };
}
