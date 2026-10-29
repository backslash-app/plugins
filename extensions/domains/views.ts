// Domain and record rows, the record form and the records view, shared by both commands.

import {
  type Action,
  action,
  copy,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  pop,
  refresh,
  toast,
} from "@backslash/api";
import { AuthError, type Registrar, registrars, TOKEN_PAGES } from "./api.ts";
import {
  dashboardUrl,
  displayName,
  dnsDashboardUrl,
  type DnsRecord,
  type Domain,
  expiryColor,
  expiryState,
  expiryText,
  filterRecords,
  fullName,
  RECORD_TYPES,
  type RecordFilter,
  recordSpec,
  REGISTRAR_COLORS,
  REGISTRAR_NAMES,
  type RegistrarId,
  sortDomains,
  sortRecords,
  ttlLabel,
  TYPE_COLORS,
  zoneLine,
} from "./lib.ts";

export const warnDaysOf = (p: Record<string, unknown>) => {
  const n = Number(p.warnDays);
  return Number.isFinite(n) && n > 0 ? n : 30;
};

const day = (d?: Date) => d?.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) ?? "";

// --- Live reload: forms and actions of this process notify the lists ------------------

const changes = new EventTarget();
const changed = () => changes.dispatchEvent(new Event("change"));

export async function* live<T>(load: () => Promise<T>, signal: AbortSignal): AsyncGenerator<T> {
  while (!signal.aborted) {
    yield await load();
    await new Promise<void>((resolve) => {
      const done = () => {
        changes.removeEventListener("change", done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      changes.addEventListener("change", done);
      signal.addEventListener("abort", done);
    });
  }
}

// --- Setup and errors ---------------------------------------------------------------------

const HOW: Record<RegistrarId, string[]> = {
  porkbun: [
    "**Porkbun**: Account → **API Access** → create an API key; paste the API key and the secret API key.",
    "  Then turn on **API Access** for each domain (Domain Management → Details).",
  ],
  gandi: [
    "**Gandi**: Organizations → your account → **Personal Access Tokens** → create one with",
    "  *See and renew domain names* and *Manage domain technical configurations* (LiveDNS).",
  ],
  ovh: [
    "**OVHcloud**: open the token page (Ctrl+K → Create OVHcloud Keys), sign in and validate: it gives an",
    "  application key, an application secret and a consumer key with access to `/domain/*`.",
    "  Pick the endpoint: `eu` (default), `ca` or `us`.",
  ],
  namecheap: [
    "**Namecheap**: Profile → Tools → **API Access** → enable it (needs some account activity), copy the API key",
    "  and **whitelist your public IP address**, which goes in the IP preference too.",
  ],
};

export function setupItem(): Item {
  return {
    id: "setup",
    title: "Connect a registrar",
    subtitle: "Porkbun, Gandi, OVHcloud or Namecheap: add its API keys in Settings",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect your registrars",
        "",
        "In **Settings → Extensions → Domains → Configure**, fill in the ones you use:",
        "",
        ...Object.values(HOW).map((lines) => `- ${lines.join("\n")}`),
      ].join("\n"),
    },
    actions: [
      open(TOKEN_PAGES.porkbun, "Create Porkbun API Key", { icon: Icons.key }),
      open(TOKEN_PAGES.gandi, "Create Gandi Token", { icon: Icons.key }),
      open(TOKEN_PAGES.ovh, "Create OVHcloud Keys", { icon: Icons.key }),
      open(TOKEN_PAGES.namecheap, "Open Namecheap API Access", { icon: Icons.key }),
    ],
  };
}

