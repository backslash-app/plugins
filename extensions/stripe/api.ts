// Stripe REST API with a secret or (better) restricted key from the preferences.

import { Icons, type Item, open } from "@backslash/api";

export const KEYS_URL = "https://dashboard.stripe.com/apikeys";
/** Pinned so responses keep one shape; newer fields are read when present too. */
const STRIPE_VERSION = "2024-06-20";

export class AuthError extends Error {}

export type Mode = "test" | "live";

export interface Account {
  key: string;
  mode: Mode;
  restricted: boolean;
}

/** `sk_test_…`, `rk_live_…`: secret or restricted, test or live. Publishable keys can't read anything. */
export function account(preferences: Record<string, unknown>): Account {
  const key = String(preferences.secretKey ?? "").trim();
  if (!key) throw new AuthError("Add a Stripe API key");
  const m = /^(sk|rk|pk)_(test|live)_[A-Za-z0-9]+$/.exec(key);
  if (!m) throw new AuthError("This doesn't look like a Stripe key (sk_… or rk_…)");
  if (m[1] === "pk") throw new AuthError("That's a publishable key: use a restricted key (rk_…) instead");
  return { key, mode: m[2] as Mode, restricted: m[1] === "rk" };
}

/** `https://dashboard.stripe.com/test/payments/pi_…` in test mode, without `/test` in live mode. */
export const dashboard = (a: Pick<Account, "mode">, path: string) =>
  `https://dashboard.stripe.com${a.mode === "test" ? "/test" : ""}/${path.replace(/^\//, "")}`;

/** Stripe's form encoding: `expand[]=a`, `metadata[k]=v`. */
export function encode(params: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(params).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) return [];
    if (Array.isArray(v)) return v.map((x) => `${encodeURIComponent(`${key}[]`)}=${encodeURIComponent(String(x))}`);
    if (typeof v === "object") return encode(v as Record<string, unknown>, key);
    return [`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`];
  });
}

/** Restricted keys say which permission they lack: "Having the 'rak_charge_read' permission would allow…". */
export function permissionHint(message: string): string | undefined {
  const perm = /'(rak_[a-z_]+)'/.exec(message)?.[1];
  if (!perm) return undefined;
  const [, resource, level] = /^rak_(.+)_(read|write)$/.exec(perm) ?? [];
  if (!resource) return undefined;
  const name = resource.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  return `Your restricted key needs “${name}: ${level === "write" ? "Write" : "Read"}”`;
}

export async function stripe<T>(
  a: Account,
  path: string,
  o: { params?: Record<string, unknown>; method?: "GET" | "POST"; signal?: AbortSignal; idempotencyKey?: string } = {},
): Promise<T> {
  const query = o.params ? encode(o.params).join("&") : "";
  const post = o.method === "POST";
  const res = await fetch(`https://api.stripe.com/v1${path}${!post && query ? `?${query}` : ""}`, {
    method: o.method ?? "GET",
    signal: o.signal,
    headers: {
      Authorization: `Bearer ${a.key}`,
      "Stripe-Version": STRIPE_VERSION,
      ...(post ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(o.idempotencyKey ? { "Idempotency-Key": o.idempotencyKey } : {}),
    },
    body: post ? query : undefined,
  });
  const body = await res.json().catch(() => undefined) as { error?: { message?: string; code?: string } } | undefined;
  if (res.status === 401) throw new AuthError("Stripe rejected the API key");
  if (!res.ok) {
    const message = body?.error?.message ?? `Stripe answered ${res.status}`;
    if (res.status === 403) throw new Error(permissionHint(message) ?? message);
    throw new Error(message);
  }
  return body as T;
}

export interface Page<T> {
  object: "list" | "search_result";
  data: T[];
  has_more: boolean;
}

export function setupItems(error: AuthError): Item[] {
  return [{
    id: "setup",
    title: error.message,
    subtitle: "A restricted key with read access is enough",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Stripe",
        "",
        "1. In the Stripe Dashboard, **Developers → API keys → Create restricted key** (Enter opens it).",
        "   Toggle **Test mode** first to try it on test data.",
        "2. Give it **Read** access to:",
        "   - **Charges** and **PaymentIntents** (payments)",
        "   - **Customers**",
        "   - **Subscriptions**, **Products** and **Prices**",
        "   - **Balance** and **Payouts**",
        "3. Only if you want to refund from here, also give **Refunds: Write**.",
        "4. Paste the key (`rk_test_…` or `rk_live_…`) in **Settings → Extensions → Stripe → Configure**.",
        "",
        "A secret key (`sk_…`) works too, but it can do everything on your account: a read-only",
        "restricted key can't move money even if it leaks.",
      ].join("\n"),
    },
    actions: [open(KEYS_URL, "Create Restricted Key", { icon: Icons.key })],
  }];
}

export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof AuthError) return setupItems(e);
    throw e;
  }
}
