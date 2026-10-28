import {
  action,
  type Context,
  copy,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  pop,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  ago,
  average,
  certLook,
  day,
  daysLeft,
  displayName,
  formatMs,
  health,
  healthLook,
  issuerName,
  msColor,
  plural,
  type Record_,
  type Site,
  sparkline,
  subtitle,
  uptimeRatio,
} from "../lib.ts";
import {
  addSite,
  check,
  loadRecords,
  loadSites,
  nextChange,
  notifyChanged,
  removeSite,
  saveCheck,
  updateSite,
} from "../monitor.ts";

/** Checked during this session of the command; cleared by "Check Again". */
const fresh = new Set<string>();
let counts = { total: 0, down: 0, checking: 0 };

function siteForm(site?: Site) {
  return form({
    title: site ? `Edit ${displayName(site)}` : "Watch Website",
    submitTitle: site ? "Save" : "Watch",
    fields: [
      field.text("url", "URL", { placeholder: "https://example.com/health", required: true, value: site?.url ?? "" }),
      field.text("name", "Name", { placeholder: "Optional, e.g. Production API", value: site?.name ?? "" }),
    ],
    async submit(values) {
      const url = String(values.url ?? "");
      const name = String(values.name ?? "");
      if (site) await updateSite(site.url, url, name);
      else await addSite(url, name);
      await toast(site ? "Saved" : "Watching", { style: "success" });
      return pop();
    },
  });
}

const addAction = () => action("Watch Website", () => siteForm(), { icon: Icons.plus, shortcut: "<Ctrl>n" });