export function errorItem(e: unknown, registrar?: RegistrarId): Item {
  const message = e instanceof Error ? e.message : String(e);
  const id = e instanceof AuthError ? e.registrar : registrar;
  const name = id ? REGISTRAR_NAMES[id] : "Domains";
  return {
    id: `error:${id ?? ""}:${message}`,
    title: e instanceof AuthError ? message : `${name} failed`,
    subtitle: e instanceof AuthError ? "Settings → Extensions → Domains" : message,
    icon: { source: e instanceof AuthError ? Icons.key : Icons.alert, tint: e instanceof AuthError ? "orange" : "red" },
    section: "Problems",
    detail: {
      markdown: [
        `\`\`\`\n${message}\n\`\`\``,
        ...(id ? ["", `- ${HOW[id].join("\n")}`] : []),
      ].join("\n"),
    },
    actions: [
      action("Retry", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      ...(id ? [open(TOKEN_PAGES[id], `Open ${name} API Settings`, { icon: Icons.key })] : []),
      copy(message, "Copy Error", { section: "Copy" }),
    ],
  };
}

export interface Loaded {
  entries: { reg: Registrar; domain: Domain }[];
  problems: Item[];
  connected: number;
}

/** Every registrar's domains in parallel; one that fails is a row, the others still load. */
export async function loadDomains(preferences: Record<string, unknown>, signal: AbortSignal): Promise<Loaded> {
  const { list: regs, problems } = registrars(preferences);
  const settled = await Promise.allSettled(regs.map(async (reg) => ({ reg, domains: await reg.domains(signal) })));
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const entries: Loaded["entries"] = [];
  const errors: Item[] = problems.map((p) => errorItem(p));
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") entries.push(...r.value.domains.map((domain) => ({ reg: r.value.reg, domain })));
    else errors.push(errorItem(r.reason, regs[i].id));
  });
  const order = new Map(sortDomains(entries.map((e) => e.domain)).map((d, i) => [`${d.registrar}:${d.name}`, i]));
  entries.sort((a, b) =>
    order.get(`${a.domain.registrar}:${a.domain.name}`)! - order.get(`${b.domain.registrar}:${b.domain.name}`)!
  );
  return { entries, problems: errors, connected: regs.length };
}

// --- Domains --------------------------------------------------------------------------------

export function domainItem(reg: Registrar, d: Domain, warnDays: number, multi: boolean): Item {
  const state = expiryState(d, warnDays);
  const color = expiryColor(d, warnDays);
  return {
    id: `${d.registrar}:${d.name}`,
    title: d.name,
    subtitle: d.expires ? `${state === "expired" ? "Expired" : "Expires"} ${day(d.expires)}` : undefined,
    icon: { source: Icons.globe, tint: color },
    section: state === "ok" || state === "unknown" ? "Domains" : "Expiring Soon",
    keywords: [REGISTRAR_NAMES[d.registrar], d.status ?? "", d.autoRenew ? "auto-renew" : "manual renewal"],
    accessories: [
      ...(multi ? [{ tag: REGISTRAR_NAMES[d.registrar], color: REGISTRAR_COLORS[d.registrar] }] : []),
      ...(d.autoRenew === false
        ? [{ icon: { source: Icons.repeat, tint: "orange" as const }, tooltip: "Auto-renew is off" }]
        : d.autoRenew
        ? [{ icon: { source: Icons.repeat, tint: "green" as const }, tooltip: "Renews automatically" }]
        : []),
      { text: expiryText(d.expires).replace(/^in /, ""), color: state === "ok" ? undefined : color },
    ],
    detail: {
      metadata: [
        meta.text("Registrar", REGISTRAR_NAMES[d.registrar], { icon: Icons.tag, color: REGISTRAR_COLORS[d.registrar] }),
        ...(d.expires
          ? [meta.text("Expires", `${day(d.expires)} (${expiryText(d.expires)})`, { icon: Icons.calendar, color })]
          : []),
        meta.text(
          "Auto-renew",
          d.autoRenew === undefined ? "Unknown" : d.autoRenew ? "On" : "Off: renew it yourself",
          { icon: Icons.repeat, color: d.autoRenew ? "green" : d.autoRenew === false ? "orange" : "gray" },
        ),
        ...(d.status ? [meta.text("Status", d.status)] : []),
        ...(d.locked !== undefined ? [meta.text("Transfer lock", d.locked ? "On" : "Off", { icon: Icons.lock })] : []),
        ...(d.privacy !== undefined
          ? [meta.text("WHOIS privacy", d.privacy ? "On" : "Off", { icon: Icons.eyeOff })]
          : []),
        ...(d.created ? [meta.text("Registered", day(d.created), { icon: Icons.clock })] : []),
        meta.text("DNS", d.dns ? `${REGISTRAR_NAMES[d.registrar]} name servers` : "Elsewhere (not editable here)", {
          icon: Icons.server,
        }),
      ],
    },
    actions: [
      ...(d.dns ? [action("Show DNS Records", () => recordsView(reg, d), { icon: Icons.layers })] : []),
      open(dashboardUrl(d), `Open in ${REGISTRAR_NAMES[d.registrar]}`, { shortcut: "<Ctrl>o" }),
      open(`https://${d.name}`, "Open Website", { icon: Icons.globe, shortcut: "<Ctrl><Shift>o" }),
      copy(d.name, "Copy Domain", { shortcut: "<Ctrl>period", section: "Copy" }),
      ...(d.expires ? [copy(d.expires.toISOString().slice(0, 10), "Copy Expiry Date", { section: "Copy" })] : []),
      ...(d.dns
        ? [action("Add DNS Record", async () => recordForm(reg, d, await reg.records(d)), {
          icon: Icons.plus,
          shortcut: "<Ctrl>n",
          section: "DNS",
        })]
        : []),
    ],
  };
}

