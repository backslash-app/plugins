import { Icons, type Item, list, submenu } from "@backslash/api";
import { type DnsRecord, filterRecords, mapLimit, type RecordFilter, sortRecords } from "../lib.ts";
import { addRecordMenu, errorItem, live, loadDomains, RECORD_FILTERS, recordItem, setupItem } from "../views.ts";

let summary = "";

// The records of every domain served by its registrar's DNS, shown as each domain answers.
export default list({
  placeholder: "Filter DNS records by name, type, content, domain…",
  filter: { options: RECORD_FILTERS, default: "all" },
  empty: { title: "No records", description: "Nothing matches this filter", icon: Icons.globe },
  status: () => summary,
  actions: [
    submenu("Add Record", async ({ preferences, signal }) => {
      const { entries } = await loadDomains(preferences, signal);
      return addRecordMenu(entries);
    }, { icon: Icons.plus, shortcut: "<Ctrl>n" }),
  ],
  items: ({ preferences, filter, signal }) =>
    live(async () => {
      summary = "";
      const loaded = await loadDomains(preferences, signal).catch((e) => {
        if (signal.aborted) throw e;
        return e as Error;
      });
      if (loaded instanceof Error) return [errorItem(loaded)];
      const { entries, problems, connected } = loaded;
      if (!connected && !problems.length) return [setupItem()];
      const editable = entries.filter((e) => e.domain.dns);
      const errors: Item[] = [...problems];
      const results = await mapLimit(editable, 4, async (e) => {
        try {
          return { e, records: await e.reg.records(e.domain, signal) };
        } catch (err) {
          if (signal.aborted) throw err;
          errors.push({ ...errorItem(err, e.domain.registrar), title: `${e.domain.name}: ${(err as Error).message}` });
          return { e, records: [] as DnsRecord[] };
        }
      });
      const all = results.flatMap((r) => r.records);
      const shown = sortRecords(filterRecords(all, (filter ?? "all") as RecordFilter));
      const byDomain = new Map(results.map((r) => [`${r.e.domain.registrar}:${r.e.domain.name}`, r]));
      summary = `${all.length} record${all.length === 1 ? "" : "s"} · ${editable.length} domain${
        editable.length === 1 ? "" : "s"
      }`;
      const items = shown.map((r) => {
        const { e, records } = byDomain.get(`${r.registrar}:${r.domain}`)!;
        return recordItem(e.reg, e.domain, r, records, true);
      });
      return [...errors, ...items];
    }, signal),
});
