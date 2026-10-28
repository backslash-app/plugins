// Tunnels as transient systemd user units, their public URLs and the local ports to share. Pure, tested in lib_test.ts.

export type Provider = "ngrok" | "cloudflared";

export const PROVIDERS: Record<Provider, { title: string; short: string; site: string }> = {
  ngrok: { title: "ngrok", short: "ngrok", site: "https://ngrok.com" },
  cloudflared: { title: "Cloudflare Tunnel", short: "cloudflared", site: "https://try.cloudflare.com" },
};

/** ngrok agents serve their API on these ports, one per tunnel (each is in `[permissions] net`). */
export const NGROK_WEB_PORTS = [4040, 4041, 4042, 4043, 4044];

/** Ports the tunnel programs themselves listen on, never worth sharing. */
export const isTunnelPort = (port: number) => NGROK_WEB_PORTS.includes(port) || (port >= 20241 && port <= 20245);

// ---------------------------------------------------------------------------
// Units

export interface Unit {
  name: string;
  provider: Provider;
  port: number;
  /** ngrok's API port. */
  webPort?: number;
}

export const UNIT_PREFIX = "backslash-tunnel-";

export function unitName(provider: Provider, port: number, webPort?: number): string {
  return `${UNIT_PREFIX}${provider}-${port}${webPort ? `-${webPort}` : ""}`;
}

/** `backslash-tunnel-ngrok-3000-4040.service` → its provider and ports. */
export function parseUnit(name: string): Unit | undefined {
  const m = /^backslash-tunnel-(ngrok|cloudflared)-(\d+)(?:-(\d+))?(?:\.service)?$/.exec(name.trim());
  if (!m) return undefined;
  return {
    name: name.trim().replace(/\.service$/, ""),
    provider: m[1] as Provider,
    port: Number(m[2]),
    ...(m[3] ? { webPort: Number(m[3]) } : {}),
  };
}

export interface UnitState extends Unit {
  active: string;
  sub: string;
}

/** `systemctl --user list-units --all --plain --no-legend 'backslash-tunnel-*'`. */
export function parseUnits(out: string): UnitState[] {
  return out.split("\n").flatMap((line) => {
    const [name, , active, sub] = line.trim().replace(/^●\s*/, "").split(/\s+/);
    const unit = name ? parseUnit(name) : undefined;
    return unit ? [{ ...unit, active: active ?? "", sub: sub ?? "" }] : [];
  });
}

/** `systemctl show -p ActiveEnterTimestamp --value`: "Tue 2026-10-28 12:01:02 UTC" → Unix ms. */
export function parseSystemdTime(text: string): number | undefined {
  const m = /(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?: (\S+))?/.exec(text);
  if (!m) return undefined;
  const zone = m[3] && /^(UTC|GMT)$/.test(m[3]) ? "Z" : "";
  const t = Date.parse(`${m[1]}T${m[2]}${zone}`);
  return Number.isNaN(t) ? undefined : t;
}

/** The first ngrok API port no running ngrok tunnel uses. */
export function freeWebPort(units: Unit[]): number | undefined {
  const used = new Set(units.map((u) => u.webPort));
  return NGROK_WEB_PORTS.find((p) => !used.has(p));
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The command a tunnel unit runs. */
export function tunnelCommand(provider: Provider, port: number, webPort?: number): string[] {
  return provider === "ngrok"
    ? [
      "ngrok",
      "http",
      String(port),
      "--web-addr",
      `127.0.0.1:${webPort ?? 4040}`,
      "--log",
      "stdout",
      "--log-format",
      "json",
    ]
    : ["cloudflared", "tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`];
}

/**
 * `systemd-run` arguments. The command goes through `sh -c` so the user
 * manager finds it on our PATH (ngrok often lives in ~/.local/bin).
 */
export function startArgs(
  provider: Provider,
  port: number,
  env: { PATH?: string; HOME?: string },
  webPort?: number,
): string[] {
  return [
    "--user",
    "--quiet",
    `--unit=${unitName(provider, port, webPort)}`,
    `--description=Backslash tunnel: ${PROVIDERS[provider].short} :${port}`,
    "--collect",
    ...Object.entries(env).filter(([, v]) => v).map(([k, v]) => `--setenv=${k}=${v}`),
    "/bin/sh",
    "-c",
    `exec ${tunnelCommand(provider, port, webPort).map(shq).join(" ")}`,
  ];
}

// ---------------------------------------------------------------------------
// Public URLs

/** cloudflared prints `|  https://words-words.trycloudflare.com  |` once the quick tunnel exists. */
export function trycloudflareUrl(log: string): string | undefined {
  return /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(log)?.[0];
}

/** ngrok's own log, in JSON (`--log-format json`) or logfmt. */
export function ngrokLogUrl(log: string): string | undefined {
  for (const line of log.split("\n")) {
    if (!line.includes("started tunnel")) continue;
    const json = /"url":"(https?:\/\/[^"]+)"/.exec(line);
    if (json) return json[1];
    const fmt = /\burl=(https?:\/\/\S+)/.exec(line);
    if (fmt) return fmt[1];
  }
  return undefined;
}

export interface NgrokTunnel {
  publicUrl: string;
  addr: string;
  connections: number;
  requests: number;
}

