import {
  type Action,
  action,
  clipboard,
  type Context,
  copy,
  detail,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  open,
  pop,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  duration,
  hostOf,
  installCommand,
  KNOWN,
  osFamily,
  parsePort,
  type Provider,
  PROVIDERS,
  type Shareable,
  shareablePorts,
  subtitle,
} from "../lib.ts";
import { available, describe, journal, listening, type Live, NoSession, start, stop, units } from "../system.ts";

const ORDER: Provider[] = ["cloudflared", "ngrok"];
let summary = "";

function preferred(ctx: Context, installed: Provider[]): Provider[] {
  const want = String(ctx.preferences.provider ?? "").trim().toLowerCase() === "ngrok" ? "ngrok" : "cloudflared";
  return [...installed].sort((a, b) => Number(b === want) - Number(a === want));
}

/** Starts a tunnel, copies its URL, and reloads the list. */
async function share(provider: Provider, port: number) {
  await toast(`Opening a tunnel to :${port} with ${provider}…`);
  const url = await start(provider, port);
  if (url) {
    await clipboard.write(url);
    await toast("Public URL copied", { style: "success", message: url });
  } else {
    await toast("The tunnel is starting", { message: "Its URL shows up here in a moment" });
  }
}

function shareForm(installed: Provider[], port?: number) {
  return form({
    title: "Share a Local Port",
    submitTitle: "Open Tunnel",
    fields: [
      field.text("port", "Port", { placeholder: "3000", required: true, value: port ? String(port) : "" }),
      field.dropdown("provider", "With", installed.map((p) => ({ value: p, title: PROVIDERS[p].title })), {
        value: installed[0],
      }),
    ],
    async submit(values) {
      await share(String(values.provider) as Provider, parsePort(values.port));
      return pop();
    },
  });
}