// --- Records ----------------------------------------------------------------------------------

export function recordForm(reg: Registrar, d: Domain, all: DnsRecord[], existing?: DnsRecord, type = "A"): FormSpec {
  return form({
    title: existing ? `Edit ${existing.type} ${fullName(existing.name, d.name)}` : `New DNS Record · ${d.name}`,
    submitTitle: existing ? "Save Record" : "Create Record",
    fields: [
      field.dropdown("type", "Type", RECORD_TYPES, { value: existing?.type ?? type }),
      field.text("name", "Name", {
        value: existing ? displayName(existing) : "",
        placeholder: `www, @ (or empty) for ${d.name}`,
      }),
      field.text("content", "Content", {
        required: true,
        value: existing?.content ?? "",
        placeholder: "IPv4 for A, IPv6 for AAAA, a host name for CNAME/MX, text for TXT",
      }),
      field.text("ttl", "TTL", {
        value: existing?.ttl !== undefined ? String(existing.ttl) : "",
        placeholder: `Seconds (at least ${reg.minTtl}), empty for the default`,
      }),
      field.text("prio", "Priority", {
        value: existing?.prio !== undefined ? String(existing.prio) : "",
        placeholder: "MX and SRV only (default 10)",
      }),
    ],
    async submit(values) {
      const spec = recordSpec(values as Record<string, string>, d.name, reg.minTtl);
      if (existing) await reg.update(d, existing, spec, all);
      else await reg.create(d, spec, all);
      changed();
      await toast(`${existing ? "Saved" : "Created"} ${spec.type} ${fullName(spec.name, d.name)}`, {
        style: "success",
      });
      return pop();
    },
  });
}

