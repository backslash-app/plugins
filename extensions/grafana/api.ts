// Grafana HTTP API with a service account token, on Grafana Cloud or a self-hosted server.

import { action, copy, Icons, type Item, open, refresh } from "@backslash/api";
import { hostAllowed, normalizeUrl } from "./lib.ts";

export class SetupError extends Error {}

export interface Account {
  base: string;
  token: string;
}

export function account(preferences: Record<string, unknown>): Account {
  const base = normalizeUrl(preferences.url);
  const token = String(preferences.token ?? "").trim();
  if (!base) throw new SetupError("Add your Grafana URL and a service account token");
  if (!token) throw new SetupError("Add a Grafana service account token");
  if (!hostAllowed(new URL(base).hostname)) {
    throw new SetupError(`${new URL(base).hostname} is not a host this extension may reach`);
  }
  return { base, token };
}

export async function grafana<T>(
  a: Account,
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${a.base}${path}`, {
      method: options.method ?? "GET",
      signal: options.signal,
      headers: {
        Authorization: `Bearer ${a.token}`,
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${new URL(a.base).hostname} is not a host this extension may reach`);
    }
    throw new Error(`Cannot reach ${a.base}: ${e instanceof Error ? e.message : e}`);
  }
  if (res.status === 401) throw new SetupError("Grafana rejected the service account token");
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const message = body?.message ?? body?.error ?? "";
    if (res.status === 403) {
      throw new Error(`Grafana refused it${message ? `: ${message}` : ""}. The service account needs the Editor role`);
    }
    throw new Error(`Grafana answered ${res.status}${message ? `: ${message}` : ""}`);
  }
  if (body === undefined && text && !text.trimStart().startsWith("{")) {
    throw new SetupError(`${a.base} does not look like Grafana`);
  }
  return body as T;
}

export function setupItems(error: SetupError, base?: string): Item[] {
  return [{
    id: "setup",
    title: error.message,
    subtitle: "Grafana URL and service account token",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Grafana",
        "",
        "1. In Grafana, open **Administration → Users and access → Service accounts** and add one",
        "   (role **Viewer** to browse, **Editor** to create and expire silences).",
        "2. **Add service account token** and copy it.",
        "3. In **Settings → Extensions → Grafana → Configure**, set the URL of your stack",
        "   (`https://acme.grafana.net`) or server (`http://grafana.local:3000`) and paste the token.",
        "",
        "Reachable hosts: Grafana Cloud (`*.grafana.net`), this computer, the local network",
        "(`*.local`, `*.lan`, `*.home.arpa`, `*.internal`, private IP addresses) and Tailscale (`*.ts.net`).",
      ].join("\n"),
    },
    actions: base
      ? [open(`${base}/org/serviceaccounts`, "Open Service Accounts", { icon: Icons.key })]
      : [open("https://grafana.com/docs/grafana/latest/administration/service-accounts/", "Open Grafana Docs")],
  }];
}

export async function guarded(preferences: Record<string, unknown>, load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof SetupError) return setupItems(e, normalizeUrl(preferences.url) || undefined);
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    const message = e instanceof Error ? e.message : String(e);
    const base = normalizeUrl(preferences.url);
    return [{
      id: "error",
      title: message.startsWith("Cannot reach") ? "Grafana is unreachable" : "Grafana failed",
      subtitle: message,
      icon: { source: Icons.alert, tint: "red" },
      detail: { markdown: `\`\`\`\n${message.replace(/```/g, "ʼʼʼ")}\n\`\`\`` },
      actions: [
        action("Retry", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
        ...(base ? [open(base, "Open Grafana")] : []),
        copy(message, "Copy Error", { section: "Copy" }),
      ],
    }];
  }
}
