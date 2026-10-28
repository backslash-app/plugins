// Sonarr, Radarr and Lidarr with their API keys (X-Api-Key), and posters
// cached on disk: the launcher shows pictures only from exact hosts, and the
// apps' own covers need the key.

import { Icons, type Item, open } from "@backslash/api";
import { APPS, errorMessageOf, isAllowedHost, type Kind, normalizeUrl } from "./lib.ts";

export class SetupError extends Error {
  constructor(message: string, readonly kind: "none" | "key" | "host" | "down" | "url", readonly app?: App) {
    super(message);
  }
}

export interface App {
  kind: Kind;
  title: string;
  base: string;
  key: string;
}

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The apps with an address and an API key in Settings. */
export function apps(preferences: Record<string, unknown>): App[] {
  const out: App[] = [];
  for (const kind of Object.keys(APPS) as Kind[]) {
    const raw = String(preferences[`${kind}Url`] ?? "").trim();
    const key = String(preferences[`${kind}Key`] ?? "").trim();
    if (!raw && !key) continue;
    const title = APPS[kind].title;
    const base = normalizeUrl(raw, kind);
    if (!base) throw new SetupError(`Add the address of ${title}, or remove its API key`, "url");
    let host: string;
    try {
      host = new URL(base).hostname;
    } catch {
      throw new SetupError(`“${raw}” is not a ${title} address`, "url");
    }
    const app = { kind, title, base, key };
    if (!isAllowedHost(host)) {
      throw new SetupError(`${host} is outside the networks this extension may reach`, "host", app);
    }
    if (!key) throw new SetupError(`Add the API key of ${title}: Settings → General → Security`, "key", app);
    out.push(app);
  }
  if (!out.length) throw new SetupError("Connect Sonarr, Radarr or Lidarr", "none");
  return out;
}

