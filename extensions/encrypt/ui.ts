// Rows, recipient menus, forms, and the views that show results.

import {
  type Action,
  action,
  copy,
  detail,
  type DetailSpec,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  paste,
  pop,
  refresh,
  replace,
  submenu,
  toast,
} from "@backslash/api";
import {
  agePassphraseArgs,
  ageStanzas,
  asText,
  decryptedPath,
  dirname,
  encryptedPath,
  formatBytes,
  type GpgKey,
  gpgSymmetricArgs,
  groupedFingerprint,
  plural,
  type Recipient,
  recipientsOf,
  recipientTitle,
  splitUid,
} from "./lib.ts";
import {
  decrypt,
  encryptFile,
  encryptText,
  exists,
  type FileEntry,
  fileEntry,
  gpgKeys,
  gpgRecipients,
  gpgSecretKeys,
  identities,
  selfRecipients,
  tilde,
  type Tools,
} from "./system.ts";
import { holdOpen, runInTerminal } from "./terminal.ts";

export interface Prefs {
  age_recipients?: string;
  age_identity?: string;
  armor?: boolean;
  encrypt_to_self?: boolean;
  terminal?: string;
}

/** What the menus offer: age recipients (preferences, ~/.ssh) and usable GPG keys. */
export interface Choices {
  age: Recipient[];
  gpg: GpgKey[];
  t: Tools;
  prefs: Prefs;
}

/** Files this session made, shown on top. */
export const made: FileEntry[] = [];

// The list stays live: encrypting or decrypting a file wakes it up.
const changes = new EventTarget();
export const changed = () => changes.dispatchEvent(new Event("change"));
export function nextChange(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      changes.removeEventListener("change", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    changes.addEventListener("change", done);
    signal.addEventListener("abort", done);
  });
}

const keyTitle = (k: GpgKey) => k.uids[0] ?? k.keyId;

async function selfKeys(tool: "age" | "gpg", prefs: Prefs): Promise<string[]> {
  if (prefs.encrypt_to_self === false) return [];
  if (tool === "age") return await selfRecipients(await identities(prefs.age_identity));
  const own = (await gpgSecretKeys()).find((k) => k.canEncrypt && !k.expired && !k.revoked);
  return own ? [own.fingerprint] : [];
}

async function encryptFiles(
  tool: "age" | "gpg",
  files: FileEntry[],
  recipients: string[],
  who: string,
  prefs: Prefs,
): Promise<boolean> {
  const self = await selfKeys(tool, prefs);
  const ext = tool === "age" ? "age" : prefs.armor ? "asc" : "gpg";
  const done: string[] = [];
  for (const f of files.filter((f) => !f.dir)) {
    const out = encryptedPath(f.path, ext, exists);
    try {
      await encryptFile(tool, f.path, out, recipients, { armor: prefs.armor, self });
      done.push(out);
    } catch (e) {
      await toast(`Couldn't encrypt ${f.name}`, { style: "failure", message: (e as Error).message });
      return false;
    }
  }
  for (const p of done) {
    const f = await fileEntry(p);
    if (f) made.unshift(f);
  }
  changed();
  await toast(done.length === 1 ? `Saved ${done[0].split("/").pop()}` : `Encrypted ${plural(done.length, "file")}`, {
    style: "success",
    message: `For ${who}${self.length ? " and you" : ""}`,
  });
  return true;
}

function inTerminal(argv: string[], prefs: Prefs, what: string): Promise<void> {
  try {
    runInTerminal(holdOpen(argv), prefs.terminal || undefined);
    return toast(`${what} in the terminal`, { message: "Refresh here (Ctrl+R) when it's done" });
  } catch (e) {
    return toast((e as Error).message, { style: "failure" });
  }
}

// ---------------------------------------------------------------------------
// Encrypting

