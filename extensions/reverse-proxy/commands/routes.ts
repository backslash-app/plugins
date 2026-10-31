import {
  type Accessory,
  type Action,
  action,
  copy,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { type Config, config, dashboardUrl, everything, npmAction, SetupError, SOURCES } from "../api.ts";
import {
  certHealth,
  type Certificate,
  expiresText,
  HEALTH,
  type Route,
  routeUrl,
  sortCertificates,
  sortRoutes,
  statusLine,
} from "../lib.ts";
import type { SetupKind } from "../net.ts";

const ICON: Record<Route["health"], string> = {
  error: Icons.alert,
  warning: Icons.alert,
  ok: Icons.globe,
  disabled: Icons.pause,
};

function routeItem(c: Config, r: Route): Item {
  const look = HEALTH[r.health];
  const url = routeUrl(r);
  const dash = dashboardUrl(c, r);
  const certLook = r.cert?.expires !== undefined ? HEALTH[certHealth(r.cert.expires)] : undefined;
  const accessories: Accessory[] = [
    ...(r.tls
      ? [{
        icon: { source: Icons.lock, tint: certLook?.color ?? "green" },
        text: r.cert?.expires !== undefined ? expiresText(r.cert.expires) : undefined,
        tooltip: r.cert ? `Certificate: ${r.cert.name}` : r.certResolver ? `Resolver: ${r.certResolver}` : "HTTPS",
      }]
      : []),
    ...(r.upstreams[0] ? [{ text: r.upstreams[0].replace(/^https?:\/\//, ""), tooltip: "Upstream" }] : []),
    { tag: r.source === "npm" ? "NPM" : SOURCES[r.source], color: "gray" },
    ...(r.health !== "ok" ? [{ tag: look.label, color: look.color }] : []),
  ];
  const lines: Metadata[] = [
    meta.text("Status", look.label, { icon: { source: Icons.dot, tint: look.color }, color: look.color }),
    ...(r.domains.length ? [meta.tags("Domains", r.domains)] : []),
    ...(r.paths.length ? [meta.tags("Paths", r.paths)] : []),
    ...(r.upstreams.length ? [meta.tags("Upstreams", r.upstreams)] : []),
    meta.separator(),
    meta.text("HTTPS", r.tls ? "Yes" : "No", { icon: { source: Icons.lock, tint: r.tls ? "green" : "gray" } }),
    ...(r.cert
      ? [
        meta.text("Certificate", r.cert.name, { icon: Icons.shield }),
        ...(r.cert.expires !== undefined
          ? [
            meta.text(
              "Expires",
              `${new Date(r.cert.expires).toLocaleDateString("en-GB")} (${expiresText(r.cert.expires)})`,
              {
                color: certLook?.color,
              },
            ),
          ]
          : []),
      ]
      : []),
    ...(r.certResolver ? [meta.text("Resolver", r.certResolver, { icon: Icons.shield })] : []),
    ...(r.entryPoints.length ? [meta.tags(r.source === "caddy" ? "Listens" : "Entry points", r.entryPoints)] : []),
    ...(r.middlewares.length ? [meta.tags(r.source === "npm" ? "Options" : "Middlewares", r.middlewares)] : []),
    ...(r.provider ? [meta.text("Provider", r.provider)] : []),
    ...(r.server ? [meta.text("Server", r.server)] : []),
    meta.text("From", SOURCES[r.source], { icon: Icons.server }),
  ];
  const actions: Action[] = [
    ...(url ? [open(url, "Open Domain")] : []),
    ...(dash ? [open(dash, `Open in ${SOURCES[r.source]}`, { icon: Icons.window, shortcut: "<Ctrl>o" })] : []),
    ...(url ? [copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" })] : []),
    ...(r.upstreams[0] ? [copy(r.upstreams[0], "Copy Upstream", { section: "Copy" })] : []),
    ...(r.problems.length ? [copy(r.problems.join("\n"), "Copy Error", { section: "Copy" })] : []),
  ];
  if (r.source === "npm" && r.id !== undefined) {
    const id = r.id;
    actions.push(
      r.health === "disabled"
        ? action("Enable Host", async () => {
          await npmAction(c, `/nginx/proxy-hosts/${id}/enable`);
          await toast(`${r.name} enabled`, { style: "success" });
          return refresh();
        }, { icon: Icons.play, section: "Nginx Proxy Manager" })
        : action("Disable Host", async () => {
          await npmAction(c, `/nginx/proxy-hosts/${id}/disable`);
          await toast(`${r.name} disabled`);
          return refresh();
        }, {
          icon: Icons.pause,
          destructive: true,
          confirm: `Disable ${r.name}? It stops answering until enabled again`,
          section: "Nginx Proxy Manager",
        }),
    );
    if (r.cert?.id !== undefined && r.cert.provider === "letsencrypt") {
      actions.push(renewAction(c, r.cert.id, r.cert.name));
    }
  }
  return {
    id: r.key,
    title: r.name,
    subtitle: r.domains.filter((d) => d !== r.name).join(", ") || undefined,
    icon: { source: ICON[r.health], tint: r.health === "ok" ? (r.tls ? "green" : "blue") : look.color },
    section: r.health === "error" || r.health === "warning" ? "Problems" : SOURCES[r.source],
    keywords: [...r.domains, ...r.upstreams, ...r.paths, ...r.entryPoints, r.provider ?? "", SOURCES[r.source]],
    accessories,
    detail: {
      markdown: r.problems.length ? r.problems.map((p) => `> **${p}**`).join("\n\n") : undefined,
      metadata: lines,
    },
    actions,
  };
}

function renewAction(c: Config, id: number, name: string): Action {
  return action("Renew Certificate", async () => {
    await toast(`Renewing ${name}…`, { message: "Let's Encrypt can take a minute" });
    await npmAction(c, `/nginx/certificates/${id}/renew`);
    await toast(`${name} renewed`, { style: "success" });
    return refresh();
  }, { icon: Icons.refresh, shortcut: "<Ctrl><Shift>r", section: "Certificate" });
}

function certItem(c: Config, cert: Certificate): Item {
  const health = certHealth(cert.expires);
  const look = HEALTH[health];
  return {
    id: cert.key,
    title: cert.name,
    subtitle: cert.provider,
    icon: { source: Icons.shield, tint: look.color },
    section: "Certificates",
    keywords: [...cert.domains, ...cert.hosts, cert.provider, "certificate", "ssl", "tls"],
    accessories: [
      ...(cert.hosts.length ? [{ text: `${cert.hosts.length} host${cert.hosts.length === 1 ? "" : "s"}` }] : []),
      ...(cert.expires !== undefined ? [{ tag: expiresText(cert.expires), color: look.color }] : []),
    ],
    detail: {
      metadata: [
        ...(cert.expires !== undefined
          ? [meta.text("Expires", `${new Date(cert.expires).toLocaleString("en-GB")} (${expiresText(cert.expires)})`, {
            icon: Icons.clock,
            color: look.color,
          })]
          : []),
        meta.tags("Domains", cert.domains),
        meta.text("Provider", cert.provider, { icon: Icons.shield }),
        ...(cert.hosts.length ? [meta.tags("Used by", cert.hosts)] : []),
      ],
    },
    actions: [
      ...(cert.provider === "Let's Encrypt" ? [renewAction(c, cert.id, cert.name)] : []),
      open(`${c.npm?.base}/nginx/certificates`, "Open in Nginx Proxy Manager", { icon: Icons.window }),
      ...(cert.domains[0] && !cert.domains[0].startsWith("*")
        ? [open(`https://${cert.domains[0]}`, "Open Domain", { icon: Icons.globe })]
        : []),
      copy(cert.domains.join(", "), "Copy Domains", { section: "Copy" }),
    ],
  };
}

// ---------------------------------------------------------------------------

const CONFIGURE = "**Settings → Extensions → Reverse Proxy → Configure**";

const HOW = [
  "- **Traefik**: the address of its API (`http://192.168.1.5:8080` with `api.insecure=true`, or the dashboard's address with its basic auth user and password).",
  "- **Caddy**: its admin API, `http://localhost:2019` (it only listens on this computer by default).",
  "- **Nginx Proxy Manager**: its admin address (`http://192.168.1.5:81`) with your email and password.",
].join("\n");

function errorItem(e: SetupError, source?: string): Item {
  const guide: Record<SetupKind, string> = {
    url: `## Connect your reverse proxy\n\nIn ${CONFIGURE}, set one or more of:\n\n${HOW}`,
    auth: `## Sign in\n\n${e.message}. Fix it in ${CONFIGURE}.`,
    permission: `## Not allowed\n\n${e.message}. Use an administrator account.`,
    host:
      "## Address out of reach\n\nThis extension may reach this computer, local names (`*.lan`, `*.local`, `*.home.arpa`…), private networks and Tailscale. Use the proxy's local address in " +
      CONFIGURE + ".",
    tls:
      `## Self-signed HTTPS certificate\n\nBackslash can't skip certificate checks. Use the \`http://\` address of the API on your network, or paste the certificate (PEM) in ${CONFIGURE}.`,
    down: `## No answer\n\nCheck that \`${e.base ?? "…"}\` is right and reachable, in ${CONFIGURE}.`,
    unknown: `## Not available\n\n${e.message}.`,
  };
  return {
    id: `setup-${source ?? "all"}`,
    title: source ? `${source}: ${e.message}` : e.message,
    subtitle: e.kind === "url" ? "Traefik, Caddy or Nginx Proxy Manager" : "Settings → Extensions → Reverse Proxy",
    icon: { source: e.kind === "auth" ? Icons.key : Icons.server, tint: "orange" },
    section: "Problems",
    detail: { markdown: guide[e.kind] },
    actions: [
      ...(e.base && e.kind !== "host" ? [open(e.base, "Open Address", { icon: Icons.globe })] : []),
      action("Try Again", () => refresh(), { icon: Icons.refresh }),
    ],
  };
}

let status = "";

export default list({
  placeholder: "Filter routes by domain, upstream, entry point…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "problems", title: "Problems" },
      { value: "certificates", title: "Certificates" },
    ],
    default: "all",
  },
  empty: {
    title: "Nothing here",
    description: "No route matches, or every route is healthy",
    icon: Icons.globe,
  },
  status: () => status,
  actions: [action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
  async items({ preferences, filter, signal }) {
    status = "";
    let c: Config;
    try {
      c = config(preferences);
    } catch (e) {
      if (e instanceof SetupError) return [errorItem(e)];
      throw e;
    }
    const all = await everything(c, signal);
    const routes = sortRoutes(all.routes);
    const certs = sortCertificates(all.certificates);
    status = [statusLine(routes, certs), ...all.summaries].join(" · ");
    const problems = routes.filter((r) => r.health === "error" || r.health === "warning").length +
      certs.filter((x) => certHealth(x.expires) !== "ok").length;
    if (!filter || filter === "all") {
      updateCommandMetadata({ subtitle: problems ? `${problems} problem${problems === 1 ? "" : "s"}` : null })
        .catch(() => {});
    }
    const errors = all.errors.map(({ source, error }) =>
      error instanceof SetupError
        ? errorItem(error, SOURCES[source])
        : errorItem(new SetupError(error.message, "unknown"), SOURCES[source])
    );
    if (filter === "certificates") return [...errors, ...certs.map((x) => certItem(c, x))];
    if (filter === "problems") {
      return [
        ...errors,
        ...routes.filter((r) => r.health === "error" || r.health === "warning").map((r) => routeItem(c, r)),
        ...certs.filter((x) => certHealth(x.expires) !== "ok").map((x) => certItem(c, x)),
      ];
    }
    return [...errors, ...routes.map((r) => routeItem(c, r)), ...certs.map((x) => certItem(c, x))];
  },
});
