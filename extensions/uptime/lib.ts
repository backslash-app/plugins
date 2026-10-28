// Uptime and certificate checks: parsing openssl, classifying results, formatting. Pure, tested in lib_test.ts.

import { type Color, Icons } from "@backslash/api";

// ---------------------------------------------------------------------------
// Sites

export interface Site {
  url: string;
  /** Shown instead of the host when set. */
  name?: string;
  /** Unix ms. */
  added: number;
}

/** `example.com/x` → `https://example.com/x`; throws on something that isn't a web address. */
export function normalizeUrl(input: string): string {
  let text = String(input ?? "").trim();
  if (!text) throw new Error("Type a URL, e.g. https://example.com");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`“${input}” is not a URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http and https URLs can be watched");
  if (!url.hostname.includes(".") && url.hostname !== "localhost" && !url.hostname.startsWith("[")) {
    throw new Error(`“${url.hostname}” is not a host name`);
  }
  return url.href;
}

/** `https://www.example.com/` → `example.com`, `https://example.com/app` → `example.com/app`. */
export function displayName(site: Pick<Site, "url" | "name">): string {
  if (site.name) return site.name;
  const u = new URL(site.url);
  const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
  return `${u.host.replace(/^www\./, "")}${path}`;
}

// ---------------------------------------------------------------------------
// Results

export interface Certificate {
  subject?: string;
  issuer?: string;
  notBefore?: string;
  notAfter?: string;
  names: string[];
  /** `Verify return code` of `openssl s_client`: 0 is a trusted chain. */
  verifyCode?: number;
  verifyText?: string;
}

export interface Check {
  /** Unix ms. */
  at: number;
  /** HTTP status, absent when no answer came. */
  status?: number;
  statusText?: string;
  /** Time to the response headers. */
  ms?: number;
  /** Where redirects ended. */
  finalUrl?: string;
  error?: string;
  cert?: Certificate;
  certError?: string;
}

export interface Record_ {
  last?: Check;
  /** Recent response times (ms, or null when down), oldest first. */
  history: (number | null)[];
  /** Unix ms of the first failing check of the current outage. */
  downSince?: number;
}

export const HISTORY = 20;

/** Adds a check to a site's record. */
export function record(previous: Record_ | undefined, check: Check): Record_ {
  const down = health(check) === "down";
  const history = [...(previous?.history ?? []), down ? null : check.ms ?? null].slice(-HISTORY);
  const downSince = down ? previous?.downSince ?? check.at : undefined;
  return { last: check, history, ...(downSince ? { downSince } : {}) };
}

export type Health = "up" | "warn" | "down" | "unknown";

/** 2xx/3xx up, 4xx a warning (the site answers, the page doesn't), 5xx or no answer down. */
export function health(check: Check | undefined): Health {
  if (!check) return "unknown";
  if (check.status === undefined) return "down";
  if (check.status >= 500) return "down";
  if (check.status >= 400) return "warn";
  return "up";
}

export interface Look {
  label: string;
  color: Color;
  icon: string;
}

export function healthLook(check: Check | undefined, checking = false): Look {
  if (checking && !check) return { label: "Checking…", color: "gray", icon: Icons.dottedCircle };
  switch (health(check)) {
    case "up":
      return { label: "Up", color: "green", icon: Icons.done };
    case "warn":
      return { label: `${check!.status}`, color: "orange", icon: Icons.alert };
    case "down":
      return { label: "Down", color: "red", icon: Icons.cross };
    default:
      return { label: "Not checked", color: "gray", icon: Icons.todo };
  }
}

// ---------------------------------------------------------------------------
// openssl

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `Nov  7 12:44:37 2026 GMT` → ISO. */
export function parseOpensslDate(text: string): string | undefined {
  const m = /^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})(?:\s+GMT)?$/.exec(text.trim());
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[1]);
  if (month < 0) return undefined;
  return new Date(Date.UTC(Number(m[6]), month, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])))
    .toISOString();
}

/** The first certificate in `openssl s_client` output (the server's own). */
export function firstPem(out: string): string | undefined {
  return /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/.exec(out)?.[0];
}

/** `Verify return code: 10 (certificate has expired)`. */
export function parseVerify(out: string): { code: number; text: string } | undefined {
  const m = /Verify return code: (\d+) \(([^)]*)\)/.exec(out);
  return m ? { code: Number(m[1]), text: m[2] } : undefined;
}

/** A field of a distinguished name in either `CN = x, O = y` or `CN=x,O=y` form. */
export function dnField(dn: string | undefined, key: string): string | undefined {
  if (!dn) return undefined;
  const m = new RegExp(`(?:^|[,/]\\s*)${key}\\s*=\\s*("[^"]*"|[^,/]+)`).exec(dn);
  return m ? m[1].replace(/^"|"$/g, "").trim() : undefined;
}

