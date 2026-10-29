import { type Context, Icons, type Item, list, type Metadata } from "@backslash/api";
import { armoredKind, usableKeys } from "../lib.ts";
import {
  clipboardContent,
  type FileEntry,
  fileEntry,
  gpgKeys,
  prefRecipients,
  sshRecipients,
  tools,
} from "../system.ts";
import {
  armoredItem,
  batchItem,
  type Choices,
  clipboardHint,
  decryptItem,
  describeEncrypted,
  encryptItem,
  gpgKeyItem,
  made,
  madeItem,
  missingItem,
  nextChange,
  type Prefs,
  recipientItem,
  textItem,
} from "../ui.ts";

let status = "";

export default (ctx: Context) => {
  const prefs = ctx.preferences as Prefs;
  return list({
    placeholder: "Copied files and text to encrypt or decrypt…",
    empty: { title: "Nothing to encrypt", description: "Copy files or text first", icon: Icons.lock },
    status: () => status,
    // Rows first; who encrypted files are for fills in after.
    async *items({ signal }) {
      const [t, { paths, text }, ssh, keys] = await Promise.all([
        tools(),
        clipboardContent(),
        sshRecipients(),
        gpgKeys().catch(() => []),
      ]);
      const pref = prefRecipients(prefs.age_recipients);
      const c: Choices = { age: [...pref.recipients, ...ssh], gpg: usableKeys(keys), t, prefs };
      const files = (await Promise.all(paths.map(fileEntry))).filter((f): f is FileEntry => !!f);
      const encrypted = files.filter((f) => f.scheme !== "unknown");
      const plain = files.filter((f) => f.scheme === "unknown");
      const armored = armoredKind(text);
      const details = new Map<string, Metadata[]>();
      status = [
        files.length ? `${files.length} copied` : text.trim() ? "Text copied" : "",
        `${c.age.length} age recipients`,
        `${c.gpg.length} GPG keys`,
      ].filter(Boolean).join(" · ");
      const build = (): Item[] => [
        ...(t.age || t.gpg ? [] : [missingItem()]),
        ...(pref.invalid.length
          ? [{
            id: "invalid",
            title: `${pref.invalid.length} recipient${
              pref.invalid.length === 1 ? "" : "s"
            } in the preferences can't be read`,
            subtitle: pref.invalid.join(", "),
            icon: { source: Icons.alert, tint: "orange" as const },
            section: "Setup",
            detail: {
              markdown:
                "Recipients are age public keys (`age1…`) or SSH public keys (`ssh-ed25519 AAAA…`), one per line, with an optional name: `age1… # Alice`.",
            },
          }]
          : []),
        ...made.map(madeItem),
        ...(armored ? [armoredItem(text, armored, prefs, t)] : []),
        ...(!armored && text.trim() && !files.length ? [textItem(text, c)] : []),
        ...encrypted.map((f) => decryptItem(f, "Clipboard", prefs, t, details.get(f.path))),
        ...(plain.filter((f) => !f.dir).length > 1 ? [batchItem(plain.filter((f) => !f.dir), c)] : []),
        ...plain.map((f) => encryptItem(f, "Clipboard", c)),
        ...(files.length || text.trim() ? [] : [clipboardHint(c)]),
        ...c.age.map(recipientItem),
        ...c.gpg.map(gpgKeyItem),
      ];
      yield build();
      for (const f of encrypted) {
        if (signal.aborted) return;
        details.set(f.path, await describeEncrypted(f).catch(() => []));
        yield build();
      }
      while (!signal.aborted) {
        await nextChange(signal);
        yield build();
      }
    },
  });
};
