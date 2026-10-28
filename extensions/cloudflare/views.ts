// DNS records (with their form), cache purge: shared by the zones and DNS commands.

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
  submenu,
  toast,
} from "@backslash/api";
import { cf, cfAll, guarded, zones as loadZones } from "./api.ts";
import {
  chunks,
  dnsDashboardUrl,
  type DnsRecord,
  filterRecords,
  formatDate,
  mapRecord,
  purgeUrls,
  RECORD_TYPES,
  recordBody,
  type RecordFilter,
  shortName,
  sortRecords,
  ttlLabel,
  TYPE_COLORS,
  type Zone,
  zoneFileLine,
} from "./lib.ts";

// --- Live reload: forms and actions of this process notify the lists ----------------

const changes = new EventTarget();
const changed = () => changes.dispatchEvent(new Event("change"));

async function* live<T>(load: () => Promise<T>, signal: AbortSignal): AsyncGenerator<T> {
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

// --- Cache purge ---------------------------------------------------------------------

export function purgeActions(tok: string, z: Zone): Action[] {
  return [
    submenu("Purge Cache", [
      action("Purge URLs…", () => purgeForm(tok, z), { icon: Icons.link }),
      action("Purge Everything", async () => {
        await cf(tok, `/zones/${z.id}/purge_cache`, { method: "POST", body: { purge_everything: true } });
        await toast(`Purged everything on ${z.name}`, { style: "success", message: "Edge caches refill on demand" });
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Purge every cached file of ${z.name}? Your origin gets the traffic until caches refill.`,
      }),
    ], { icon: Icons.bolt, shortcut: "<Ctrl><Shift>p", section: "Cache" }),
  ];
}

export function purgeForm(tok: string, z: Zone): FormSpec {
  return form({
    title: `Purge URLs on ${z.name}`,
    submitTitle: "Purge",
    fields: [
      field.textArea("urls", "URLs", {
        required: true,
        placeholder: `https://${z.name}/styles.css\n/index.html`,
      }),
    ],
    async submit(values) {
      const urls = purgeUrls(String(values.urls ?? ""), z.name);
      for (const files of chunks(urls)) {
        await cf(tok, `/zones/${z.id}/purge_cache`, { method: "POST", body: { files } });
      }
      await toast(`Purged ${urls.length} URL${urls.length === 1 ? "" : "s"}`, { style: "success" });
      return pop();
    },
  });
}

// --- DNS ---------------------------------------------------------------------------------

export function recordForm(tok: string, z: Zone, type = "A"): FormSpec {
  return form({
    title: `New DNS Record · ${z.name}`,
    submitTitle: "Create Record",
    fields: [
      field.dropdown("type", "Type", RECORD_TYPES, { value: type }),
      field.text("name", "Name", { required: true, placeholder: `www, @ for ${z.name}, or a full name` }),
      field.text("content", "Content", {
        required: true,
        placeholder: "IPv4 for A, IPv6 for AAAA, a hostname for CNAME/MX, text for TXT",
      }),
      field.checkbox("proxied", "Proxied through Cloudflare (A, AAAA, CNAME)", { value: true }),
      field.text("ttl", "TTL", { placeholder: "auto, or seconds (60–86400)" }),
      field.text("priority", "Priority", { placeholder: "MX and SRV only (default 10)" }),
      field.text("comment", "Comment", { placeholder: "Optional note" }),
    ],
    async submit(values) {
      const body = recordBody(values as Record<string, string>, z.name);
      await cf(tok, `/zones/${z.id}/dns_records`, { method: "POST", body });
      changed();
      await toast(`Created ${body.type} ${body.name}`, { style: "success" });
      return pop();
    },
  });
}

async function recordsOf(tok: string, z: Zone, signal?: AbortSignal): Promise<DnsRecord[]> {
  return (await cfAll<any>(tok, `/zones/${z.id}/dns_records`, signal, 100)).map((r) => mapRecord(r, z));
}

function recordItem(tok: string, r: DnsRecord, z: Zone, multiZone: boolean): Item {
  const short = shortName(r.name, r.zoneName);
  const actions: Action[] = [
    copy(r.content, "Copy Content"),
    copy(r.name, "Copy Name", { shortcut: "<Ctrl>period", section: "Copy" }),
    copy(zoneFileLine(r), "Copy as Zone File Line", { icon: Icons.text, section: "Copy" }),
    copy(r.id, "Copy Record ID", { icon: Icons.hash, section: "Copy" }),
  ];
  if (r.proxiable) {
    actions.push(action(r.proxied ? "Switch to DNS Only" : "Proxy Through Cloudflare", async () => {
      await cf(tok, `/zones/${r.zoneId}/dns_records/${r.id}`, { method: "PATCH", body: { proxied: !r.proxied } });
      changed();
      await toast(`${r.name} is ${r.proxied ? "DNS only" : "proxied"}`, { style: "success" });
    }, {
      icon: Icons.cloud,
      shortcut: "<Ctrl><Shift>x",
      section: "Record",
      confirm: r.proxied ? `Expose the origin of ${r.name}? DNS only answers with ${r.content}.` : undefined,
    }));
  }
  actions.push(
    action("Add Record", () => recordForm(tok, z, r.type), {
      icon: Icons.plus,
      shortcut: "<Ctrl>n",
      section: "Record",
    }),
    open(dnsDashboardUrl(z), "Open DNS in Dashboard", { icon: Icons.globe, shortcut: "<Ctrl>o", section: "Record" }),
    action("Delete Record", async () => {
      await cf(tok, `/zones/${r.zoneId}/dns_records/${r.id}`, { method: "DELETE" });
      changed();
      await toast(`Deleted ${r.type} ${r.name}`, { style: "success" });
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Delete ${r.type} ${r.name} → ${r.content}?`,
      shortcut: "<Ctrl>Delete",
      section: "Danger",
    }),
  );
  return {
    id: r.id,
    title: short,
    subtitle: r.priority !== undefined ? `${r.priority} ${r.content}` : r.content,
    icon: {
      source: r.proxied ? Icons.cloud : Icons.globe,
      tint: r.proxied ? "orange" : "gray",
    },
    section: multiZone ? r.zoneName : undefined,
    keywords: [r.name, r.type, r.content, r.comment ?? "", ...r.tags, r.proxied ? "proxied" : "dns only"],
    accessories: [
      ...(r.comment ? [{ icon: Icons.comment, tooltip: r.comment }] : []),
      ...(r.ttl !== 1 ? [{ text: ttlLabel(r.ttl), tooltip: "TTL" }] : []),
      { tag: r.type, color: TYPE_COLORS[r.type] ?? "gray" },
    ],
    detail: {
      markdown: r.type === "TXT" || r.content.length > 60 ? `\`\`\`\n${r.content}\n\`\`\`` : undefined,
      metadata: [
        meta.text("Name", r.name, { icon: Icons.globe }),
        meta.tags("Type", [{ text: r.type, color: TYPE_COLORS[r.type] ?? "gray" }]),
        ...(r.content.length <= 60 ? [meta.text("Content", r.content)] : []),
        ...(r.priority !== undefined ? [meta.text("Priority", r.priority)] : []),
        meta.text(
          "Proxy",
          r.proxied ? "Proxied" : r.proxiable ? "DNS only" : "DNS only (not proxiable)",
          { icon: Icons.cloud, color: r.proxied ? "orange" : "gray" },
        ),
        meta.text("TTL", ttlLabel(r.ttl), { icon: Icons.clock }),
        ...(r.comment ? [meta.text("Comment", r.comment, { icon: Icons.comment })] : []),
        ...(r.tags.length ? [meta.tags("Tags", r.tags)] : []),
        meta.separator(),
        meta.text("Zone", r.zoneName, { icon: Icons.layers }),
        ...(r.modified ? [meta.text("Modified", formatDate(r.modified), { icon: Icons.calendar })] : []),
      ],
    },
    actions,
  };
}

const FILTERS: { value: RecordFilter; title: string }[] = [
  { value: "all", title: "All" },
  { value: "address", title: "A / AAAA" },
  { value: "cname", title: "CNAME" },
  { value: "mx", title: "MX" },
  { value: "txt", title: "TXT" },
  { value: "proxied", title: "Proxied" },
  { value: "dns-only", title: "DNS Only" },
];

/**
 * DNS records of one zone, or of every zone when `zone` is undefined.
 * Reloads by itself after a create, a proxy toggle or a delete.
 */
export function dnsView(tok: () => string, zone?: Zone): ListSpec {
  let summary = "";
  let known: Zone[] = zone ? [zone] : [];
  const addActions = (): Action[] =>
    zone ? [action("Add Record", () => recordForm(tok(), zone), { icon: Icons.plus, shortcut: "<Ctrl>n" })] : [
      submenu(
        "Add Record",
        () => known.map((z) => action(z.name, () => recordForm(tok(), z), { icon: Icons.globe })),
        { icon: Icons.plus, shortcut: "<Ctrl>n" },
      ),
    ];
  return list({
    title: zone ? `DNS · ${zone.name}` : undefined,
    placeholder: zone ? `Filter ${zone.name} records by name, type, content…` : "Filter DNS records…",
    filter: { options: FILTERS, default: "all" },
    empty: {
      title: "No records",
      description: "Nothing matches this filter. Press Ctrl+N to add a record.",
      icon: Icons.globe,
    },
    status: () => summary,
    actions: addActions(),
    items: ({ signal, filter }) =>
      live(
        () =>
          guarded(async () => {
            const t = tok();
            const zs = zone ? [zone] : (known = (await loadZones(t, signal)).filter((z) => z.status !== "deleted"));
            const all = (await Promise.all(zs.map((z) => recordsOf(t, z, signal)))).flat();
            const shown = sortRecords(filterRecords(all, (filter ?? "all") as RecordFilter));
            const proxied = all.filter((r) => r.proxied).length;
            summary = `${all.length} record${all.length === 1 ? "" : "s"} · ${proxied} proxied${
              zone ? ` · ${zone.name}` : ` · ${zs.length} zone${zs.length === 1 ? "" : "s"}`
            }`;
            const byId = new Map(zs.map((z) => [z.id, z]));
            return shown.map((r) => recordItem(t, r, byId.get(r.zoneId)!, zs.length > 1));
          }, signal),
        signal,
      ),
  });
}
