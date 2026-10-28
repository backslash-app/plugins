import {
  type Action,
  action,
  type Color,
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
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { type Backend, backend, SetupError, setupItems } from "../api.ts";
import {
  ago,
  cleanDomain,
  compact,
  countdown,
  type DomainCount,
  type Overview,
  PAUSES,
  pauseText,
  percentText,
  sparkline,
  summaryLine,
  thousands,
  TITLES,
} from "../lib.ts";

const POLL_MS = 15_000;
/** While paused for a while, so the countdown moves. */
const TICK_MS = 1_000;

// --- Live reload ---------------------------------------------------------------

const changes = new EventTarget();
/** Set by a change made from here: the next round fetches again. */
let stale = false;
function changed() {
  stale = true;
  changes.dispatchEvent(new Event("change"));
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      changes.removeEventListener("change", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    changes.addEventListener("change", done);
    signal.addEventListener("abort", done);
  });
}

// --- Actions -------------------------------------------------------------------

function pauseMenu(b: Backend): Action {
  return submenu(
    "Pause Blocking",
    PAUSES.map((p) =>
      action(p.title, async () => {
        await b.pause(p.seconds);
        await toast(`Blocking paused ${pauseText(p.seconds)}`, { style: "success" });
        changed();
      }, { icon: p.seconds ? Icons.timer : Icons.pause })
    ),
    { icon: Icons.pause, shortcut: "<Ctrl>p" },
  );
}

function resumeAction(b: Backend): Action {
  return action("Resume Blocking", async () => {
    await b.resume();
    await toast("Blocking resumed", { style: "success" });
    changed();
  }, { icon: Icons.play, shortcut: "<Ctrl>p" });
}

function domainForm(b: Backend, list: "allow" | "deny", domain = "") {
  const what = list === "allow" ? "Allow" : "Block";
  return form({
    title: `${what} a Domain`,
    submitTitle: `${what} Domain`,
    fields: [
      field.text("domain", "Domain", { placeholder: "ads.example.com", value: domain, required: true }),
      field.dropdown("list", "List", [
        { value: "allow", title: b.kind === "pihole" ? "Allowlist (exact domain)" : "Allow (with subdomains)" },
        { value: "deny", title: b.kind === "pihole" ? "Denylist (exact domain)" : "Block (with subdomains)" },
      ], { value: list }),
      ...(b.kind === "pihole" ? [field.text("comment", "Comment", { placeholder: "Why it is here" })] : []),
    ],
    async submit(values) {
      const d = cleanDomain(String(values.domain ?? ""));
      if (!d) throw new Error(`“${values.domain}” is not a domain name`);
      const target = values.list === "deny" ? "deny" : "allow";
      await b.addDomain(d, target, String(values.comment ?? ""));
      await toast(`${d} ${target === "allow" ? "allowed" : "blocked"}`, { style: "success" });
      changed();
      return pop();
    },
  });
}

