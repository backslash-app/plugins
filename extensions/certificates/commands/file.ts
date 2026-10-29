import { clipboard, Icons, type Item, list } from "@backslash/api";
import { expandHome, hasPrivateKey, parseTarget, pemBlocks } from "../lib.ts";
import { HOME, type Loaded, readFile, readPems } from "../system.ts";
import { certItem, errorItem, warnDaysOf } from "../views.ts";

let summary = "";

const keyWarning: Item = {
  id: "private-key",
  title: "This text also holds a private key",
  subtitle: "It was not read: only certificates are shown",
  icon: { source: Icons.lock, tint: "orange" },
  section: "Note",
};

/** A certificate file given as argument, else the PEM text of the clipboard. */
export default list({
  placeholder: "Filter certificates…",
  empty: { title: "No certificate", description: "Give a .pem or .crt file, or copy a PEM block", icon: Icons.lock },
  status: () => summary,
  async items({ args, preferences, signal }) {
    summary = "";
    const warnDays = warnDaysOf(preferences);
    const input = String(args.path ?? "").trim();
    let loaded: Loaded[];
    let path: string | undefined;
    let extra: Item[] = [];
    try {
      if (input) {
        path = expandHome(input.replace(/^file:\/\//, ""), HOME);
        loaded = await readFile(path, signal);
      } else {
        const text = await clipboard.read();
        const pems = pemBlocks(text);
        if (!pems.length) {
          let host = "";
          try {
            host = parseTarget(text.split("\n")[0]).host;
          } catch {
            // Not a host either.
          }
          return [{
            id: "empty",
            title: "No certificate in the clipboard",
            subtitle: host
              ? `It holds a host name: use Inspect TLS Certificate with ${host}`
              : "Copy a -----BEGIN CERTIFICATE----- block, or give a file path",
            icon: { source: Icons.paste, tint: "gray" },
          }];
        }
        if (hasPrivateKey(text)) extra = [keyWarning];
        loaded = await readPems(pems, signal);
      }
    } catch (e) {
      if (signal.aborted) throw e;
      return [errorItem(e)];
    }
    summary = `${loaded.length} certificate${loaded.length === 1 ? "" : "s"}${
      path ? ` in ${path.split("/").pop()}` : " from the clipboard"
    }`;
    return [
      ...extra,
      ...loaded.map((l, i) =>
        certItem(l, {
          id: `${i}:${l.fp.sha256}`,
          section: loaded.length > 1 ? "Bundle" : undefined,
          role: loaded.length > 1 ? (i === 0 ? "First" : `#${i + 1}`) : undefined,
          path,
          warnDays,
        })
      ),
    ];
  },
});
