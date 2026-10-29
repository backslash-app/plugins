import { action, copy, Icons, list, refresh } from "@backslash/api";
import { health, sortByExpiry } from "../lib.ts";
import { findFiles, type LocalCert, MissingTool, mkcertRoot, readLocal } from "../system.ts";
import { certItem, errorItem, missingItem, warnDaysOf } from "../views.ts";
import { generateForm } from "./generate.ts";

let summary = "";

export default list({
  placeholder: "Filter local certificates by name, issuer, path…",
  filter: {
    options: [{ value: "all", title: "All" }, { value: "soon", title: "Expiring & Expired" }, {
      value: "mkcert",
      title: "mkcert",
    }],
    default: "all",
  },
  empty: {
    title: "No certificate found",
    description: "None in the mkcert CA folder or your project folders. Ctrl+N makes one with mkcert",
    icon: Icons.lock,
  },
  status: () => summary,
  actions: [
    action("Generate Local Certificate", () => generateForm(), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
    action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
  ],
  async items({ preferences, filter, signal }) {
    summary = "";
    const warnDays = warnDaysOf(preferences);
    let root: LocalCert | undefined;
    let certs: LocalCert[];
    let truncated = false;
    try {
      const [r, found] = await Promise.all([mkcertRoot(signal), findFiles()]);
      root = r;
      truncated = found.truncated;
      certs = await readLocal(found.files.filter((f) => f.path !== r?.path), signal);
    } catch (e) {
      if (e instanceof MissingTool) return [missingItem(e)];
      if (signal.aborted) throw e;
      return [errorItem(e, "Could not list certificates")];
    }
    const all = sortByExpiry([...(root ? [root] : []), ...certs]);
    const view = filter ?? "all";
    const shown = all.filter((c) =>
      view === "all" ||
      (view === "mkcert" && (c.origin === "mkcert CA" || /mkcert development/i.test(c.cert.issuer))) ||
      (view === "soon" && ["expired", "expiring"].includes(health(c.cert, warnDays)))
    );
    const bad = all.filter((c) => ["expired", "expiring"].includes(health(c.cert, warnDays))).length;
    summary = `${all.length} certificate${all.length === 1 ? "" : "s"}${bad ? ` · ${bad} expiring or expired` : ""}${
      truncated ? " · first 300 files" : ""
    }`;
    return shown.map((c) =>
      certItem(c, {
        id: c.path,
        section: c.origin === "mkcert CA"
          ? "mkcert CA"
          : health(c.cert, warnDays) === "valid"
          ? "Valid"
          : "Needs Attention",
        path: c.path,
        hasKey: c.hasKey,
        warnDays,
        actions: c.origin === "mkcert CA"
          ? [copy("mkcert -install", "Copy mkcert -install", { icon: Icons.terminal, section: "mkcert" })]
          : [
            ...(c.hasKey
              ? [
                copy(c.path.replace(/(\.pem|\.crt)$/i, "-key.pem"), "Copy Key Path", {
                  icon: Icons.key,
                  section: "Copy",
                }),
              ]
              : []),
            action("Renew with mkcert", () => generateForm(c.cert.names.join(" "), c.path.replace(/\/[^/]+$/, "")), {
              icon: Icons.refresh,
              section: "mkcert",
            }),
          ],
      })
    );
  },
});