function domainActions(b: Backend, domain: string, blocked: boolean): Action[] {
  return [
    action(blocked ? "Allow Domain" : "Block Domain", async () => {
      await b.addDomain(domain, blocked ? "allow" : "deny", "Added from Backslash");
      await toast(`${domain} ${blocked ? "allowed" : "blocked"}`, { style: "success" });
      changed();
    }, {
      icon: blocked ? Icons.check : Icons.shield,
      confirm: blocked ? `Let ${domain} through for every device?` : `Block ${domain} for every device?`,
    }),
    action(
      blocked ? "Allow with Comment…" : "Block with Comment…",
      () => domainForm(b, blocked ? "allow" : "deny", domain),
      {
        icon: Icons.comment,
      },
    ),
    copy(domain, "Copy Domain", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
  ];
}

function common(b: Backend, o: Overview): Action[] {
  return [
    o.blocking === "disabled" ? resumeAction(b) : pauseMenu(b),
    action("Allow a Domain…", () => domainForm(b, "allow"), {
      icon: Icons.check,
      shortcut: "<Ctrl>a",
      section: "Domains",
    }),
    action("Block a Domain…", () => domainForm(b, "deny"), {
      icon: Icons.shield,
      shortcut: "<Ctrl>d",
      section: "Domains",
    }),
    open(b.admin, `Open ${TITLES[b.kind]}`, { icon: Icons.globe, shortcut: "<Ctrl>o", section: TITLES[b.kind] }),
  ];
}

// --- Items -------------------------------------------------------------------

function statusItem(b: Backend, o: Overview): Item {
  const on = o.blocking === "enabled";
  const tint: Color = on ? "green" : o.blocking === "disabled" ? "orange" : "gray";
  const title = on ? "Blocking Enabled" : o.blocking === "disabled" ? "Blocking Paused" : "Blocking State Unknown";
  const subtitle = on
    ? `${percentText(o.percent)} of queries blocked`
    : o.timer
    ? `Back on in ${countdown(o.timer)}`
    : o.blocking === "disabled"
    ? "Until resumed"
    : "Check the web interface";
  const metadata: Metadata[] = [
    meta.text("Blocking", on ? "Enabled" : o.timer ? `Paused, ${countdown(o.timer)} left` : "Disabled", {
      icon: { source: on ? Icons.shield : Icons.pause, tint },
      color: tint,
    }),
    meta.progress("Blocked", o.percent / 100, percentText(o.percent)),
    meta.text("Server", `${TITLES[b.kind]}${o.version ? ` ${o.version}` : ""}`, { icon: Icons.server }),
    meta.link("Web interface", new URL(b.base).host, b.admin),
  ];
  const chart = sparkline(o.history);
  return {
    id: "status",
    title,
    subtitle,
    icon: { source: on ? Icons.shield : Icons.pause, tint },
    section: TITLES[b.kind],
    keywords: ["status", "pause", "resume", "enable", "disable", "on", "off"],
    accessories: [{
      tag: on ? "On" : o.blocking === "disabled" ? (o.timer ? countdown(o.timer) : "Off") : "?",
      color: tint,
    }],
    detail: {
      stats: [
        { label: `Queries · ${o.period}`, value: compact(o.queries) },
        { label: "Blocked", value: compact(o.blocked), color: "red" },
        { label: "Blocked %", value: percentText(o.percent) },
      ],
      markdown: chart ? `Queries over the last ${o.period}\n\n\`${chart}\`` : undefined,
      metadata,
    },
    actions: [
      ...(on ? [pauseMenu(b)] : [resumeAction(b), pauseMenu(b)]),
      ...common(b, o).slice(1),
    ],
  };
}

function statItems(b: Backend, o: Overview): Item[] {
  const rows: { id: string; title: string; value: string; icon: string; tint: Color; note: string }[] = [
    {
      id: "queries",
      title: "Queries",
      value: thousands(o.queries),
      icon: Icons.activity,
      tint: "blue",
      note: `DNS queries answered over the last ${o.period}`,
    },
    {
      id: "blocked",
      title: "Blocked",
      value: `${thousands(o.blocked)} · ${percentText(o.percent)}`,
      icon: Icons.shield,
      tint: "red",
      note: "Queries answered with a blocked address",
    },
  ];
  if (o.listed !== undefined) {
    rows.push({
      id: "listed",
      title: "Domains on Blocklists",
      value: thousands(o.listed),
      icon: Icons.layers,
      tint: "purple",
      note: o.listUpdated ? `Lists updated ${ago(o.listUpdated)}` : "From the subscribed lists",
    });
  }
  if (o.clients !== undefined) {
    rows.push({
      id: "clients",
      title: b.kind === "pihole" ? "Active Clients" : "Top Clients",
      value: thousands(o.clients),
      icon: Icons.monitor,
      tint: "teal",
      note: "Devices that asked something",
    });
  }
  if (o.cached !== undefined && o.queries) {
    rows.push({
      id: "cached",
      title: "Answered from Cache",
      value: `${thousands(o.cached)} · ${percentText(o.cached / o.queries * 100)}`,
      icon: Icons.bolt,
      tint: "yellow",
      note: `${thousands(o.forwarded ?? 0)} forwarded upstream`,
    });
  }
  if (o.avgMs !== undefined) {
    rows.push({
      id: "latency",
      title: "Average Processing Time",
      value: `${o.avgMs.toFixed(o.avgMs < 10 ? 1 : 0)} ms`,
      icon: Icons.timer,
      tint: "gray",
      note: "Time to answer a query, upstream included",
    });
  }
  const actions = common(b, o);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    subtitle: r.note,
    icon: { source: r.icon, tint: r.tint },
    section: `Last ${o.period}`,
    accessories: [{ text: r.value }],
    detail: { stats: [{ label: r.title, value: r.value }], markdown: r.note },
    actions: [...actions, copy(r.value, "Copy Value", { section: "Copy" })],
  }));
}

