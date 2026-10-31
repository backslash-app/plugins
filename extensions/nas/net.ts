// Reaching a NAS on the local network: allowed hosts, addresses, certificates and errors.

/**
 * As declared in `[permissions] net` (kept equal by a test): the usual NAS
 * names, local names, private IPv4 ranges (Deno's --allow-net accepts CIDR)
 * and Tailscale. A NAS on a public domain is out of reach.
 */
export const HOSTS = [
  "localhost",
  "127.0.0.1",
  "truenas",
  "tower",
  "*.local",
  "*.lan",
  "*.home",
  "*.home.arpa",
  "*.internal",
  "*.ts.net",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
];

function ipv4(host: string): number | undefined {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return undefined;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

/** Whether Deno's `--allow-net` with {@link HOSTS} lets us reach `host`. */
export function isAllowedHost(host: string, patterns = HOSTS): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return patterns.some((p) => {
    if (p.startsWith("*.")) return h.endsWith(p.slice(1)) || h === p.slice(2);
    const cidr = /^([\d.]+)\/(\d+)$/.exec(p);
    if (cidr) {
      const ip = ipv4(h), net = ipv4(cidr[1]);
      if (ip === undefined || net === undefined) return false;
      const bits = Number(cidr[2]);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((ip & mask) >>> 0) === ((net & mask) >>> 0);
    }
    return h === p;
  });
}

/** `192.168.1.1/` → `http://192.168.1.1` (or `https://` when `scheme` says so). */
export function normalizeUrl(input: unknown, scheme = "http"): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `${scheme}://${url}`;
  return url.replace(/\/+$/, "");
}

/** Pasted PEM text, whatever happened to its line breaks, as a clean PEM. */
export function normalizePem(text: unknown): string | undefined {
  const blocks = [...String(text ?? "").matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)];
  if (!blocks.length) return undefined;
  return blocks.map((m) => {
    const lines = m[1].replace(/\s+/g, "").match(/.{1,64}/g) ?? [];
    return ["-----BEGIN CERTIFICATE-----", ...lines, "-----END CERTIFICATE-----"].join("\n");
  }).join("\n") + "\n";
}

/** A fetch error with its causes: the certificate problem is in `cause`. */
export function errorText(e: unknown): string {
  const parts: string[] = [];
  for (let x: unknown = e, i = 0; x && i < 5; x = (x as { cause?: unknown }).cause, i++) {
    parts.push(x instanceof Error ? x.message : String(x));
  }
  return parts.join(": ");
}

export const isCertificateError = (message: string) =>
  /certificate|UnknownIssuer|self[- ]signed|NotValidForName|invalid peer|tls handshake|ssl/i.test(message);

export type SetupKind = "url" | "auth" | "host" | "tls" | "down" | "unknown" | "permission";

export class SetupError extends Error {
  constructor(message: string, readonly kind: SetupKind, readonly base?: string) {
    super(message);
  }
}

/** Checks an address preference: normalized, parsed, reachable with our permissions. */
export function checkBase(input: unknown, what: string, scheme = "http"): string {
  const base = normalizeUrl(input, scheme);
  if (!base) throw new SetupError(`Add the address of your ${what}`, "url");
  let host: string;
  try {
    host = new URL(base).hostname;
  } catch {
    throw new SetupError(`“${input}” is not an address`, "url");
  }
  if (!isAllowedHost(host)) {
    throw new SetupError(`${host} is outside the networks this extension may reach`, "host", base);
  }
  return base;
}

/** An HTTP client trusting a pasted certificate (self-signed HTTPS), or the default one. */
export function httpClient(pem: unknown): Deno.HttpClient | undefined {
  const clean = normalizePem(pem);
  if (String(pem ?? "").trim() && !clean) {
    throw new SetupError("The pasted certificate is not a PEM certificate", "tls");
  }
  return clean ? Deno.createHttpClient({ caCerts: [clean] }) : undefined;
}

/** `fetch`, with network failures turned into what to do about them. */
export async function request(
  url: string,
  init: RequestInit & { client?: Deno.HttpClient },
  service: string,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    if (init.signal?.aborted) throw e;
    const base = new URL(url).origin;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${new URL(url).hostname} is outside the networks this extension may reach`, "host", base);
    }
    if (isCertificateError(errorText(e))) {
      throw new SetupError(`${service}'s HTTPS certificate isn't trusted`, "tls", base);
    }
    throw new SetupError(`Can't reach ${service} at ${new URL(url).host}`, "down", base);
  }
}

/** The error message of a JSON or text body, for "answered 500: …". */
export async function failureDetail(res: Response): Promise<string> {
  try {
    const text = (await res.text()).trim();
    try {
      const body = JSON.parse(text);
      return String(body?.msg ?? body?.message ?? body?.error?.message ?? body?.error ?? "").slice(0, 200);
    } catch {
      return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    }
  } catch {
    return "";
  }
}
