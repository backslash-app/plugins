// Proxmox VE API shapes, formatting and URLs. No I/O here.

import type { Color } from "@backslash/api";
import { Icons } from "@backslash/api";

/** One row of `GET /cluster/resources`. */
export interface Resource {
  id: string;
  type: "node" | "qemu" | "lxc" | "storage" | "pool" | "sdn" | string;
  node?: string;
  vmid?: number;
  name?: string;
  status?: string;
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  uptime?: number;
  template?: number;
  tags?: string;
  netin?: number;
  netout?: number;
  diskread?: number;
  diskwrite?: number;
  hastate?: string;
  lock?: string;
  level?: string;
  pool?: string;
  storage?: string;
}

/** `GET /nodes/{node}/status`. */
export interface NodeStatus {
  pveversion?: string;
  kversion?: string;
  loadavg?: string[];
  cpuinfo?: { model?: string; cpus?: number; sockets?: number; cores?: number };
  memory?: { used: number; total: number };
  swap?: { used: number; total: number };
  rootfs?: { used: number; total: number };
  uptime?: number;
}

export interface Snapshot {
  name: string;
  description?: string;
  snaptime?: number;
  parent?: string;
  vmstate?: number;
  running?: number;
}

export type Guest = Resource & { type: "qemu" | "lxc"; vmid: number; node: string };

export const isGuest = (r: Resource): r is Guest =>
  (r.type === "qemu" || r.type === "lxc") && typeof r.vmid === "number" && !!r.node;

// ---------------------------------------------------------------------------
// Formatting