function recipientsForm(
  tool: "age" | "gpg",
  files: FileEntry[] | undefined,
  text: string | undefined,
  c: Choices,
): FormSpec {
  const options = tool === "age"
    ? c.age.map((r) => ({ id: r.key, title: `${recipientTitle(r)} (${r.source})` }))
    : c.gpg.map((k) => ({ id: k.fingerprint, title: keyTitle(k) }));
  return form({
    title: tool === "age" ? "Encrypt with age" : "Encrypt with GPG",
    submitTitle: "Encrypt",
    fields: options.map((o, n) => field.checkbox(`r${n}`, o.title, { value: false })),
    async submit(values) {
      const picked = options.filter((_, n) => values[`r${n}`] === true);
      if (!picked.length) {
        await toast("Pick at least one recipient", { style: "failure" });
        return;
      }
      const who = picked.length === 1 ? picked[0].title : plural(picked.length, "recipient");
      if (files) {
        if (await encryptFiles(tool, files, picked.map((p) => p.id), who, c.prefs)) return pop();
        return;
      }
      return await encryptedTextView(tool, text ?? "", picked.map((p) => p.id), who, c.prefs);
    },
  });
}

async function encryptedTextView(
  tool: "age" | "gpg",
  text: string,
  recipients: string[],
  who: string,
  prefs: Prefs,
): Promise<DetailSpec | undefined> {
  let armored: string;
  try {
    armored = await encryptText(tool, text, recipients, await selfKeys(tool, prefs));
  } catch (e) {
    await toast("Couldn't encrypt", { style: "failure", message: (e as Error).message });
    return;
  }
  return detail({
    title: "Encrypted Text",
    markdown: "```\n" + armored.trim() + "\n```",
    metadata: [
      meta.text("For", who, { icon: Icons.person }),
      meta.text("With", tool === "age" ? "age" : "OpenPGP (gpg)", { icon: Icons.lock }),
      meta.text("Length", plural(armored.length, "character"), { icon: Icons.text }),
    ],
    actions: [
      // Ciphertext is safe in clipboard history.
      copy(armored, "Copy Encrypted Text"),
      paste(armored, "Paste Encrypted Text", { shortcut: "<Ctrl><Shift>v" }),
    ],
  });
}

/** The encrypt menus for files (or for text when `files` is undefined). */
export function encryptActions(files: FileEntry[] | undefined, text: string | undefined, c: Choices): Action[] {
  const run = (tool: "age" | "gpg", keys: string[], who: string) => async () => {
    if (files) {
      await encryptFiles(tool, files, keys, who, c.prefs);
      return refresh();
    }
    return await encryptedTextView(tool, text ?? "", keys, who, c.prefs);
  };
  const one = files?.length === 1 ? files[0] : undefined;
  const actions: Action[] = [];
  if (c.t.age) {
    actions.push(submenu("Encrypt with age", [
      ...c.age.map((r) =>
        action(`For ${recipientTitle(r)}`, run("age", [r.key], recipientTitle(r)), {
          icon: r.kind === "ssh" ? Icons.key : Icons.person,
        })
      ),
      ...(c.age.length > 1
        ? [action("For Several Recipients…", () => recipientsForm("age", files, text, c), { icon: Icons.layers })]
        : []),
      ...(one
        ? [action("With a Passphrase (in a Terminal)", () =>
          inTerminal(
            ["age", ...agePassphraseArgs(one.path, encryptedPath(one.path, "age", exists), c.prefs.armor)],
            c.prefs,
            "Type the passphrase",
          ), { icon: Icons.terminal })]
        : []),
    ], { icon: Icons.lock, shortcut: "<Ctrl>a", section: "Encrypt" }));
  }
  if (c.t.gpg) {
    actions.push(submenu("Encrypt with GPG", [
      ...c.gpg.map((k) => action(`For ${keyTitle(k)}`, run("gpg", [k.fingerprint], keyTitle(k)), { icon: Icons.key })),
      ...(c.gpg.length > 1
        ? [action("For Several Keys…", () => recipientsForm("gpg", files, text, c), { icon: Icons.layers })]
        : []),
      ...(one
        ? [action("With a Passphrase (in a Terminal)", () =>
          inTerminal(
            [
              "gpg",
              ...gpgSymmetricArgs(
                one.path,
                encryptedPath(one.path, c.prefs.armor ? "asc" : "gpg", exists),
                c.prefs.armor,
              ),
            ],
            c.prefs,
            "Type the passphrase",
          ), { icon: Icons.terminal })]
        : []),
    ], { icon: Icons.key, shortcut: "<Ctrl>g", section: "Encrypt" }));
  }
  return actions;
}

