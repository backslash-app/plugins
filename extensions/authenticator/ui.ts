// Forms and list rows shared by the commands.

import {
  type Action,
  action,
  clipboard,
  close,
  copy,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  meta,
  open,
  paste,
  pop,
  submenu,
  toast,
} from "@backslash/api";
import {
  type Account,
  accountFrom,
  ALGORITHMS,
  buildOtpauth,
  capturePackages,
  displayName,
  groupCode,
  installCommand,
  installMarkdown,
  parseExport,
  parseLinks,
  secondsLeft,
  tintFor,
  totp,
} from "./lib.ts";
import {
  addAccounts,
  type AddResult,
  expandHome,
  exportFiles,
  family,
  type KeyringState,
  type Loaded,
  MissingTool,
  notifyChanged,
  remove,
  rename,
  scanClipboardImage,
  scanScreen,
  session,
  tilde,
  VaultError,
} from "./system.ts";

export interface Prefs {
  passphrase?: string;
  showNext?: boolean;
}

/** "Added GitHub", "Added 4 accounts · 1 already there". */
export function addedMessage(r: AddResult, skipped: string[] = []): string {
  const n = r.added.length;
  const what = n === 1
    ? `Added ${r.added[0].issuer || r.added[0].account}`
    : n
    ? `Added ${n} accounts`
    : "Nothing new to add";
  return [
    what,
    r.duplicates ? `${r.duplicates} already there` : "",
    skipped.length ? `${skipped.length} skipped` : "",
  ].filter(Boolean).join(" · ");
}

async function save(accounts: Account[], prefs: Prefs, skipped: string[] = []): Promise<AddResult> {
  try {
    const r = await addAccounts(accounts, prefs.passphrase);
    await toast(addedMessage(r, skipped), {
      style: r.added.length ? "success" : "info",
      message: skipped.length
        ? `Skipped: ${skipped.slice(0, 4).join(", ")}${skipped.length > 4 ? "…" : ""}`
        : undefined,
    });
    return r;
  } catch (e) {
    if (e instanceof VaultError || e instanceof MissingTool) {
      await toast(e.message, { style: "failure" });
      throw e;
    }
    throw e;
  }
}

/** After a form: back to the list, or close when the form is the command itself. */
const done = (standalone: boolean, message: string) => (standalone ? close(message) : pop());

/** Issuer, account, secret, digits, period, algorithm. */
export function manualForm(prefs: Prefs, standalone = false): FormSpec {
  return form({
    title: "Add Account Manually",
    submitTitle: "Add Account",
    fields: [
      field.text("issuer", "Issuer", { placeholder: "GitHub, Google, Proton…" }),
      field.text("account", "Account", { placeholder: "ada@example.com" }),
      field.password("secret", "Secret key", { required: true, placeholder: "JBSW Y3DP EHPK 3PXP" }),
      field.dropdown("digits", "Digits", [{ value: "6", title: "6 digits" }, { value: "7", title: "7 digits" }, {
        value: "8",
        title: "8 digits",
      }], { value: "6" }),
      field.text("period", "Period (seconds)", { value: "30", placeholder: "30" }),
      field.dropdown("algorithm", "Algorithm", ALGORITHMS.map((a) => ({ value: a, title: a.replace("SHA", "SHA-") })), {
        value: "SHA1",
      }),
    ],
    async submit(values) {
      let a: Account;
      try {
        a = accountFrom({
          issuer: String(values.issuer ?? ""),
          account: String(values.account ?? ""),
          secret: String(values.secret ?? ""),
          digits: String(values.digits ?? "6"),
          period: String(values.period ?? "30"),
          algorithm: String(values.algorithm ?? "SHA1"),
        });
      } catch (e) {
        await toast((e as Error).message, { style: "failure" });
        return;
      }
      const r = await save([a], prefs).catch(() => undefined);
      if (!r) return;
      return done(standalone, addedMessage(r));
    },
  });
}

