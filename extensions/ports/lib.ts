// Parsing `ss -Hltnp`. Pure, tested in lib_test.ts.

export interface Listener {
  port: number;
  address: string;
  /** Owning processes, when visible to us. */
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

/** Only reachable from this machine? */
export const isLocal = (address: string) => address.startsWith("127.") || address === "::1" || address === "localhost";

/** One entry per port: IPv4 and IPv6 sockets of the same port are merged. */
export function byPort(listeners: Listener[]): Map<number, Listener[]> {
  const map = new Map<number, Listener[]>();
  for (const l of listeners) map.set(l.port, [...(map.get(l.port) ?? []), l]);
  return new Map([...map].sort((a, b) => a[0] - b[0]));
}

/** Well-known ports, to name what has no visible process. */
export const KNOWN: Record<number, string> = {
  22: "SSH",
  53: "DNS",
  80: "HTTP",
  443: "HTTPS",
  631: "Printing (CUPS)",
  3306: "MySQL",
  5432: "PostgreSQL",
  5900: "VNC",
  6379: "Redis",
  8384: "Syncthing",
  9090: "Cockpit",
  11434: "Ollama",
  27017: "MongoDB",
};