const noRecipients = (c: Choices) => !c.age.length && !c.gpg.length;

export function encryptItem(f: FileEntry, section: string, c: Choices): Item {
  return {
    id: `${section}:${f.path}`,
    title: f.name,
    subtitle: f.dir ? "Folders can't be encrypted: compress it first" : tilde(dirname(f.path)),
    icon: { source: f.dir ? Icons.folder : Icons.file, tint: f.dir ? "gray" : "blue" },
    section,
    accessories: f.dir ? [] : [{ text: formatBytes(f.size) }],
    detail: {
      markdown: f.dir
        ? "age and gpg encrypt files. Make an archive of the folder first (the **Archives** extension does it), then encrypt the archive."
        : noRecipients(c)
        ? "No recipient yet: add age public keys in the extension's preferences, put SSH public keys in **~/.ssh**, or import GPG keys. Encrypting with a passphrase works anyway."
        : `Encrypted next to it as **${f.name}.age** or **${f.name}.gpg**, for the recipient you pick.`,
      metadata: [
        meta.text("Size", formatBytes(f.size), { icon: Icons.drive }),
        meta.text("Folder", tilde(dirname(f.path)), { icon: Icons.folder }),
      ],
    },
    actions: f.dir ? [open(f.path, "Open Folder", { icon: Icons.folder })] : [
      ...encryptActions([f], undefined, c),
      copy(f.path, "Copy Path", { section: "File", shortcut: "<Ctrl><Shift>c" }),
      open(dirname(f.path), "Open Folder", { icon: Icons.folder, section: "File", shortcut: "<Ctrl>o" }),
    ],
  };
}

export function batchItem(files: FileEntry[], c: Choices): Item {
  const total = files.reduce((s, f) => s + f.size, 0);
  return {
    id: "batch",
    title: `Encrypt All ${files.length} Copied Files`,
    subtitle: "One encrypted file next to each",
    icon: { source: Icons.layers, tint: "purple" },
    section: "Clipboard",
    accessories: [{ text: formatBytes(total) }],
    detail: { markdown: files.map((f) => `- ${f.name}`).join("\n") },
    actions: encryptActions(files, undefined, c),
  };
}

export function textItem(text: string, c: Choices): Item {
  const lines = text.split("\n").length;
  return {
    id: "text",
    title: "Encrypt the Copied Text",
    subtitle: `${plural(text.length, "character")}${
      lines > 1 ? ` · ${plural(lines, "line")}` : ""
    } → armored text to copy`,
    icon: { source: Icons.text, tint: "blue" },
    section: "Clipboard",
    detail: {
      markdown: noRecipients(c)
        ? "No recipient yet: add age public keys in the extension's preferences, put SSH public keys in **~/.ssh**, or import GPG keys."
        : "The copied text is encrypted for the recipient you pick, as armored text you can paste in a mail or a chat.",
      metadata: [meta.text("Length", plural(text.length, "character"), { icon: Icons.text })],
    },
    actions: encryptActions(undefined, text, c),
  };
}

// ---------------------------------------------------------------------------
// Decrypting

