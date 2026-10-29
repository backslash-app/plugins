// Certificate rows and their preview, shared by the commands; the rows shown
// when openssl or mkcert is missing.

import {
  type Action,
  action,
  copy,
  detail,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  refresh,
} from "@backslash/api";
import {
  type Cert,
  certName,
  covers,
  daysLeft,
  expiryText,
  HEALTH,
  health,
  isMkcert,
  issuerName,
  selfSigned,
  tildify,
} from "./lib.ts";
import { HOME, type Loaded, MissingTool } from "./system.ts";

export const warnDaysOf = (p: Record<string, unknown>) => {
  const n = Number(p.warnDays);
  return Number.isFinite(n) && n > 0 ? n : 30;
};

const date = (d?: Date) => d?.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) ?? "";

export interface CertOptions {
  id: string;
  section?: string;
  /** "Server", "Intermediate", "Root" in a chain. */
  role?: string;
  /** The file it was read from. */
  path?: string;
  /** The host it was served for, to check the names. */
  host?: string;
  hasKey?: boolean;
  warnDays: number;
  extra?: Metadata[];
  actions?: Action[];
}

export function certMetadata(l: Loaded, o: CertOptions): Metadata[] {
  const c = l.cert;
  const h = HEALTH[health(c, o.warnDays)];
  return [
    meta.text("Status", h.title, { icon: Icons.shield, color: h.color }),
    ...(c.notAfter ? [meta.text("Expires", `${date(c.notAfter)} (${expiryText(c)})`, { icon: Icons.calendar })] : []),
    ...(c.notBefore ? [meta.text("Valid from", date(c.notBefore), { icon: Icons.clock })] : []),
    ...(o.host
      ? [meta.text("Host name", covers(c, o.host) ? `Covers ${o.host}` : `Does not cover ${o.host}`, {
        icon: Icons.globe,
        color: covers(c, o.host) ? "green" : "red",
      })]
      : []),
    ...(o.extra ?? []),
    meta.separator(),
    meta.text("Subject", c.subject || "(empty)", { icon: Icons.person }),
    meta.text("Issuer", selfSigned(c) ? `${issuerName(c)} (self-signed)` : issuerName(c), { icon: Icons.shield }),
    ...(c.names.length
      ? [meta.tags("Names", c.names.slice(0, 30).map((n) => ({ text: n, color: "blue" as const })))]
      : []),
    meta.text("Key", c.keyType, { icon: Icons.key }),
    meta.text("Signature", c.signature),
    ...(c.isCA ? [meta.text("Authority", "Certificate authority (CA:TRUE)", { color: "purple" })] : []),
    ...(c.keyUsage.length ? [meta.tags("Key usage", c.keyUsage)] : []),
    ...(c.extendedKeyUsage.length ? [meta.tags("Extended key usage", c.extendedKeyUsage)] : []),
    meta.separator(),
    meta.text("SHA-256", l.fp.sha256, { icon: Icons.hash }),
    meta.text("SHA-1", l.fp.sha1, { icon: Icons.hash }),
    meta.text("Serial", c.serial),
    ...(c.ocsp ? [meta.link("OCSP", c.ocsp.replace(/^https?:\/\//, ""), c.ocsp)] : []),
    ...(o.path ? [meta.text("File", tildify(o.path, HOME), { icon: Icons.file })] : []),
    ...(o.hasKey ? [meta.text("Private key", "Next to it (-key.pem)", { icon: Icons.lock })] : []),
  ];
}

/** The whole `openssl x509 -text`, in its own page. */
export const fullText = (l: Loaded) =>
  detail({
    title: certName(l.cert),
    markdown: `\`\`\`\n${l.text.trim()}\n\`\`\``,
    actions: [copy(l.text, "Copy Text"), copy(l.pem, "Copy PEM", { icon: Icons.file })],
  });

export function certActions(l: Loaded, o: Pick<CertOptions, "path" | "actions">): Action[] {
  const dir = o.path?.replace(/\/[^/]+$/, "");
  return [
    ...(o.actions ?? []),
    action("Show Full Text", () => fullText(l), { icon: Icons.text, shortcut: "<Ctrl>t" }),
    copy(l.fp.sha256, "Copy SHA-256 Fingerprint", { icon: Icons.hash, shortcut: "<Ctrl>period", section: "Copy" }),
    copy(l.fp.sha1, "Copy SHA-1 Fingerprint", { icon: Icons.hash, section: "Copy" }),
    copy(l.pem, "Copy PEM", { icon: Icons.file, shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    ...(l.cert.names.length
      ? [copy(l.cert.names.join(", "), "Copy Names", { icon: Icons.globe, section: "Copy" })]
      : []),
    copy(l.cert.serial, "Copy Serial Number", { section: "Copy" }),
    ...(o.path ? [copy(o.path, "Copy Path", { icon: Icons.folder, section: "Copy" })] : []),
    ...(dir ? [open(dir, "Open Folder", { icon: Icons.folder, shortcut: "<Ctrl>o", section: "File" })] : []),
  ];
}

export function certItem(l: Loaded, o: CertOptions): Item {
  const c: Cert = l.cert;
  const h = health(c, o.warnDays);
  const look = HEALTH[h];
  const days = daysLeft(c);
  const mismatch = o.host !== undefined && o.role === "Server" && !covers(c, o.host);
  return {
    id: o.id,
    title: certName(c),
    subtitle: o.path ? tildify(o.path, HOME) : `${o.role ? `${o.role} · ` : ""}${issuerName(c)}`,
    icon: {
      source: c.isCA ? Icons.shield : Icons.lock,
      tint: mismatch ? "red" : look.color,
    },
    section: o.section,
    keywords: [
      ...c.names,
      issuerName(c),
      c.keyType,
      l.fp.sha256.replace(/:/g, ""),
      o.path ?? "",
      isMkcert(c) ? "mkcert" : "",
    ],
    accessories: [
      ...(o.role && o.path === undefined ? [{ tag: o.role }] : []),
      ...(isMkcert(c) ? [{ tag: "mkcert", color: "purple" as const }] : []),
      ...(mismatch ? [{ tag: "Wrong name", color: "red" as const }] : []),
      ...(c.names.length > 1 ? [{ text: `+${c.names.length - 1}`, tooltip: c.names.join(", ") }] : []),
      {
        text: days === undefined ? "?" : expiryText(c).replace(/^in /, ""),
        color: h === "valid" ? undefined : look.color,
        tooltip: c.notAfter ? `Expires ${date(c.notAfter)}` : undefined,
      },
    ],
    detail: { metadata: certMetadata(l, o) },
    actions: certActions(l, o),
  };
}

// ---------------------------------------------------------------------------
// Missing tools and errors

const INSTALL = {
  openssl: ["sudo apt install openssl", "sudo dnf install openssl", "sudo pacman -S openssl"],
  mkcert: [
    "sudo apt install mkcert libnss3-tools",
    "sudo dnf install mkcert nss-tools",
    "sudo pacman -S mkcert nss",
    "mkcert -install          # once: trust the local CA",
  ],
};

export function missingItem(e: MissingTool): Item {
  const lines = INSTALL[e.tool];
  return {
    id: `missing:${e.tool}`,
    title: e.tool === "openssl" ? "openssl is not installed" : "mkcert is not installed",
    subtitle: lines[0],
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: [
        e.tool === "openssl"
          ? "This extension reads certificates with **openssl**."
          : "**mkcert** makes certificates your browsers trust, for local development.",
        "",
        "```sh",
        ...lines,
        "```",
      ].join("\n"),
    },
    actions: [
      copy(lines[0], "Copy Install Command", { icon: Icons.terminal }),
      ...(e.tool === "mkcert"
        ? [open("https://github.com/FiloSottile/mkcert#installation", "Open mkcert Installation Guide")]
        : []),
    ],
  };
}

export function errorItem(e: unknown, title = "Could not read the certificate"): Item {
  if (e instanceof MissingTool) return missingItem(e);
  const message = e instanceof Error ? e.message : String(e);
  return {
    id: "error",
    title,
    subtitle: message,
    icon: { source: Icons.alert, tint: "red" },
    detail: { markdown: `\`\`\`\n${message}\n\`\`\`` },
    actions: [
      action("Retry", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      copy(message, "Copy Error", { section: "Copy" }),
    ],
  };
}
