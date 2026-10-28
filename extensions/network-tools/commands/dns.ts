import { type Context, Icons, list } from "@backslash/api";
import { cleanHost, defaultTypes, isIP, RECORD_TYPES, type RecordType } from "../lib.ts";
import { dnsResultItems } from "../ui.ts";

// "example.com", "example.com mx txt", "1.1.1.1" (reverse).
export default (_: Context) =>
  list({
    placeholder: "example.com · example.com mx txt · 1.1.1.1",
    status: (items) =>
      items.length ? `${items.filter((i) => i.id?.startsWith("dns:") && i.id !== "dns:none").length} records` : "",
    empty: {
      title: "Type a domain name",
      description: "Add record types after it: example.com mx txt",
      icon: Icons.search,
    },
    search(query, ctx) {
      const [first, ...rest] = query.trim().split(/\s+/);
      const host = first ? cleanHost(first) : undefined;
      if (!host) {
        return first
          ? [{
            id: "invalid",
            title: `“${first}” isn't a host name or an IP address`,
            icon: { source: Icons.info, tint: "gray" },
          }]
          : [];
      }
      const types = rest.map((t) => t.toUpperCase()).filter((t): t is RecordType =>
        (RECORD_TYPES as readonly string[]).includes(t)
      );
      return dnsResultItems(host, types.length ? types : isIP(host) ? ["PTR"] : defaultTypes, ctx);
    },
  });
