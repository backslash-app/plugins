import { copy, Icons, type Item, list, meta, open } from "@backslash/api";
import { certName, chainRole, covers, expiryText, parseTarget, targetText, verifyLook } from "../lib.ts";
import { connect } from "../system.ts";
import { certItem, errorItem, warnDaysOf } from "../views.ts";

let summary = "";

export default list({
  placeholder: "Filter the chain…",
  empty: { title: "No certificate", description: "The server sent none", icon: Icons.lock },
  status: () => summary,
  async items({ args, preferences, signal }) {
    summary = "";
    let target;
    try {
      target = parseTarget(String(args.host ?? ""));
    } catch (e) {
      return [errorItem(e, "Not a host")];
    }
    const name = targetText(target);
    try {
      const { chain, handshake: h } = await connect(target, signal);
      const warnDays = warnDaysOf(preferences);
      const leaf = chain[0];
      const v = verifyLook(h.verifyCode, h.verifyText);
      const nameOk = covers(leaf.cert, target.host);
      summary = `${name} · ${v.title} · ${chain.length} certificate${chain.length === 1 ? "" : "s"}`;
      const connection: Item = {
        id: "connection",
        title: name,
        subtitle: [h.protocol, h.cipher].filter(Boolean).join(" · "),
        icon: { source: Icons.shield, tint: v.color },
        section: "Connection",
        accessories: [{ tag: v.title, color: v.color }, { text: expiryText(leaf.cert) }],
        detail: {
          metadata: [
            meta.text("Verification", h.verifyText ? `${v.title} (${h.verifyText})` : v.title, {
              icon: Icons.shield,
              color: v.color,
            }),
            meta.text(
              "Host name",
              nameOk ? `${certName(leaf.cert)} covers ${target.host}` : `Not covered by the certificate`,
              {
                icon: Icons.globe,
                color: nameOk ? "green" : "red",
              },
            ),
            ...(h.protocol ? [meta.text("Protocol", h.protocol, { icon: Icons.lock })] : []),
            ...(h.cipher ? [meta.text("Cipher", h.cipher)] : []),
            ...(h.tempKey ? [meta.text("Key exchange", h.tempKey, { icon: Icons.key })] : []),
            meta.text("Chain", `${chain.length} certificate${chain.length === 1 ? "" : "s"} sent`, {
              icon: Icons.layers,
            }),
          ],
        },
        actions: [
          open(`https://${name}`, "Open in Browser"),
          copy(chain.map((l) => l.pem).join("\n"), "Copy Chain as PEM", {
            icon: Icons.file,
            shortcut: "<Ctrl><Shift>c",
          }),
          copy(
            `openssl s_client -connect ${name} -servername ${target.host} -showcerts </dev/null`,
            "Copy openssl Command",
            { icon: Icons.terminal, section: "Copy" },
          ),
          open(
            `https://www.ssllabs.com/ssltest/analyze.html?d=${encodeURIComponent(target.host)}`,
            "Test on SSL Labs",
            {
              icon: Icons.external,
              section: "More",
            },
          ),
        ],
      };
      return [
        connection,
        ...chain.map((l, i) =>
          certItem(l, {
            id: `chain:${i}:${l.fp.sha256}`,
            section: "Chain",
            role: chainRole(i, l.cert, chain.length),
            host: i === 0 ? target.host : undefined,
            warnDays,
          })
        ),
      ];
    } catch (e) {
      if (signal.aborted) throw e;
      return [errorItem(e, `No certificate from ${name}`)];
    }
  },
});