/** `GET http://127.0.0.1:4040/api/tunnels`. */
export function parseNgrokApi(json: unknown): NgrokTunnel[] {
  const tunnels = (json as { tunnels?: any[] })?.tunnels ?? [];
  return tunnels
    .filter((t) => typeof t?.public_url === "string")
    .map((t) => ({
      publicUrl: t.public_url,
      addr: String(t.config?.addr ?? ""),
      connections: Number(t.metrics?.conns?.count ?? 0),
      requests: Number(t.metrics?.http?.count ?? 0),
    }))
    // https first when ngrok also opened plain http.
    .sort((a, b) => Number(b.publicUrl.startsWith("https")) - Number(a.publicUrl.startsWith("https")));
}

/** Why a tunnel didn't come up, from its log. */
export function tunnelError(provider: Provider, log: string): string | undefined {
  if (provider === "ngrok") {
    for (const line of log.split("\n").reverse()) {
      const code = /ERR_NGROK_(\d+)/.exec(line)?.[1];
      if (!code) continue;
      if (code === "4018" || code === "105") {
        return "ngrok needs your authtoken: ngrok config add-authtoken <token>";
      }
      if (code === "108") return "Your ngrok plan allows one agent at a time: stop the other ngrok tunnel first";
      const msg = /"err":"([^"]+)"/.exec(line)?.[1] ?? /err="([^"]+)"/.exec(line)?.[1] ?? line;
      return msg.replace(/\\n/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    }
    const crit = log.split("\n").reverse().find((l) => /"lvl":"(crit|eror)"|lvl=(crit|eror)/.test(l));
    if (crit) return (/"err":"([^"]+)"/.exec(crit)?.[1] ?? crit).replace(/\\n/g, " ").slice(0, 200);
    return undefined;
  }
  const err = log.split("\n").reverse().find((l) =>
    /\b(ERR|FTL)\b/.test(l) && !/Failed to initialize DNS local resolver/.test(l)
  );
  return err?.replace(/^\S+\s+(ERR|FTL)\s+/, "").trim().slice(0, 200);
}

// ---------------------------------------------------------------------------
// Local ports (same parsing as the Ports extension)

export interface Listener {
  port: number;
  address: string;
  pids: { name: string; pid: number }[];
}

/** One line of `ss -Hltnp`: `LISTEN 0 511 [::1]:3000 [::]:* users:(("node",pid=12,fd=20))`. */
export function parseSs(out: string): Listener[] {
  return out.split("\n").flatMap((line) => {
    const f = line.trim().split(/\s+/);
    if (f.length < 5) return [];
    const local = f[3];
    const i = local.lastIndexOf(":");
    const port = Number(local.slice(i + 1));
    if (!Number.isInteger(port)) return [];
    const address = local.slice(0, i).replace(/^\[|\]$/g, "").replace(/%.*$/, "");
    const pids = [...line.matchAll(/\("([^"]+)",pid=(\d+)/g)].map((m) => ({ name: m[1], pid: Number(m[2]) }));
    return [{ port, address: address === "*" ? "0.0.0.0" : address, pids }];
  });
}

export interface Shareable {
  port: number;
  process?: string;
  pid?: number;
  /** Listens on loopback only. */
  local: boolean;
}

/**
 * Ports worth sharing: one entry per port, your own processes (visible pids)
 * first, the tunnel programs' own ports left out.
 */
export function shareablePorts(listeners: Listener[]): Shareable[] {
  const byPort = new Map<number, Listener[]>();
  for (const l of listeners) {
    if (isTunnelPort(l.port) || ["ngrok", "cloudflared"].includes(l.pids[0]?.name ?? "")) continue;
    byPort.set(l.port, [...(byPort.get(l.port) ?? []), l]);
  }
  return [...byPort].map(([port, socks]) => {
    const pid = socks.flatMap((s) => s.pids)[0];
    const local = socks.every((s) => s.address.startsWith("127.") || s.address === "::1");
    return { port, process: pid?.name, pid: pid?.pid, local };
  }).sort((a, b) => Number(Boolean(b.process)) - Number(Boolean(a.process)) || a.port - b.port);
}

/** Well-known ports, to name what has no visible process. */
export const KNOWN: Record<number, string> = {
  22: "SSH",
  80: "HTTP",
  443: "HTTPS",
  631: "Printing (CUPS)",
  3000: "Dev server",
  5173: "Vite",
  5432: "PostgreSQL",
  6379: "Redis",
  8080: "HTTP",
  11434: "Ollama",
};

export function parsePort(input: unknown): number {
  const text = String(input ?? "").trim().replace(/^.*:/, "");
  const port = Number(text);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`“${input}” is not a port (1–65535)`);
  return port;
}

// ---------------------------------------------------------------------------
// Formatting

export function duration(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
}

export const subtitle = (open: number) => (open ? `${open} tunnel${open === 1 ? "" : "s"} open` : null);

export const hostOf = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Installing

export type Family = "arch" | "debian" | "fedora" | "suse";

export function osFamily(osRelease: string): Family | undefined {
  const field = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "arch";
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "debian";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "fedora";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "suse";
  return undefined;
}

export function installCommand(provider: Provider, family: Family | undefined): string {
  if (provider === "cloudflared") {
    switch (family) {
      case "arch":
        return "sudo pacman -S cloudflared";
      case "debian":
        return "curl -LO https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb && sudo dpkg -i cloudflared-linux-amd64.deb";
      case "fedora":
      case "suse":
        return "sudo rpm -i https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm";
      default:
        return "curl -Lo ~/.local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x ~/.local/bin/cloudflared";
    }
  }
  switch (family) {
    case "arch":
      return "yay -S ngrok   # AUR";
    default:
      return "sudo snap install ngrok";
  }
}
