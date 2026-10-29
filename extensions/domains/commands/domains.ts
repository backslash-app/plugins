import { Icons, list, updateCommandMetadata } from "@backslash/api";
import { expiryState } from "../lib.ts";
import { domainItem, errorItem, loadDomains, setupItem, warnDaysOf } from "../views.ts";

let summary = "";

export default list({
  placeholder: "Filter domains by name, registrar…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "soon", title: "Expiring Soon" },
      { value: "manual", title: "Auto-Renew Off" },
    ],
    default: "all",
  },
  empty: {
    title: "No domain here",
    description: "Nothing in this view: Tab shows all your domains",
    icon: Icons.globe,
  },
  status: () => summary,
  async items({ preferences, filter, signal }) {
    summary = "";
    const warnDays = warnDaysOf(preferences);
    let loaded;
    try {
      loaded = await loadDomains(preferences, signal);
    } catch (e) {
      if (signal.aborted) throw e;
      return [errorItem(e)];
    }
    const { entries, problems, connected } = loaded;
    if (!connected && !problems.length) return [setupItem()];
    const soon = entries.filter((e) => ["soon", "expired"].includes(expiryState(e.domain, warnDays)));
    const manual = entries.filter((e) => e.domain.autoRenew === false);
    summary = `${entries.length} domain${entries.length === 1 ? "" : "s"}${
      soon.length ? ` · ${soon.length} expiring within ${warnDays} days` : ""
    }${manual.length ? ` · ${manual.length} without auto-renew` : ""}`;
    updateCommandMetadata({ subtitle: soon.length ? `${soon.length} expiring soon` : null }).catch(() => {});
    const view = filter ?? "all";
    const shown = view === "soon" ? soon : view === "manual" ? manual : entries;
    const multi = new Set(entries.map((e) => e.domain.registrar)).size > 1;
    return [...problems, ...shown.map((e) => domainItem(e.reg, e.domain, warnDays, multi))];
  },
});