function item(
  site: Site,
  rec: Record_ | undefined,
  checking: boolean,
  prefs: { warnDays: number; slowMs: number },
): Item {
  const last = rec?.last;
  const look = healthLook(last, checking);
  const days = daysLeft(last?.cert);
  const cert = certLook(days, prefs.warnDays);
  const isHttps = site.url.startsWith("https:");
  const h = health(last);
  const avg = average(rec?.history ?? []);
  const ratio = uptimeRatio(rec?.history ?? []);
  const certBad = days !== undefined && days < prefs.warnDays;
  const untrusted = last?.cert?.verifyCode !== undefined && last.cert.verifyCode !== 0;

  const lines: Metadata[] = [
    meta.link("URL", site.url.replace(/^https?:\/\//, "").replace(/\/$/, ""), site.url),
    ...(last?.finalUrl ? [meta.link("Redirects to", last.finalUrl.replace(/^https?:\/\//, ""), last.finalUrl)] : []),
    ...(last?.status !== undefined
      ? [
        meta.text("HTTP", `${last.status} ${last.statusText ?? ""}`.trim(), {
          icon: { source: look.icon, tint: look.color },
          color: look.color,
        }),
      ]
      : last?.error
      ? [meta.text("Error", last.error, { icon: { source: Icons.cross, tint: "red" }, color: "red" })]
      : []),
    meta.text("Checked", checking ? "Checking now…" : ago(last?.at), { icon: Icons.clock }),
    ...(rec?.downSince ? [meta.text("Down since", ago(rec.downSince), { icon: Icons.alert, color: "red" })] : []),
    ...(avg !== undefined ? [meta.text("Average", formatMs(avg), { icon: Icons.activity })] : []),
    ...(ratio !== undefined && rec!.history.length > 1
      ? [meta.progress("Up in last checks", ratio, `${Math.round(ratio * 100)} % of ${rec!.history.length}`)]
      : []),
    meta.separator(),
  ];
  if (last?.cert) {
    const c = last.cert;
    lines.push(
      meta.text("Certificate", cert.label, { icon: { source: Icons.shield, tint: cert.color }, color: cert.color }),
      meta.text("Valid until", day(c.notAfter), { icon: Icons.calendar }),
      meta.text("Issued", day(c.notBefore)),
      meta.text("Issuer", issuerName(c), { icon: Icons.lock }),
      ...(c.verifyCode !== undefined
        ? [meta.text("Chain", c.verifyCode === 0 ? "Trusted" : c.verifyText ?? `Error ${c.verifyCode}`, {
          icon: { source: c.verifyCode === 0 ? Icons.check : Icons.alert, tint: c.verifyCode === 0 ? "green" : "red" },
          color: c.verifyCode === 0 ? undefined : "red",
        })]
        : []),
      ...(c.names.length ? [meta.tags("Names", c.names.slice(0, 8))] : []),
    );
  } else if (isHttps) {
    lines.push(
      meta.text("Certificate", last?.certError ?? (checking ? "Reading…" : "Unknown"), { icon: Icons.shield }),
    );
  } else {
    lines.push(
      meta.text("Certificate", "None: plain HTTP", { icon: { source: Icons.lock, tint: "orange" }, color: "orange" }),
    );
  }

  const history = sparkline(rec?.history ?? []);
  const markdown = [
    last?.error && !checking ? `**${last.error}**` : "",
    untrusted ? `**The certificate is not trusted:** ${last!.cert!.verifyText}.` : "",
    history ? `Last ${plural(rec!.history.length, "check")}, oldest first:\n\n\`${history}\`` : "",
  ].filter(Boolean).join("\n\n");

  return {
    id: site.url,
    title: displayName(site),
    subtitle: checking && !last
      ? "Checking…"
      : last?.error ?? (last ? `${last.status} ${last.statusText ?? ""}`.trim() : ""),
    icon: { source: look.icon, tint: look.color },
    section: h === "down" || h === "warn" || certBad || untrusted ? "Needs Attention" : "Websites",
    keywords: [site.url, site.name ?? "", h],
    accessories: [
      ...(checking ? [{ icon: Icons.refresh, tooltip: "Checking…" }] : []),
      ...(last?.ms !== undefined
        ? [{ text: formatMs(last.ms), color: msColor(last.ms, prefs.slowMs), tooltip: "Response time" }]
        : []),
      ...(isHttps && days !== undefined
        ? [{ tag: cert.short, color: cert.color, icon: Icons.lock, tooltip: cert.label }]
        : !isHttps
        ? [{ tag: "http", color: "orange" as const, tooltip: "No TLS" }]
        : []),
    ],
    detail: {
      stats: [
        { label: "Status", value: checking && !last ? "…" : look.label, color: look.color },
        {
          label: "Response",
          value: formatMs(last?.ms),
          color: last?.ms === undefined ? undefined : msColor(last.ms, prefs.slowMs),
        },
        ...(isHttps
          ? [{
            label: "Certificate",
            value: days === undefined ? "—" : days < 0 ? "Expired" : `${days} d`,
            color: cert.color,
          }]
          : []),
      ],
      markdown: markdown || undefined,
      metadata: lines,
    },
    actions: [
      open(site.url, "Open in Browser"),
      action("Check Again", () => {
        fresh.delete(site.url);
        notifyChanged();
      }, { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      action("Edit", () => siteForm(site), { icon: Icons.settings, shortcut: "<Ctrl>e" }),
      addAction(),
      action("Check All", () => {
        fresh.clear();
        notifyChanged();
      }, { icon: Icons.refresh, shortcut: "<Ctrl><Shift>r" }),
      copy(site.url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      ...(last?.cert?.notAfter ? [copy(day(last.cert.notAfter), "Copy Expiry Date", { section: "Copy" })] : []),
      action("Stop Watching", async () => {
        await removeSite(site.url);
        await toast(`Stopped watching ${displayName(site)}`);
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Stop watching ${displayName(site)}?`,
        shortcut: "<Ctrl>Delete",
        section: "Danger",
      }),
    ],
  };
}

const rank = (i: Item) => (i.section === "Needs Attention" ? 0 : 1);

export default (ctx: Context) => {
  const prefs = {
    warnDays: Number(ctx.preferences.warnDays) || 14,
    slowMs: Number(ctx.preferences.slowMs) || 1500,
  };
  return list({
    placeholder: "Filter websites…",
    empty: {
      title: "No website watched yet",
      description:
        "Press Ctrl+N to add a URL: its status, response time and certificate are checked each time you open this",
      icon: Icons.activity,
    },
    actions: [addAction()],
    status: () =>
      counts.total === 0
        ? "Ctrl+N to watch a website"
        : counts.checking
        ? `Checking ${plural(counts.checking, "site")}…`
        : `${counts.down ? `${counts.down} down · ` : ""}${plural(counts.total, "site")}`,
    async *items({ signal }) {
      while (!signal.aborted) {
        const sites = await loadSites();
        const records = await loadRecords();
        const running = new Set(sites.filter((s) => !fresh.has(s.url)).map((s) => s.url));
        const render = () => {
          counts = {
            total: sites.length,
            down: sites.filter((s) => health(records[s.url]?.last) === "down").length,
            checking: running.size,
          };
          return sites
            .map((s) => item(s, records[s.url], running.has(s.url), prefs))
            .sort((a, b) => rank(a) - rank(b));
        };
        yield render();
        if (running.size) {
          const pending = new Map(
            sites.filter((s) => running.has(s.url)).map((s) => [
              s.url,
              check(s, signal).then(async (result) => {
                records[s.url] = await saveCheck(s.url, result);
                fresh.add(s.url);
              }).finally(() => {
                running.delete(s.url);
                pending.delete(s.url);
              }),
            ]),
          );
          // Each answer as it lands.
          while (pending.size) {
            await Promise.race([...pending.values()].map((p) => p.catch(() => {})));
            if (signal.aborted) return;
            yield render();
          }
          updateCommandMetadata({ subtitle: subtitle(sites.map((s) => records[s.url] ?? {}), prefs.warnDays) }).catch(
            () => {},
          );
        } else if (!sites.length) {
          updateCommandMetadata({ subtitle: null }).catch(() => {});
        }
        await nextChange(signal);
      }
    },
  });
};