/** Output of `openssl x509 -noout -subject -issuer -startdate -enddate -ext subjectAltName`. */
export function parseX509(out: string): Certificate {
  const line = (key: string) => new RegExp(`^${key}=\\s*(.*)$`, "m").exec(out)?.[1]?.trim();
  const san = /X509v3 Subject Alternative Name:\s*\n\s*(.+)/.exec(out)?.[1] ?? "";
  return {
    subject: line("subject"),
    issuer: line("issuer"),
    notBefore: parseOpensslDate(line("notBefore") ?? ""),
    notAfter: parseOpensslDate(line("notAfter") ?? ""),
    names: [...san.matchAll(/(?:DNS|IP Address):([^,\s]+)/g)].map((m) => m[1]),
  };
}

/** "Let's Encrypt (R11)", "Google Trust Services (WE1)". */
export function issuerName(cert: Certificate): string {
  const o = dnField(cert.issuer, "O");
  const cn = dnField(cert.issuer, "CN");
  if (o && cn && o !== cn) return `${o} (${cn})`;
  return o ?? cn ?? cert.issuer ?? "Unknown";
}

/** Whole days until the certificate expires (negative once expired). */
export function daysLeft(cert: Certificate | undefined, now = Date.now()): number | undefined {
  if (!cert?.notAfter) return undefined;
  return Math.floor((Date.parse(cert.notAfter) - now) / 86_400_000);
}

export function certLook(days: number | undefined, warnDays: number): Look & { short: string } {
  if (days === undefined) return { label: "No certificate", short: "", color: "gray", icon: Icons.lock };
  if (days < 0) return { label: "Expired", short: "expired", color: "red", icon: Icons.shield };
  if (days < warnDays) {
    return {
      label: `Expires in ${plural(days, "day")}`,
      short: `${days} d`,
      color: days < 7 ? "red" : "orange",
      icon: Icons.shield,
    };
  }
  return { label: `${plural(days, "day")} left`, short: `${days} d`, color: "green", icon: Icons.shield };
}

// ---------------------------------------------------------------------------
// Formatting

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function formatMs(ms: number | undefined): string {
  if (ms === undefined) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export const msColor = (ms: number | undefined, slowMs: number): Color =>
  ms === undefined ? "gray" : ms > slowMs * 2 ? "red" : ms > slowMs ? "orange" : "green";

/** "just now", "5m ago", "3h ago", "2d ago". */
export function ago(at: number | undefined, now = Date.now()): string {
  if (!at) return "never";
  const s = Math.round((now - at) / 1000);
  if (s < 30) return "just now";
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** "28 Oct 2026". */
export const day = (iso: string | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

/** A tiny bar chart of the recent response times: "▂▃▂▇▂ ✕". */
export function sparkline(history: (number | null)[]): string {
  const values = history.filter((v): v is number => v !== null);
  if (!values.length) return "";
  const max = Math.max(...values);
  const min = Math.min(...values);
  const bars = "▁▂▃▄▅▆▇█";
  return history
    .map((v) => v === null ? "✕" : bars[max === min ? 3 : Math.round(((v - min) / (max - min)) * (bars.length - 1))])
    .join("");
}

export function uptimeRatio(history: (number | null)[]): number | undefined {
  if (!history.length) return undefined;
  return history.filter((v) => v !== null).length / history.length;
}

export function average(history: (number | null)[]): number | undefined {
  const values = history.filter((v): v is number => v !== null);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
}

/** A short reason for a failed fetch: "Connection refused", "Timed out after 15 s". */
export function fetchError(e: unknown, timedOut: boolean, timeoutS: number): string {
  if (timedOut) return `No answer within ${timeoutS} s`;
  const text = e instanceof Error ? `${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}` : String(e);
  if (/certificate|UnknownIssuer|CertExpired|NotValidForName|invalid peer/i.test(text)) {
    return "TLS certificate rejected";
  }
  if (/InvalidContentType|corrupt message|wrong version number/i.test(text)) {
    return "TLS handshake failed: is it plain HTTP?";
  }
  if (/refused/i.test(text)) return "Connection refused";
  if (/dns|lookup|name or service|not known|resolve/i.test(text)) return "Host not found";
  if (/reset/i.test(text)) return "Connection reset";
  return text.split("\n")[0].replace(/^(error sending request[^:]*|fetch failed):\s*/i, "").trim() || "No answer";
}

/** Root subtitle: "1 down", "Cert expires in 5 d", "All 4 up". */
export function subtitle(
  sites: { last?: Check }[],
  warnDays: number,
  now = Date.now(),
): string | null {
  if (!sites.length) return null;
  const down = sites.filter((s) => health(s.last) === "down").length;
  if (down) return `${down} down`;
  const warn = sites.filter((s) => health(s.last) === "warn").length;
  const expiring = sites
    .map((s) => daysLeft(s.last?.cert, now))
    .filter((d): d is number => d !== undefined && d < warnDays)
    .sort((a, b) => a - b);
  if (warn) return `${warn} with errors`;
  if (expiring.length) return expiring[0] < 0 ? "Certificate expired" : `Cert expires in ${expiring[0]} d`;
  return sites.length === 1 ? "Up" : `All ${sites.length} up`;
}