function tunnelItem(t: Live): Item {
  const local = `http://localhost:${t.unit.port}`;
  const p = PROVIDERS[t.unit.provider];
  const starting = !t.url;
  const inspector = t.unit.provider === "ngrok" ? `http://127.0.0.1:${t.unit.webPort ?? 4040}` : undefined;
  const logs = action("Show Logs", () =>
    detail({
      title: `${p.short} :${t.unit.port}`,
      markdown: async () => {
        const text = await journal(t.unit.name, 80);
        return text ? "```\n" + text.slice(-6000) + "\n```" : "No log yet.";
      },
      actions: [action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
    }), { icon: Icons.text, shortcut: "<Ctrl>l" });
  const stopIt = action("Stop Tunnel", async () => {
    await stop(t.unit.name);
    await toast(`Stopped sharing :${t.unit.port}`);
    return refresh();
  }, {
    icon: Icons.stop,
    destructive: true,
    confirm: `Stop the tunnel to :${t.unit.port}? Its URL stops working for good`,
    shortcut: "<Ctrl>Delete",
    section: "Danger",
  });
  return {
    id: t.unit.name,
    title: t.url ? hostOf(t.url) : t.error ? "Tunnel failed" : "Starting…",
    subtitle: `localhost:${t.unit.port}`,
    icon: { source: Icons.globe, tint: t.url ? "green" : t.error ? "red" : "yellow" },
    section: "Open Tunnels",
    keywords: [String(t.unit.port), t.unit.provider, t.url ?? ""],
    accessories: [
      ...(t.ngrok ? [{ text: `${t.ngrok.requests} req`, icon: Icons.activity, tooltip: "HTTP requests" }] : []),
      ...(t.started ? [{ text: duration(Date.now() - t.started), icon: Icons.clock, tooltip: "Open for" }] : []),
      { tag: p.short, color: t.unit.provider === "ngrok" ? "blue" : "orange" },
    ],
    detail: {
      stats: [
        {
          label: "Status",
          value: t.url ? "Open" : t.error ? "Failed" : "Starting",
          color: t.url ? "green" : t.error ? "red" : "yellow",
        },
        ...(t.ngrok
          ? [{ label: "Requests", value: t.ngrok.requests }, { label: "Connections", value: t.ngrok.connections }]
          : [{ label: "Open for", value: t.started ? duration(Date.now() - t.started) : "—" }]),
      ],
      markdown: t.error && !t.url ? `**${t.error}**` : starting ? "Waiting for the public URL…" : undefined,
      metadata: [
        ...(t.url ? [meta.link("Public URL", hostOf(t.url), t.url)] : []),
        meta.link("Local", `localhost:${t.unit.port}`, local),
        meta.text("Provider", p.title, { icon: Icons.cloud }),
        ...(inspector ? [meta.link("Inspector", hostOf(inspector), inspector)] : []),
        ...(t.started
          ? [
            meta.text(
              "Since",
              new Date(t.started).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
              { icon: Icons.clock },
            ),
          ]
          : []),
        meta.separator(),
        meta.text("Unit", `${t.unit.name}.service`, { icon: Icons.settings }),
        meta.text(
          "Reachable by",
          t.unit.provider === "cloudflared" ? "Anyone with the URL (quick tunnel)" : "Anyone with the URL",
          { icon: { source: Icons.alert, tint: "orange" } },
        ),
      ],
    },
    actions: [
      ...(t.url
        ? [copy(t.url, "Copy Public URL"), open(t.url, "Open Public URL")]
        : [action("Check Again", () => refresh(), { icon: Icons.refresh })]),
      open(local, "Open Local URL", { icon: Icons.globe }),
      ...(inspector ? [open(inspector, "Open ngrok Inspector", { icon: Icons.search })] : []),
      logs,
      action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      ...(t.url ? [copy(`curl ${t.url}`, "Copy curl Command", { section: "Copy" })] : []),
      stopIt,
    ],
  };
}

function portItem(s: Shareable, providers: Provider[], shared: Provider[]): Item {
  const label = s.process ?? KNOWN[s.port] ?? "System service";
  const options = providers.filter((p) => !shared.includes(p));
  const shareActions: Action[] = options.map((p) =>
    action(`Share with ${PROVIDERS[p].title}`, async () => {
      await share(p, s.port);
      return refresh();
    }, { icon: Icons.upload })
  );
  return {
    id: `port-${s.port}`,
    title: `:${s.port}`,
    subtitle: label,
    icon: { source: s.process ? Icons.plug : Icons.server, tint: s.process ? "blue" : "gray" },
    section: "Share a Port",
    keywords: [label, String(s.pid ?? "")],
    accessories: [
      ...shared.map((p) => ({ tag: `shared · ${PROVIDERS[p].short}`, color: "green" as const })),
      s.local ? { tag: "localhost", color: "gray" as const } : { tag: "network", color: "orange" as const },
    ],
    detail: {
      markdown: options.length
        ? `Opens a public HTTPS URL that forwards to \`http://localhost:${s.port}\`. Anyone with the link reaches it.`
        : `Already shared with every installed provider.`,
      metadata: [
        meta.text("Port", s.port, { icon: Icons.plug }),
        ...(s.process ? [meta.text("Program", s.process, { icon: Icons.terminal })] : [meta.text("Service", label)]),
        ...(s.pid ? [meta.text("PID", s.pid)] : []),
        meta.link("Local", `localhost:${s.port}`, `http://localhost:${s.port}`),
        meta.tags(
          "Providers",
          providers.map((p) => ({
            text: PROVIDERS[p].short,
            color: shared.includes(p) ? "green" as const : undefined,
          })),
        ),
      ],
    },
    actions: [
      ...shareActions,
      open(`http://localhost:${s.port}`, "Open Local URL", { icon: Icons.globe }),
      copy(String(s.port), "Copy Port", { section: "Copy" }),
    ],
  };
}

async function setupItem(p: Provider, only: boolean): Promise<Item> {
  const cmd = installCommand(p, osFamily(await Deno.readTextFile("/etc/os-release").catch(() => "")));
  const md = p === "cloudflared"
    ? [
      "## cloudflared",
      "",
      "Quick tunnels need no account: `cloudflared tunnel --url` gives a random `trycloudflare.com` URL.",
      "",
      "```",
      cmd,
      "```",
    ]
    : [
      "## ngrok",
      "",
      "```",
      cmd,
      "ngrok config add-authtoken <your token>",
      "```",
      "",
      "ngrok needs a free account and its authtoken (Enter opens the dashboard).",
    ];
  return {
    id: `setup-${p}`,
    title: only ? `Install ${PROVIDERS[p].title}` : `${PROVIDERS[p].title} is not installed`,
    subtitle: cmd,
    icon: { source: Icons.download, tint: only ? "orange" : "gray" },
    section: "Providers",
    detail: { markdown: md.join("\n") },
    actions: [
      ...(p === "ngrok"
        ? [open("https://dashboard.ngrok.com/get-started/your-authtoken", "Get ngrok Authtoken", { icon: Icons.key })]
        : []),
      copy(cmd, "Copy Install Command"),
      open(
        p === "ngrok"
          ? "https://ngrok.com/download"
          : "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
        "Open Install Guide",
      ),
    ],
  };
}

export default async (ctx: Context) => {
  const detected = async () =>
    preferred(
      ctx,
      (await Promise.all(ORDER.map(async (p) => (await available(p)) ? p : undefined))).filter((p): p is Provider =>
        !!p
      ),
    );
  const first = await detected();
  return list({
    placeholder: "Filter tunnels and ports…",
    actions: first.length
      ? [action("Share a Port…", () => shareForm(first), { icon: Icons.plus, shortcut: "<Ctrl>n" })]
      : [],
    empty: {
      title: "Nothing is listening",
      description: "Start a dev server, then share its port from here",
      icon: Icons.plug,
    },
    status: () => summary,
    items: async () => {
      const installed = await detected();
      const missing = await Promise.all(
        ORDER.filter((p) => !installed.includes(p)).map((p) => setupItem(p, installed.length === 0)),
      );
      let open: Live[];
      try {
        open = await Promise.all((await units()).map(describe));
      } catch (e) {
        if (!(e instanceof NoSession)) throw e;
        summary = "No systemd user session";
        return [{
          id: "no-session",
          title: "No systemd user session",
          subtitle: "Tunnels keep running after the launcher closes as systemd user services",
          icon: { source: Icons.alert, tint: "red" },
          detail: {
            markdown:
              `**${e.message}.**\n\nLog in to a desktop session with systemd (most distributions), then try again.`,
          },
        }];
      }
      updateCommandMetadata({ subtitle: subtitle(open.length) }).catch(() => {});
      const ports = shareablePorts(await listening());
      summary = `${open.length ? subtitle(open.length) : "No tunnel open"} · ${ports.length} listening port${
        ports.length === 1 ? "" : "s"
      }${installed.length ? ` · ${installed.join(", ")}` : ""}`;
      const shared = (port: number) => open.filter((t) => t.unit.port === port).map((t) => t.unit.provider);
      const anotherPort = installed.length
        ? [action("Share Another Port…", () => shareForm(installed), { icon: Icons.plus, shortcut: "<Ctrl>n" })]
        : [];
      return [
        ...open.map(tunnelItem).map((i) => ({ ...i, actions: [...i.actions!, ...anotherPort] })),
        ...(installed.length
          ? ports.map((s) => portItem(s, installed, shared(s.port))).map((i) => ({
            ...i,
            actions: [...i.actions!, ...anotherPort],
          }))
          : []),
        ...missing,
      ];
    },
  });
};