export function recordItem(reg: Registrar, d: Domain, r: DnsRecord, all: DnsRecord[], multi: boolean): Item {
  const name = fullName(r.name, r.domain);
  const long = r.content.length > 60 || r.type === "TXT";
  const actions: Action[] = [
    copy(r.content, "Copy Content"),
    action("Edit Record", () => recordForm(reg, d, all, r), { icon: Icons.settings, shortcut: "<Ctrl>e" }),
    copy(name, "Copy Name", { shortcut: "<Ctrl>period", section: "Copy" }),
    copy(zoneLine(r), "Copy as Zone File Line", { icon: Icons.text, section: "Copy" }),
    action("Add Record", () => recordForm(reg, d, all, undefined, r.type), {
      icon: Icons.plus,
      shortcut: "<Ctrl>n",
      section: "Record",
    }),
    open(dnsDashboardUrl(d), `Open DNS in ${REGISTRAR_NAMES[d.registrar]}`, {
      icon: Icons.globe,
      shortcut: "<Ctrl>o",
      section: "Record",
    }),
    action("Delete Record", async () => {
      await reg.remove(d, r, all);
      changed();
      await toast(`Deleted ${r.type} ${name}`, { style: "success" });
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Delete ${r.type} ${name} → ${r.content.length > 40 ? `${r.content.slice(0, 40)}…` : r.content}?`,
      shortcut: "<Ctrl>Delete",
      section: "Danger",
    }),
  ];
  return {
    id: `${r.registrar}:${r.domain}:${r.id}`,
    title: displayName(r),
    subtitle: r.prio !== undefined ? `${r.prio} ${r.content}` : r.content,
    icon: { source: Icons.globe, tint: TYPE_COLORS[r.type] ?? "gray" },
    section: multi ? r.domain : undefined,
    keywords: [name, r.type, r.content, r.notes ?? ""],
    accessories: [
      ...(r.notes ? [{ icon: Icons.comment, tooltip: r.notes }] : []),
      ...(r.ttl !== undefined ? [{ text: ttlLabel(r.ttl), tooltip: "TTL" }] : []),
      { tag: r.type, color: TYPE_COLORS[r.type] ?? "gray" },
    ],
    detail: {
      markdown: long ? `\`\`\`\n${r.content}\n\`\`\`` : undefined,
      metadata: [
        meta.text("Name", name, { icon: Icons.globe }),
        meta.tags("Type", [{ text: r.type, color: TYPE_COLORS[r.type] ?? "gray" }]),
        ...(!long ? [meta.text("Content", r.content)] : []),
        ...(r.prio !== undefined ? [meta.text("Priority", r.prio)] : []),
        meta.text("TTL", ttlLabel(r.ttl), { icon: Icons.clock }),
        ...(r.notes ? [meta.text("Notes", r.notes, { icon: Icons.comment })] : []),
        meta.separator(),
        meta.text("Domain", r.domain, { icon: Icons.layers }),
        meta.text("Registrar", REGISTRAR_NAMES[r.registrar], { color: REGISTRAR_COLORS[r.registrar] }),
      ],
    },
    actions,
  };
}

export const RECORD_FILTERS: { value: RecordFilter; title: string }[] = [
  { value: "all", title: "All" },
  { value: "address", title: "A / AAAA" },
  { value: "cname", title: "CNAME" },
  { value: "mx", title: "MX" },
  { value: "txt", title: "TXT" },
  { value: "other", title: "Other" },
];

/** The records of one domain; reloads by itself after a change. */
export function recordsView(reg: Registrar, d: Domain): ListSpec {
  let summary = "";
  let all: DnsRecord[] = [];
  return list({
    title: `DNS · ${d.name}`,
    placeholder: `Filter ${d.name} records by name, type, content…`,
    filter: { options: RECORD_FILTERS, default: "all" },
    empty: { title: "No records", description: "Nothing matches this filter. Ctrl+N adds a record", icon: Icons.globe },
    status: () => summary,
    actions: [
      action("Add Record", () => recordForm(reg, d, all), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
      open(dnsDashboardUrl(d), `Open DNS in ${REGISTRAR_NAMES[d.registrar]}`, { icon: Icons.globe }),
    ],
    items: ({ signal, filter }) =>
      live(async () => {
        try {
          all = await reg.records(d, signal);
        } catch (e) {
          if (signal.aborted) throw e;
          summary = "";
          return [errorItem(e, d.registrar)];
        }
        summary = `${all.length} record${all.length === 1 ? "" : "s"} · ${REGISTRAR_NAMES[d.registrar]}`;
        return sortRecords(filterRecords(all, (filter ?? "all") as RecordFilter)).map((r) =>
          recordItem(reg, d, r, all, false)
        );
      }, signal),
  });
}

/** "Add Record" for every editable domain, for a submenu. */
export function addRecordMenu(entries: Loaded["entries"]): Action[] {
  return entries.filter((e) => e.domain.dns).map((e) =>
    action(e.domain.name, async () => recordForm(e.reg, e.domain, await e.reg.records(e.domain)), { icon: Icons.globe })
  );
}