/** A decrypted text: hidden until revealed, copied out of clipboard history. */
export function secretView(bytes: Uint8Array, name: string, revealed = false): DetailSpec {
  const text = asText(bytes);
  if (text === undefined) {
    return detail({
      title: name,
      markdown: `**${name}** isn't text (${formatBytes(bytes.length)}): decrypt it to a file instead.`,
    });
  }
  const lines = text.split("\n").length;
  return detail({
    title: name,
    markdown: revealed
      ? "```\n" + text.replace(/```/g, "ˋˋˋ") + "\n```"
      : `**Decrypted: ${plural(text.length, "character")}, ${
        plural(lines, "line")
      }.**\n\nHidden. Press **Ctrl+R** to show it. Copying keeps it out of clipboard history.`,
    metadata: [meta.text("Length", plural(text.length, "character"), { icon: Icons.text })],
    actions: [
      copy(text, "Copy (Kept out of History)", { concealed: true }),
      paste(text, "Paste (Kept out of History)", { concealed: true, shortcut: "<Ctrl><Shift>v" }),
      revealed
        ? action("Hide", () => replace(secretView(bytes, name, false)), { icon: Icons.eyeOff, shortcut: "<Ctrl>r" })
        : action("Show", () => replace(secretView(bytes, name, true)), { icon: Icons.eye, shortcut: "<Ctrl>r" }),
    ],
  });
}

const toolOf = (f: FileEntry): "age" | "gpg" => (f.scheme === "age" || f.scheme === "age-passphrase" ? "age" : "gpg");

async function decryptToFile(f: FileEntry, prefs: Prefs): Promise<void> {
  const out = decryptedPath(f.path, exists);
  try {
    await decrypt(toolOf(f), { input: f.path, output: out, identities: await identities(prefs.age_identity) });
  } catch (e) {
    await toast(`Couldn't decrypt ${f.name}`, { style: "failure", message: (e as Error).message });
    return;
  }
  const entry = await fileEntry(out);
  if (entry) made.unshift(entry);
  changed();
  await toast(`Saved ${out.split("/").pop()}`, { style: "success" });
}

async function decryptedText(f: FileEntry, prefs: Prefs): Promise<DetailSpec | undefined> {
  try {
    const bytes = await decrypt(toolOf(f), { input: f.path, identities: await identities(prefs.age_identity) });
    return secretView(bytes, f.name.replace(/\.(age|gpg|pgp|asc)$/i, ""));
  } catch (e) {
    await toast(`Couldn't decrypt ${f.name}`, { style: "failure", message: (e as Error).message });
  }
}

/** Who a file is for, as far as can be told without decrypting it. */
export async function describeEncrypted(f: FileEntry): Promise<Metadata[]> {
  if (toolOf(f) === "age") {
    const file = await Deno.open(f.path, { read: true }).catch(() => undefined);
    if (!file) return [];
    const buf = new Uint8Array(8192);
    const n = (await file.read(buf).finally(() => file.close())) ?? 0;
    const stanzas = ageStanzas(buf.subarray(0, n)) ?? [];
    const kinds = stanzas.map((s) => (s === "X25519" ? "age key" : s === "scrypt" ? "passphrase" : s));
    const counted = [...new Set(kinds)].map((k) => {
      const c = kinds.filter((x) => x === k).length;
      return c > 1 ? `${c} × ${k}` : k;
    });
    return [meta.tags("Encrypted to", counted.length ? counted : ["unknown"])];
  }
  const [ids, keys, secret] = await Promise.all([gpgRecipients(f.path), gpgKeys(), gpgSecretKeys()]);
  if (!ids.length) return [meta.tags("Encrypted to", ["a passphrase"])];
  const who = recipientsOf(ids, keys);
  const mine = recipientsOf(ids, secret).filter((r) => r.key);
  return [
    meta.tags("Encrypted to", who.map((w) => (w.key ? splitUid(keyTitle(w.key)).name : w.keyId))),
    meta.tags(
      "Your keys",
      mine.length ? [{ text: "Can open it", color: "green" }] : [{ text: "No key of yours", color: "orange" }],
    ),
  ];
}

export function decryptItem(f: FileEntry, section: string, prefs: Prefs, t: Tools, lines: Metadata[] = []): Item {
  const tool = toolOf(f);
  const needsTerminal = f.scheme === "age-passphrase";
  const out = decryptedPath(f.path, exists);
  const installed = tool === "age" ? t.age : t.gpg;
  const terminalArgv = tool === "age"
    ? ["age", "-d", "-o", out, "--", f.path]
    : ["gpg", "--output", out, "--decrypt", "--", f.path];
  const toFile = action(`Decrypt to “${out.split("/").pop()}”`, async () => {
    await decryptToFile(f, prefs);
    return refresh();
  }, { icon: Icons.lock });
  const terminal = action("Decrypt in a Terminal", () => inTerminal(terminalArgv, prefs, "Decrypting"), {
    icon: Icons.terminal,
    section: "Decrypt",
  });
  return {
    id: `${section}:${f.path}`,
    title: f.name,
    subtitle: installed ? tilde(dirname(f.path)) : `Install ${tool} to decrypt it`,
    icon: { source: Icons.lock, tint: installed ? "orange" : "gray" },
    section,
    accessories: [{ tag: tool === "age" ? (needsTerminal ? "age · passphrase" : "age") : "gpg" }, {
      text: formatBytes(f.size),
    }],
    detail: {
      markdown: needsTerminal
        ? "Encrypted with a **passphrase**: it is asked in a terminal."
        : `Decrypted next to it as **${out.split("/").pop()}**.`,
      metadata: [
        ...lines,
        meta.text("Size", formatBytes(f.size), { icon: Icons.drive }),
        meta.text("Folder", tilde(dirname(f.path)), { icon: Icons.folder }),
      ],
    },
    actions: installed
      ? [
        ...(needsTerminal ? [{ ...terminal, section: undefined }] : [toFile]),
        ...(!needsTerminal && f.size < 1024 * 1024
          ? [
            action("Show Decrypted Text", () => decryptedText(f, prefs), {
              icon: Icons.eye,
              shortcut: "<Ctrl>t",
              section: "Decrypt",
            }),
          ]
          : []),
        ...(needsTerminal ? [] : [terminal]),
        copy(f.path, "Copy Path", { section: "File", shortcut: "<Ctrl><Shift>c" }),
        open(dirname(f.path), "Open Folder", { icon: Icons.folder, section: "File", shortcut: "<Ctrl>o" }),
      ]
      : [open(dirname(f.path), "Open Folder", { icon: Icons.folder })],
  };
}

export function armoredItem(text: string, kind: "age" | "gpg", prefs: Prefs, t: Tools): Item {
  const installed = kind === "age" ? t.age : t.gpg;
  return {
    id: "armored",
    title: `Decrypt the Copied ${kind === "age" ? "age" : "PGP"} Message`,
    subtitle: installed ? "Shown here, never put in clipboard history" : `Install ${kind} to decrypt it`,
    icon: { source: Icons.lock, tint: installed ? "orange" : "gray" },
    section: "Clipboard",
    detail: { markdown: "```\n" + text.trim().split("\n").slice(0, 8).join("\n") + "\n…\n```" },
    actions: installed
      ? [action("Decrypt", async () => {
        try {
          const bytes = await decrypt(kind, { text, identities: await identities(prefs.age_identity) });
          return secretView(bytes, "Decrypted Message");
        } catch (e) {
          await toast("Couldn't decrypt", { style: "failure", message: (e as Error).message });
        }
      }, { icon: Icons.lock })]
      : [],
  };
}

// ---------------------------------------------------------------------------
// Recipients, setup and hints

export function recipientItem(r: Recipient): Item {
  return {
    id: `recipient:${r.key}`,
    title: recipientTitle(r),
    subtitle: r.source,
    icon: { source: r.kind === "ssh" ? Icons.key : Icons.person, tint: "teal" },
    section: "age Recipients",
    keywords: [r.key],
    accessories: [{ tag: r.kind === "ssh" ? r.key.split(" ")[0] : r.kind === "plugin" ? "plugin" : "age" }],
    detail: { markdown: "```\n" + r.key + "\n```" },
    actions: [copy(r.key, "Copy Public Key")],
  };
}

export function gpgKeyItem(k: GpgKey): Item {
  const { name, email } = splitUid(keyTitle(k));
  return {
    id: `gpg:${k.fingerprint}`,
    title: name,
    subtitle: email,
    icon: { source: Icons.key, tint: "purple" },
    section: "GPG Keys",
    keywords: [...k.uids, k.fingerprint],
    accessories: k.expires ? [{ text: `until ${k.expires.toLocaleDateString()}` }] : [],
    detail: {
      metadata: [
        meta.text("Fingerprint", groupedFingerprint(k.fingerprint), { icon: Icons.key }),
        ...k.uids.slice(1).map((u) => meta.text("Also", u)),
        ...(k.created ? [meta.text("Created", k.created.toLocaleDateString(), { icon: Icons.calendar })] : []),
        ...(k.expires ? [meta.text("Expires", k.expires.toLocaleDateString(), { icon: Icons.clock })] : []),
      ],
    },
    actions: [copy(k.fingerprint, "Copy Fingerprint")],
  };
}

export function madeItem(f: FileEntry): Item {
  return {
    id: `made:${f.path}`,
    title: f.name,
    subtitle: tilde(dirname(f.path)),
    icon: { source: f.scheme === "unknown" ? Icons.file : Icons.lock, tint: "green" },
    section: "Just Made",
    accessories: [{ text: formatBytes(f.size) }],
    actions: [
      open(dirname(f.path), "Open Folder", { icon: Icons.folder }),
      copy(f.path, "Copy Path", { shortcut: "<Ctrl><Shift>c" }),
    ],
  };
}

export function clipboardHint(c: Choices): Item {
  return {
    id: "clipboard-hint",
    title: "Copy files in your file manager, or some text",
    subtitle: "To encrypt them, or decrypt .age and .gpg files",
    icon: { source: Icons.paste, tint: "gray" },
    section: "Clipboard",
    detail: {
      markdown: [
        "Select files in **Files**, **Dolphin**, **Thunar** or **Nemo** and press **Ctrl+C**, then open Encrypt again: plain files can be encrypted next to the original (**.age** or **.gpg**), encrypted ones decrypted.",
        "",
        "Copied text can be encrypted to armored text, and a copied age or PGP message decrypted (the result is never put in clipboard history).",
        "",
        noRecipients(c)
          ? "**No recipient yet.** Add age public keys (`age1…`) in the extension's preferences, keep SSH public keys in **~/.ssh**, or import GPG keys."
          : `${plural(c.age.length, "age recipient")} and ${plural(c.gpg.length, "GPG key")} are below.`,
      ].join("\n"),
    },
    actions: [],
  };
}

export function missingItem(): Item {
  return {
    id: "missing",
    title: "Install age or GnuPG",
    subtitle: "Needed to encrypt and decrypt",
    icon: { source: Icons.alert, tint: "orange" },
    section: "Setup",
    detail: {
      markdown: [
        "Encrypt works with **age** (simple, modern: `sudo apt install age`, `sudo pacman -S age`, `sudo dnf install age`) and **GnuPG** (`gpg`, installed on most systems).",
        "",
        "Make an age key with `age-keygen -o ~/.config/age/keys.txt`, and share the public key it prints.",
      ].join("\n"),
    },
    actions: [action("Check Again", () => refresh(), { icon: Icons.refresh })],
  };
}
