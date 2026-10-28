// The Argo CD REST API (`/api/v1`) with a bearer token, trusting a pasted CA when given.

import { Icons, type Item, open } from "@backslash/api";
import { isCertificateError, normalizePem, normalizeUrl } from "./lib.ts";

export const TOKEN_DOCS = "https://argo-cd.readthedocs.io/en/stable/user-guide/commands/argocd_account_generate-token/";

export type SetupKind = "url" | "token" | "cert" | "down";

export class SetupError extends Error {
  constructor(message: string, readonly kind: SetupKind) {
    super(message);
  }
}

export interface Server {
  base: string;
  token: string;
  client?: Deno.HttpClient;
}

let cached: { key: string; server: Server } | undefined;

export function server(prefs: Record<string, unknown>): Server {
  let base: string;
  try {
    base = normalizeUrl(prefs.url);
  } catch {
    throw new SetupError(`“${prefs.url}” is not a web address`, "url");
  }
  const token = String(prefs.token ?? "").trim();
  if (!base) throw new SetupError("Add your Argo CD server address", "url");
  if (!token) throw new SetupError("Add an Argo CD API token", "token");
  const caText = String(prefs.caCert ?? "").trim();
  const key = `${base}\n${token}\n${caText}`;
  if (cached?.key === key) return cached.server;
  let client: Deno.HttpClient | undefined;
  if (caText) {
    const pem = normalizePem(caText);
    if (!pem) throw new SetupError("The CA certificate in Settings is not a PEM certificate", "cert");
    client = Deno.createHttpClient({ caCerts: [pem] });
  }
  const s = { base, token, client };
  cached = { key, server: s };
  return s;
}

/** A fetch error with its causes: the certificate problem is in `cause`. */
export function errorText(e: unknown): string {
  const parts: string[] = [];
  for (let x: unknown = e, i = 0; x && i < 5; x = (x as { cause?: unknown }).cause, i++) {
    parts.push(x instanceof Error ? x.message : String(x));
  }
  return parts.join(": ");
}

export async function argo<T>(
  s: Server,
  path: string,
  o: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${s.base}${path}`, {
      method: o.method ?? "GET",
      headers: {
        Authorization: `Bearer ${s.token}`,
        Accept: "application/json",
        ...(o.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: o.signal,
      client: s.client,
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    const message = errorText(e);
    if (isCertificateError(message)) {
      throw new SetupError(
        s.client
          ? "The server's certificate isn't signed by the CA in Settings"
          : "The server's certificate is not trusted: paste its CA in Settings",
        "cert",
      );
    }
    throw new SetupError(`Can't reach Argo CD at ${new URL(s.base).host}`, "down");
  }
  const text = await res.text();
  let body: { message?: string; error?: string } | undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (res.status === 401) throw new SetupError("Argo CD refused the token: it may have expired", "token");
  if (!res.ok) {
    const msg = body?.message ?? body?.error ?? "";
    if (res.status === 403) {
      throw new Error(`Argo CD denied it${msg ? `: ${msg}` : ""}. The account's RBAC role needs that permission`);
    }
    if (!body && /<html/i.test(text)) {
      throw new SetupError(`${new URL(s.base).host} answered with a web page, not the Argo CD API`, "url");
    }
    throw new Error(`Argo CD answered ${res.status}${msg ? `: ${msg}` : ""}`);
  }
  if (!body && text && /<html/i.test(text)) {
    throw new SetupError(`${new URL(s.base).host} answered with a web page, not the Argo CD API`, "url");
  }
  return body as T;
}

export function setupItems(error: SetupError): Item[] {
  const icons: Record<SetupKind, string> = {
    url: Icons.link,
    token: Icons.key,
    cert: Icons.lock,
    down: Icons.wifiOff,
  };
  return [{
    id: "setup",
    title: error.message,
    subtitle: error.kind === "down" ? "Is the server up, or the port-forward running?" : "Check it in Settings",
    icon: { source: icons[error.kind], tint: "orange" },
    detail: {
      markdown: [
        "## Connect Argo CD",
        "",
        "In **Settings → Extensions → Argo CD → Configure**:",
        "",
        "- **Server address**: the address of the web UI, `https://argocd.example.com`, or",
        "  `https://localhost:8080` with `kubectl port-forward svc/argocd-server -n argocd 8080:443`",
        "- **API token**: for an account with the `apiKey` capability",
        "  (`accounts.<name>: apiKey` in `argocd-cm`), generate it in **Settings → Accounts** or with",
        "  `argocd account generate-token --account <name>`. It needs `applications, get` and, to act,",
        "  `applications, sync` and `applications, action` in `argocd-rbac-cm`.",
        "- **CA certificate**: for a private or self-signed certificate, paste the CA (PEM).",
      ].join("\n"),
    },
    actions: [open(TOKEN_DOCS, "Open Token Documentation", { icon: Icons.key })],
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