export async function api<T>(
  app: App,
  path: string,
  o: { method?: string; body?: unknown; signal?: AbortSignal; query?: Record<string, string | number | boolean> } = {},
): Promise<T> {
  const qs = o.query ? `?${new URLSearchParams(Object.entries(o.query).map(([k, v]) => [k, String(v)]))}` : "";
  const url = `${app.base}${APPS[app.kind].api}${path}${qs}`;
  const timeout = AbortSignal.timeout(20_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: o.method ?? "GET",
      signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout,
      headers: {
        "X-Api-Key": app.key,
        Accept: "application/json",
        ...(o.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(
        `${new URL(app.base).hostname} is outside the networks this extension may reach`,
        "host",
        app,
      );
    }
    throw new SetupError(`Can't reach ${app.title} at ${new URL(app.base).host}: ${describe(e)}`, "down", app);
  }
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel();
    throw new SetupError(`${app.title} refused the API key: check it in Settings`, "key", app);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail: string | undefined;
    try {
      detail = errorMessageOf(JSON.parse(text));
    } catch {
      detail = text.trim().slice(0, 160) || undefined;
    }
    if (res.status === 404 && !detail) {
      throw new SetupError(`${app.title} has no API at ${app.base}: check the address (and URL base)`, "url", app);
    }
    throw new Error(`${app.title} answered ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  if (res.status === 204 || res.headers.get("content-length") === "0") return undefined as T;
  const text = await res.text();
  if (/^\s*</.test(text)) {
    throw new SetupError(`${app.base} answers, but not as ${app.title}: check the address`, "url", app);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Runs `load` for every app, keeping going when one fails; returns what worked and the errors. */
export async function each<T>(
  list: App[],
  load: (app: App) => Promise<T>,
): Promise<{ ok: [App, T][]; errors: Error[] }> {
  const results = await Promise.allSettled(list.map(load));
  const ok: [App, T][] = [];
  const errors: Error[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") ok.push([list[i], r.value]);
    else errors.push(r.reason instanceof Error ? r.reason : new Error(String(r.reason)));
  });
  return { ok, errors };
}

// ---------------------------------------------------------------------------
// Posters

const home = () => {
  try {
    return Deno.env.get("HOME") ?? "";
  } catch {
    return "";
  }
};
export const cacheDir = () => `${home()}/.cache/backslash/arr`;

async function hash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function exists(path: string) {
  try {
    return (await Deno.stat(path)).size > 0;
  } catch {
    return false;
  }
}

/**
 * Posters (`/api/v3/mediacover/<id>/poster-250.jpg`, which needs the key) as
 * files: those cached at once, the others downloaded until `deadline` ms.
 */
export async function posters(
  wanted: { app: App; path: string }[],
  o: { deadline?: number; signal?: AbortSignal } = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!home()) return out;
  await Deno.mkdir(cacheDir(), { recursive: true }).catch(() => {});
  const missing: { key: string; file: string; app: App; path: string }[] = [];
  const seen = new Set<string>();
  for (const w of wanted) {
    const key = `${w.app.base}${w.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const file = `${cacheDir()}/${await hash(key)}.jpg`;
    if (await exists(file)) out.set(key, file);
    else missing.push({ key, file, app: w.app, path: w.path });
  }
  const until = Date.now() + (o.deadline ?? 2500);
  const worker = async () => {
    while (missing.length && Date.now() < until && !o.signal?.aborted) {
      const m = missing.shift()!;
      try {
        const res = await fetch(`${m.app.base}${APPS[m.app.kind].api}${m.path}`, {
          headers: { "X-Api-Key": m.app.key },
          signal: AbortSignal.timeout(Math.max(500, until - Date.now())),
        });
        if (!res.ok || !(res.headers.get("content-type") ?? "image/").startsWith("image/")) {
          await res.body?.cancel();
          continue;
        }
        const data = new Uint8Array(await res.arrayBuffer());
        if (data.length < 100 || data.length > 4_000_000) continue;
        await Deno.writeFile(`${m.file}.tmp`, data);
        await Deno.rename(`${m.file}.tmp`, m.file);
        out.set(m.key, m.file);
      } catch {
        // Shown without a poster this time.
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

export const posterKey = (app: App, path: string) => `${app.base}${path}`;

// ---------------------------------------------------------------------------
// Setup

const CONFIGURE = "**Settings → Extensions → Sonarr & Radarr → Configure**";

export function setupItem(e: SetupError): Item {
  const md: Record<SetupError["kind"], string[]> = {
    none: [
      "## Connect your *arr apps",
      "",
      `In ${CONFIGURE}, fill the address and API key of each app you use:`,
      "",
      "- **Sonarr**, e.g. `http://nas.local:8989`",
      "- **Radarr**, e.g. `http://nas.local:7878`",
      "- **Lidarr** (optional), e.g. `http://nas.local:8686`",
      "",
      "The API key is in each app under **Settings → General → Security**.",
    ],
    key: [
      "## Check the API key",
      "",
      `Copy it from **Settings → General → Security → API Key** in ${
        e.app?.title ?? "the app"
      }, then paste it in ${CONFIGURE}.`,
    ],
    host: [
      "## Address not reachable from Backslash",
      "",
      "Extensions declare the hosts they may reach. This one covers this computer, local names (`*.local`, `*.lan`, `*.home`, `*.home.arpa`, `*.internal`, `sonarr`, `radarr`, `lidarr`), private networks (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`) and Tailscale (`100.64.x.x`, `*.ts.net`).",
      "",
      `Use the server's local IP address in ${CONFIGURE}.`,
    ],
    down: [
      `## ${e.app?.title ?? "The app"} doesn't answer`,
      "",
      `Check that it is running and opens at \`${e.app?.base ?? "http://…"}\`. The address is in ${CONFIGURE}.`,
    ],
    url: [
      "## Check the address",
      "",
      `Use the address you open in the browser, with the URL base if you set one (\`http://nas.local:8989/sonarr\`), in ${CONFIGURE}.`,
    ],
  };
  return {
    id: `setup:${e.app?.kind ?? e.kind}`,
    title: e.message,
    subtitle: e.app?.title ?? "Sonarr, Radarr, Lidarr",
    icon: { source: e.kind === "key" ? Icons.key : Icons.plug, tint: "orange" },
    section: "Setup",
    detail: { markdown: md[e.kind].join("\n") },
    actions: e.app && e.kind !== "host" ? [open(e.app.base, `Open ${e.app.title}`, { icon: Icons.globe })] : [],
  };
}

/** Errors as rows; non-setup errors keep their message. */
export function errorItems(errors: Error[]): Item[] {
  return errors.map((e) =>
    e instanceof SetupError ? setupItem(e) : {
      id: `error:${e.message}`,
      title: e.message,
      icon: { source: Icons.alert, tint: "red" },
      section: "Setup",
    }
  );
}