function domainItems(b: Backend, o: Overview, domains: DomainCount[], blocked: boolean): Item[] {
  const top = domains[0]?.count ?? 1;
  const total = blocked ? o.blocked : o.queries;
  return domains.map((d, i) => ({
    id: `${blocked ? "blocked" : "allowed"}:${d.domain}`,
    title: d.domain,
    icon: { source: blocked ? Icons.shield : Icons.globe, tint: blocked ? "red" as const : "blue" as const },
    section: blocked ? "Top Blocked Domains" : "Top Allowed Domains",
    keywords: [blocked ? "blocked" : "allowed"],
    accessories: [{
      text: thousands(d.count),
      tooltip: `${i + 1}. of the ${blocked ? "blocked" : "permitted"} domains`,
    }],
    detail: {
      stats: [
        { label: "Queries", value: thousands(d.count) },
        { label: blocked ? "Of blocked" : "Of all", value: total ? percentText(d.count / total * 100) : "–" },
        { label: "Rank", value: `#${i + 1}` },
      ],
      metadata: [
        meta.text("Domain", d.domain, { icon: Icons.globe }),
        meta.progress("Compared to #1", d.count / top),
        meta.text("Status", blocked ? "Blocked" : "Permitted", {
          icon: { source: blocked ? Icons.shield : Icons.check, tint: blocked ? "red" : "green" },
        }),
      ],
    },
    actions: [...domainActions(b, d.domain, blocked), ...common(b, o)],
  }));
}

// --- Command -------------------------------------------------------------------

export default (_ctx: Context) => {
  let shown = "";
  return list({
    placeholder: "Filter statistics and domains…",
    empty: { title: "Nothing to show", icon: Icons.shield },
    status: (items) => items[0]?.id === "setup" ? "Not connected" : shown,
    async *items({ preferences, signal }) {
      let b: Backend;
      try {
        b = await backend(preferences, signal);
      } catch (e) {
        if (e instanceof SetupError) {
          yield setupItems(e);
          return;
        }
        throw e;
      }
      let last: Overview | undefined;
      let fetched = 0;
      while (!signal.aborted) {
        let o: Overview;
        try {
          // Between two fetches, only the countdown moves.
          if (!stale && last?.timer && Date.now() - fetched < POLL_MS) {
            o = { ...last, timer: Math.max(0, last.timer - Math.round((Date.now() - fetched) / 1000)) };
            if (!o.timer) {
              o = last = await b.overview(signal);
              fetched = Date.now();
            }
          } else {
            stale = false;
            o = last = await b.overview(signal);
            fetched = Date.now();
          }
        } catch (e) {
          if (e instanceof SetupError) {
            yield setupItems(e);
            return;
          }
          throw e;
        }
        updateCommandMetadata({ subtitle: summaryLine(o) }).catch(() => {});
        shown = `${TITLES[b.kind]} · ${summaryLine(o)} · ${compact(o.queries)} queries in ${o.period}`;
        yield [
          statusItem(b, o),
          ...statItems(b, o),
          ...domainItems(b, o, o.topBlocked, true),
          ...domainItems(b, o, o.topAllowed, false),
        ];
        await wait(o.timer ? TICK_MS : POLL_MS, signal);
      }
    },
  });
};