export function bytes(n: number | undefined): string {
  if (!n || n < 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${i === 0 ? v : v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function uptime(seconds: number | undefined): string {
  if (!seconds) return "–";
  const d = Math.floor(seconds / 86_400), h = Math.floor(seconds % 86_400 / 3600), m = Math.floor(seconds % 3600 / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${Math.max(1, m)} min`;
}

export const pct = (ratio: number) => `${Math.round(ratio * 100)} %`;

export const ratio = (used: number | undefined, total: number | undefined) =>
  total ? Math.max(0, Math.min(1, (used ?? 0) / total)) : 0;

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Proxmox tags are `a;b` (or `a,b` / spaces in older versions). */
export const tagsOf = (r: Resource) => (r.tags ?? "").split(/[;,\s]+/).filter(Boolean);

export const kindTitle = (r: Resource) => r.type === "lxc" ? "Container" : "Virtual Machine";

export const guestName = (g: Guest) => g.name || `${g.type === "lxc" ? "CT" : "VM"} ${g.vmid}`;

export interface Look {
  label: string;
  tint: Color;
  icon: string;
}

export function guestLook(g: Guest): Look {
  const glyph = g.type === "lxc" ? Icons.box : Icons.monitor;
  if (g.template) return { label: "Template", tint: "gray", icon: Icons.layers };
  if (g.lock) return { label: `Locked (${g.lock})`, tint: "orange", icon: Icons.lock };
  switch (g.status) {
    case "running":
      return { label: "Running", tint: "green", icon: glyph };
    case "paused":
    case "suspended":
      return { label: "Paused", tint: "yellow", icon: glyph };
    case "stopped":
      return { label: "Stopped", tint: "gray", icon: glyph };
    default:
      return {
        label: g.status ? g.status[0].toUpperCase() + g.status.slice(1) : "Unknown",
        tint: "orange",
        icon: glyph,
      };
  }
}

export function nodeLook(n: Resource): Look {
  return n.status === "online"
    ? { label: "Online", tint: "green", icon: Icons.server }
    : { label: n.status === "offline" ? "Offline" : (n.status ?? "Unknown"), tint: "red", icon: Icons.server };
}

export type Filter = "running" | "stopped" | "all";

export function matches(r: Resource, filter: string | undefined): boolean {
  if (r.type === "node") return filter !== "stopped";
  if (!isGuest(r)) return false;
  if (filter === "running") return r.status === "running";
  if (filter === "stopped") return r.status !== "running" && !r.template;
  return true;
}

export function sectionOf(r: Resource): string {
  if (r.type === "node") return "Nodes";
  if (r.template) return "Templates";
  return r.type === "lxc" ? "Containers" : "Virtual Machines";
}

const SECTIONS = ["Nodes", "Virtual Machines", "Containers", "Templates"];

/** Nodes, VMs, containers, templates; running first, then by VMID. */
export function sortResources(rs: Resource[]): Resource[] {
  return [...rs].sort((a, b) =>
    SECTIONS.indexOf(sectionOf(a)) - SECTIONS.indexOf(sectionOf(b)) ||
    Number(b.status === "running" || b.status === "online") - Number(a.status === "running" || a.status === "online") ||
    (a.vmid ?? 0) - (b.vmid ?? 0) ||
    (a.node ?? "").localeCompare(b.node ?? "")
  );
}

/** "5 of 8 running" for the root search. */
export function summary(rs: Resource[]): string | null {
  const guests = rs.filter(isGuest).filter((g) => !g.template);
  if (!guests.length) return null;
  const running = guests.filter((g) => g.status === "running").length;
  return `${running} of ${guests.length} running`;
}

// ---------------------------------------------------------------------------
// URLs

/** `pve.local` → `https://pve.local:8006`; drops a path or `#v1:…` hash. */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const u = new URL(url);
    if (!u.port && u.protocol === "https:" && !/^https:\/\/[^/]+:443\b/.test(url)) u.port = "8006";
    return `${u.protocol}//${u.host}`;
  } catch {
    return url.replace(/\/+$/, "");
  }
}

/** The noVNC (VM) or xterm.js (container, node shell) console the web UI opens in a pop-up. */
export function consoleUrl(base: string, r: Resource): string {
  const p = new URLSearchParams();
  if (r.type === "node") {
    p.set("console", "shell");
    p.set("xtermjs", "1");
    p.set("vmid", "0");
    p.set("vmname", "");
    p.set("node", r.node ?? r.name ?? "");
  } else {
    p.set("console", r.type === "lxc" ? "lxc" : "kvm");
    p.set(r.type === "lxc" ? "xtermjs" : "novnc", "1");
    p.set("vmid", String(r.vmid));
    p.set("vmname", r.name ?? "");
    p.set("node", r.node ?? "");
    if (r.type !== "lxc") p.set("resize", "off");
  }
  p.set("cmd", "");
  return `${base}/?${p}`;
}

/** The resource selected in the web UI's tree. */
export function webUrl(base: string, r: Resource): string {
  return `${base}/#v1:0:=${encodeURIComponent(r.id)}:4:::::::`;
}

export const TOKEN_DOCS = "https://pve.proxmox.com/wiki/User_Management#pveum_tokens";

/** `PVEAPIToken=root@pam!backslash=xxxxxxxx-…`. */
export function authHeader(tokenId: string, secret: string): string {
  return `PVEAPIToken=${tokenId.trim()}=${secret.trim()}`;
}

export const isTokenId = (id: string) => /^[^@\s]+@[^!\s]+![\w.-]+$/.test(id.trim());

// ---------------------------------------------------------------------------
// Certificates

/**
 * A PEM certificate from what the user gave: the file's text, or the same
 * pasted into a one-line field (newlines lost).
 */
export function normalizePem(text: string): string | undefined {
  const blocks = [...text.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)];
  if (!blocks.length) return undefined;
  return blocks.map((m) => {
    const body = m[1].replace(/\s+/g, "");
    const lines = body.match(/.{1,64}/g) ?? [];
    return ["-----BEGIN CERTIFICATE-----", ...lines, "-----END CERTIFICATE-----"].join("\n");
  }).join("\n") + "\n";
}

export const isCertificateError = (message: string) =>
  /certificate|UnknownIssuer|self[- ]signed|NotValidForName|invalid peer|tls|ssl/i.test(message);

export function expandHome(path: string, home: string | undefined): string {
  if (!home) return path;
  return path === "~" ? home : path.startsWith("~/") ? `${home}${path.slice(1)}` : path;
}

export function snapshotTime(s: Snapshot): string {
  if (!s.snaptime) return "";
  return new Date(s.snaptime * 1000).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
}

/** Newest first, without the "current" pseudo-snapshot ("You are here"). */
export function sortSnapshots(list: Snapshot[]): Snapshot[] {
  return list.filter((s) => s.name !== "current").sort((a, b) => (b.snaptime ?? 0) - (a.snaptime ?? 0));
}

/** Proxmox snapshot names: a letter, then letters, digits, `-` and `_`, up to 40. */
export function snapshotName(input: string, now = new Date()): string {
  const clean = input.trim().replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^[^A-Za-z]+/, "").slice(0, 40);
  if (clean) return clean;
  const p = (n: number) => String(n).padStart(2, "0");
  return `backslash_${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${
    p(now.getMinutes())
  }`;
}