/** One or more otpauth:// (or otpauth-migration://) links. */
export async function linkForm(prefs: Prefs, standalone = false): Promise<FormSpec> {
  let clip = "";
  try {
    const text = (await clipboard.read()).trim();
    if (/^otpauth(-migration)?:\/\//i.test(text)) clip = text;
  } catch {
    // No clipboard access: an empty field.
  }
  return form({
    title: "Add from otpauth:// Link",
    submitTitle: "Add",
    fields: [
      field.textArea("links", "Links", {
        required: true,
        value: clip,
        placeholder: "otpauth://totp/GitHub:ada?secret=…&issuer=GitHub (one per line)",
      }),
    ],
    async submit(values) {
      let parsed;
      try {
        parsed = parseLinks(String(values.links ?? ""));
      } catch (e) {
        await toast((e as Error).message, { style: "failure" });
        return;
      }
      if (!parsed.accounts.length) {
        await toast("No valid link", { style: "failure", message: parsed.skipped.join(", ") });
        return;
      }
      const r = await save(parsed.accounts, prefs, parsed.skipped).catch(() => undefined);
      if (!r) return;
      return done(standalone, addedMessage(r, parsed.skipped));
    },
  });
}

/** An Aegis / 2FAS plain JSON export, or a text file of links. */
export async function importForm(prefs: Prefs): Promise<FormSpec> {
  const files = await exportFiles();
  return form({
    title: "Import from Aegis or 2FAS",
    submitTitle: "Import",
    fields: [
      field.text("path", "Export file", {
        required: true,
        value: files[0] ? tilde(files[0].path) : "",
        placeholder: "~/Downloads/aegis-export.json",
      }),
      field.checkbox("delete", "Delete the file after importing (it holds your secrets in clear)", { value: true }),
    ],
    async submit(values) {
      const path = expandHome(String(values.path ?? ""));
      let text: string;
      try {
        text = await Deno.readTextFile(path);
      } catch (e) {
        await toast(
          e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied
            ? "Put the export in ~/Downloads or ~/Documents"
            : `Can't read ${tilde(path)}`,
          { style: "failure" },
        );
        return;
      }
      let parsed;
      try {
        parsed = parseExport(text);
      } catch (e) {
        await toast((e as Error).message, { style: "failure" });
        return;
      }
      const r = await save(parsed.accounts, prefs, parsed.skipped).catch(() => undefined);
      if (!r) return;
      if (values.delete) await Deno.remove(path).catch(() => {});
      return pop();
    },
  });
}

function renameForm(e: Loaded): FormSpec {
  return form({
    title: `Rename ${e.issuer || e.account}`,
    submitTitle: "Save",
    fields: [
      field.text("issuer", "Issuer", { value: e.issuer }),
      field.text("account", "Account", { value: e.account }),
    ],
    async submit(values) {
      const issuer = String(values.issuer ?? "").trim();
      const account = String(values.account ?? "").trim();
      if (!issuer && !account) {
        await toast("Give the account an issuer or a name", { style: "failure" });
        return;
      }
      await rename(e.id, issuer, account);
      return pop();
    },
  });
}

const scanScreenAction = (o: { section?: string } = {}) =>
  action("Scan QR Code on Screen", async () => {
    try {
      await scanScreen();
    } catch (e) {
      if (!(e instanceof MissingTool)) throw e;
      const fam = await family();
      const packages = e.packages.length ? e.packages : capturePackages(session());
      await toast(e.message, {
        style: "failure",
        message: `Install it: ${fam ? installCommand(packages, fam) : packages.join(", ")}`,
      });
      return;
    }
    return close("Select the QR code…");
  }, { icon: Icons.scan, section: o.section });

const scanClipboardAction = (prefs: Prefs, o: { section?: string } = {}) =>
  action("Scan QR Code in Copied Picture", async () => {
    let text: string | undefined;
    try {
      text = await scanClipboardImage();
    } catch (e) {
      await toast((e as Error).message, { style: "failure" });
      return;
    }
    if (!text) {
      await toast("No QR code found in the copied picture", { style: "failure" });
      return;
    }
    let parsed;
    try {
      parsed = parseLinks(text);
    } catch {
      await toast("Not a two-factor QR code", { style: "failure", message: "It holds no otpauth:// link" });
      return;
    }
    await save(parsed.accounts, prefs, parsed.skipped).catch(() => {});
  }, { icon: Icons.image, section: o.section });

/** Every way to add an account, for the action panel. */
export function addActions(prefs: Prefs): Action[] {
  return [
    action("Paste otpauth:// Link", () => linkForm(prefs), { icon: Icons.link }),
    scanScreenAction(),
    scanClipboardAction(prefs),
    action("Enter Secret Key", () => manualForm(prefs), { icon: Icons.key }),
    action("Import from Aegis or 2FAS", () => importForm(prefs), { icon: Icons.download }),
  ];
}

/** Rows to add accounts, shown under the codes. */
export function addItems(prefs: Prefs, ring: KeyringState): Item[] {
  const where = ring === "ok"
    ? "The secret goes to your system keyring."
    : prefs.passphrase
    ? "No keyring found: the secret is encrypted with your vault passphrase."
    : "";
  const rows: [string, string, string, string, () => Action][] = [
    [
      "link",
      "Paste otpauth:// Link",
      Icons.link,
      "The **otpauth://** link behind a QR code, from a password manager or a website's “can't scan?” option. Several links, one per line, work too, and so do Google Authenticator exports (**otpauth-migration://**).",
      () => action("Paste Link", () => linkForm(prefs), { icon: Icons.link }),
    ],
    [
      "scan",
      "Scan QR Code on Screen",
      Icons.scan,
      "Select the QR code the website shows. The launcher hides, you draw a rectangle around the code, and the account is added the next time you open Authenticator.",
      () => scanScreenAction(),
    ],
    [
      "clipboard",
      "Scan QR Code in Copied Picture",
      Icons.image,
      "Copy a screenshot of the QR code (most screenshot tools copy it), then run this.",
      () => scanClipboardAction(prefs),
    ],
    [
      "manual",
      "Enter Secret Key",
      Icons.key,
      "Type the setup key the website shows (letters A–Z and digits 2–7), with the issuer and account. Digits, period and algorithm are almost always 6, 30 s and SHA-1.",
      () => action("Enter Secret Key", () => manualForm(prefs), { icon: Icons.key }),
    ],
    [
      "import",
      "Import from Aegis or 2FAS",
      Icons.download,
      "A **plain** (unencrypted) JSON export of Aegis or 2FAS, or a text file of otpauth:// links, in ~/Downloads or ~/Documents. Delete the file once imported: it holds your secrets in clear.",
      () => action("Import File", () => importForm(prefs), { icon: Icons.download }),
    ],
  ];
  return rows.map(([id, title, icon, about, act]) => ({
    id: `add:${id}`,
    title,
    icon: { source: icon, tint: "gray" },
    section: "Add Account",
    keywords: ["add", "ajouter", "new", "nouveau"],
    detail: { markdown: `${about}${where ? `\n\n${where}` : ""}` },
    actions: [act()],
  }));
}

/** What to do when secrets can't be stored anywhere yet. */
export async function setupItem(ring: KeyringState, error?: string): Promise<Item> {
  const fam = await family();
  const markdown = [
    "## Where your secrets go",
    "",
    "Authenticator keeps each secret in your **system keyring** (GNOME Keyring, KWallet, KeePassXC) through `secret-tool`, never in a plain file.",
    "",
    ring === "missing"
      ? installMarkdown("Install `secret-tool`:", ["secret-tool"], fam)
      : "The keyring isn't reachable right now: log in to a desktop session with a keyring, or unlock it.",
    "",
    "Without a keyring, set a **Vault passphrase** in **Settings → Extensions → Authenticator → Configure**: secrets are then encrypted (AES-256-GCM) with it before being stored.",
  ].join("\n");
  return {
    id: "setup",
    title: error ?? (ring === "missing" ? "Install secret-tool to store secrets" : "No keyring available"),
    subtitle: "or set a vault passphrase",
    icon: { source: Icons.lock, tint: "orange" },
    section: "Setup",
    detail: { markdown },
    actions: [action("Check Again", () => notifyChanged(), { icon: Icons.refresh })],
  };
}

export interface Codes {
  now: string;
  next: string;
  left: number;
}

export async function codesFor(e: Loaded, seconds: number): Promise<Codes | undefined> {
  if (!e.key) return undefined;
  const [now, next] = await Promise.all([totp(e.key, seconds, e), totp(e.key, seconds + e.period, e)]);
  return { now, next, left: secondsLeft(seconds, e.period) };
}

export function codeItem(e: Loaded, c: Codes | undefined, prefs: Prefs): Item {
  const { title, subtitle } = displayName(e);
  const tint = tintFor(e.issuer || e.account);
  const danger = [
    action("Rename", () => renameForm(e), { icon: Icons.text, section: "Account", shortcut: "<Ctrl>r" }),
    ...(e.secret
      ? [
        copy(
          buildOtpauth({ ...e, secret: e.secret }),
          "Copy otpauth:// Link",
          { icon: Icons.link, concealed: true, section: "Account" },
        ),
        copy(e.secret, "Copy Secret Key", { icon: Icons.key, concealed: true, section: "Account" }),
      ]
      : []),
    action("Delete Account", async () => {
      await remove(e.id);
      await toast(`Deleted ${title}`, { style: "success" });
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Delete ${title}? You won't be able to sign in with it without another 2FA method`,
      shortcut: "<Ctrl>Delete",
      section: "Danger",
    }),
  ];
  if (!c) {
    return {
      id: e.id,
      title,
      subtitle,
      icon: { source: Icons.alert, tint: "orange" },
      section: "Accounts",
      accessories: [{ text: "Locked", icon: Icons.lock, color: "orange" }],
      detail: {
        markdown: `**${e.error ?? "The secret can't be read"}**`,
        metadata: [meta.text("Stored in", e.store === "keyring" ? "System keyring" : "Vault (passphrase)", {
          icon: Icons.lock,
        })],
      },
      actions: [action("Try Again", () => notifyChanged(), { icon: Icons.refresh }), ...danger],
    };
  }
  const urgent = c.left <= 5;
  const code = groupCode(c.now);
  const next = groupCode(c.next);
  return {
    id: e.id,
    title,
    subtitle,
    icon: { source: Icons.shield, tint },
    section: "Accounts",
    keywords: [e.account, e.issuer, "code"].filter(Boolean),
    accessories: [
      { tag: code, color: urgent ? ("red" as const) : tint },
      ...(prefs.showNext !== false && urgent ? [{ text: `next ${next}`, color: "gray" as const }] : []),
      { text: `${c.left}s`, icon: Icons.timer, color: urgent ? ("red" as const) : ("gray" as const) },
    ],
    detail: {
      stats: [
        { label: "code", value: code, color: urgent ? "red" : tint },
        ...(prefs.showNext !== false ? [{ label: "next", value: next }] : []),
        { label: "seconds left", value: c.left, color: urgent ? "red" : undefined },
      ],
      metadata: [
        meta.progress("Valid for", c.left / e.period, `${c.left} s of ${e.period}`),
        meta.separator(),
        ...(e.issuer ? [meta.text("Issuer", e.issuer, { icon: Icons.globe })] : []),
        ...(e.account ? [meta.text("Account", e.account, { icon: Icons.person })] : []),
        meta.tags("Parameters", [
          `${e.digits} digits`,
          `${e.period} s`,
          { text: e.algorithm.replace("SHA", "SHA-"), color: e.algorithm === "SHA1" ? undefined : "purple" },
        ]),
        meta.text("Stored in", e.store === "keyring" ? "System keyring" : "Vault (encrypted)", { icon: Icons.lock }),
        meta.text("Added", new Date(e.added).toLocaleDateString([], { dateStyle: "medium" }), {
          icon: Icons.calendar,
        }),
      ],
    },
    actions: [
      copy(c.now, "Copy Code", { concealed: true }),
      paste(c.now, "Paste Code", { concealed: true }),
      copy(c.next, "Copy Next Code", { concealed: true, shortcut: "<Ctrl>n", icon: Icons.next, section: "Copy" }),
      ...danger,
      submenu("Add Account", addActions(prefs), { icon: Icons.plus, shortcut: "<Ctrl><Shift>n", section: "Add" }),
      open("https://2fa.directory/", "Find Sites Supporting 2FA", { icon: Icons.external, section: "Add" }),
    ],
  };
}
