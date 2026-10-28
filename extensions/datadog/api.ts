// Datadog API with an API key and an application key, on the site of the preferences.

import { Icons, type Item, open } from "@backslash/api";
import { findSite, type Site, SITES } from "./lib.ts";

/** The hosts of `[permissions] net` (kept equal by a test). */
export const HOSTS = SITES.map((s) => s.api);

export class SetupError extends Error {}

export interface Account {
  site: Site;
  apiKey: string;
  appKey: string;
}

export function account(prefs: Record<string, unknown>): Account {
  const site = findSite(prefs.site);
  if (!site) {
    throw new SetupError(
      `“${prefs.site}” is not a Datadog site: use datadoghq.com, us3.datadoghq.com, us5.datadoghq.com, datadoghq.eu, ap1.datadoghq.com or ddog-gov.com`,
    );
  }
  const apiKey = String(prefs.apiKey ?? "").trim();
  const appKey = String(prefs.appKey ?? "").trim();
  if (!apiKey || !appKey) throw new SetupError("Add your Datadog API key and application key");
  return { site, apiKey, appKey };
}

export const appUrl = (a: Account, path: string) => `https://${a.site.app}${path}`;

export async function dd<T>(
  a: Account,
  path: string,
  o: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`https://${a.site.api}${path}`, {
      method: o.method ?? "GET",
      headers: {
        "DD-API-KEY": a.apiKey,
        "DD-APPLICATION-KEY": a.appKey,
        Accept: "application/json",
        ...(o.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: o.signal,
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    throw new Error(`Can't reach Datadog (${a.site.api})`);
  }
  const text = await res.text();
  let body: { errors?: unknown[] } | undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  const detail = (body?.errors ?? []).map((e) =>
    typeof e === "string"
      ? e
      : String((e as { detail?: string; title?: string }).detail ?? (e as { title?: string }).title ?? "")
  ).filter(Boolean).join("; ");
  if (res.status === 401) {
    throw new SetupError(`Datadog refused the keys on ${a.site.id}: check them, and that the site is yours`);
  }
  if (res.status === 403) {
    if (/api key/i.test(detail)) throw new SetupError("Datadog refused the API key: check it in Settings");
    throw new Error(
      `Datadog denied it${detail ? `: ${detail}` : ""}. The application key may be scoped without this permission`,
    );
  }
  if (!res.ok) throw new Error(`Datadog answered ${res.status}${detail ? `: ${detail}` : ""}`);
  return body as T;
}

export function setupItems(error: SetupError): Item[] {
  return [{
    id: "setup",
    title: error.message,
    subtitle: "Site, API key and application key",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Datadog",
        "",
        "In **Settings → Extensions → Datadog → Configure**, set:",
        "",
        "- **Site**: the domain of your Datadog URL (`datadoghq.com`, `us3.datadoghq.com`, `us5.datadoghq.com`,",
        "  `datadoghq.eu`, `ap1.datadoghq.com` or `ddog-gov.com`)",
        "- **API key**: Organization Settings → API Keys",
        "- **Application key**: Organization Settings → Application Keys. A scoped key needs `monitors_read`,",
        "  `monitors_downtime`, `dashboards_read` and `incident_read`.",
      ].join("\n"),
    },
    actions: [
      open("https://app.datadoghq.com/organization-settings/application-keys", "Open Application Keys (US1)", {
        icon: Icons.key,
      }),
      open("https://docs.datadoghq.com/getting_started/site/", "Which Site Am I On?", { icon: Icons.question }),
    ],
  }];
}

export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof SetupError) return setupItems(e);
    throw e;
  }
}
