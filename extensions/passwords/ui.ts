// Entries as launcher items. Secrets never appear in an item: actions fetch
// them when run, put them on the clipboard and close the launcher.

import {
  type Action,
  action,
  clipboard,
  close,
  type Context,
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
  pop,
  refresh,
  toast,
} from "@backslash/api";
import {
  bwLock,
  bwUnlock,
  HOME,
  keepassDb,
  keepassLock,
  keepassUnlock,
  type Loaded,
  passStore,
  reveal,
  type Secret,
} from "./backends.ts";
import { type BackendId, BACKENDS, type Entry, hostOf } from "./lib.ts";

export const backendOf = (id: BackendId) => BACKENDS.find((b) => b.id === id)!;

const LABEL: Record<Secret, string> = { password: "Password", username: "Username", totp: "One-time code" };

function secretAction(entry: Entry, what: Secret, prefs: Record<string, unknown>, how: "copy" | "paste", o: {
  shortcut?: string;
  section?: string;
} = {}): Action {
  const title = `${how === "copy" ? "Copy" : "Paste"} ${what === "totp" ? "One-Time Code" : LABEL[what]}`;
  return action(title, async () => {
    const value = await reveal(entry, what, prefs);
    if (how === "paste") {
      await clipboard.paste(value);
      return close();
    }
    await clipboard.write(value);
    return close(`${LABEL[what]} copied`);
  }, {
    icon: what === "totp"
      ? Icons.timer
      : what === "username"
      ? Icons.person
      : how === "paste"
      ? Icons.paste
      : Icons.key,
    ...o,
  });
}

export interface ItemOptions {
  prefs: Record<string, unknown>;
  several: boolean;
  passOtp: boolean;
  section?: string;
}

/** Whether to offer a one-time code: known for Bitwarden, possible elsewhere. */
function offersTotp(entry: Entry, passOtp: boolean): boolean {
  if (entry.backend === "pass") return passOtp;
  if (entry.backend === "bitwarden") return entry.totp === true;
  return true;
}

function entryMetadata(entry: Entry, o: ItemOptions): Metadata[] {
  const b = backendOf(entry.backend);
  const lines: Metadata[] = [meta.tags("Manager", [{ text: b.name, color: b.tint }])];
  if (entry.username) lines.push(meta.text("Username", entry.username, { icon: Icons.person }));
  else if (entry.backend === "pass" || entry.backend === "keepassxc") {
    lines.push(meta.text("Username", "Read when copied", { icon: Icons.person }));
  }
  lines.push(meta.text("Password", "••••••••••••", { icon: Icons.lock }));
  if (entry.backend === "bitwarden") {
    lines.push(meta.text("One-time code", entry.totp ? "Yes" : "No", {
      icon: Icons.timer,
      color: entry.totp ? "green" : undefined,
    }));
  } else if (offersTotp(entry, o.passOtp)) {
    lines.push(meta.text("One-time code", "If the entry has one", { icon: Icons.timer }));
  }
  const host = hostOf(entry.url);
  if (entry.url && host) {
    lines.push(meta.link("Website", host, /^https?:/i.test(entry.url) ? entry.url : `https://${host}`));
  }
  if (entry.folder) {
    const label = entry.backend === "1password" ? "Vault" : entry.backend === "keepassxc" ? "Group" : "Folder";
    lines.push(meta.text(label, entry.folder, { icon: Icons.folder }));
  }
  if (entry.category) lines.push(meta.text("Category", entry.category));
  if (entry.favorite) lines.push(meta.text("Favorite", "Yes", { icon: Icons.starFilled, color: "yellow" }));
  if (entry.modified) {
    lines.push(meta.text("Modified", new Date(entry.modified).toLocaleDateString("en", { dateStyle: "medium" }), {
      icon: Icons.clock,
    }));
  }
  return lines;
}

export function entryItem(entry: Entry, o: ItemOptions): Item {
  const b = backendOf(entry.backend);
  const host = hostOf(entry.url);
  const url = entry.url && host ? (/^https?:/i.test(entry.url) ? entry.url : `https://${host}`) : undefined;
  const totp = offersTotp(entry, o.passOtp);
  return {
    id: `${entry.backend}:${entry.ref}`,
    title: entry.title,
    subtitle: entry.username && entry.username !== entry.title ? entry.username : entry.folder,
    icon: { source: Icons.key, tint: b.tint },
    section: o.section,
    keywords: [entry.folder ?? "", entry.username ?? "", host ?? "", entry.category ?? "", b.name].filter(Boolean),
    accessories: [
      ...(entry.favorite ? [{ icon: { source: Icons.starFilled, tint: "yellow" as const }, tooltip: "Favorite" }] : []),
      ...(entry.totp ? [{ icon: Icons.timer, tooltip: "Has a one-time code" }] : []),
      ...(host && host !== entry.title ? [{ text: host }] : []),
      ...(o.several ? [{ tag: b.name, color: b.tint }] : []),
    ],
    detail: { metadata: entryMetadata(entry, o) },
    actions: [
      secretAction(entry, "password", o.prefs, "copy"),
      secretAction(entry, "password", o.prefs, "paste", { shortcut: "<Ctrl><Shift>v" }),
      secretAction(entry, "username", o.prefs, "copy", { shortcut: "<Ctrl><Shift>c", section: "Username" }),
      secretAction(entry, "username", o.prefs, "paste", { section: "Username" }),
      ...(totp
        ? [secretAction(entry, "totp", o.prefs, "copy", { shortcut: "<Ctrl>t", section: "One-Time Code" })]
        : []),
      ...(url ? [open(url, "Open Website", { icon: Icons.globe, shortcut: "<Ctrl>o", section: "Website" })] : []),
      ...lockActions(entry.backend),
    ],
  };
}

function lockActions(id: BackendId): Action[] {
  if (id === "bitwarden") {
    return [action("Lock Bitwarden", () => {
      bwLock();
      return refresh();
    }, { icon: Icons.lock, section: "Manager" })];
  }
  if (id === "keepassxc") {
    return [action("Lock KeePassXC Database", () => {
      keepassLock();
      return refresh();
    }, { icon: Icons.lock, section: "Manager" })];
  }
  return [];
}

// --- Unlocking and setup ---------------------------------------------------------

export function bitwardenUnlockForm(email?: string): FormSpec {
  return form({
    title: "Unlock Bitwarden",
    submitTitle: "Unlock",
    fields: [
      field.password("password", email ? `Master password for ${email}` : "Master password", { required: true }),
    ],
    async submit(values) {
      await bwUnlock(String(values.password ?? ""));
      await toast("Bitwarden unlocked", { style: "success", message: "Until the launcher closes" });
      return pop();
    },
  });
}

export function keepassUnlockForm(prefs: Record<string, unknown>): FormSpec {
  const db = keepassDb(prefs) ?? "";
  return form({
    title: `Unlock ${db.split("/").pop()}`,
    submitTitle: "Unlock",
    fields: [field.password("password", "Database password", { required: true })],
    async submit(values) {
      const n = await keepassUnlock(prefs, String(values.password ?? ""));
      await toast(`${n} entries unlocked`, { style: "success", message: "The password is kept in memory only" });
      return pop();
    },
  });
}

const tilde = (p: string) => (HOME && p.startsWith(`${HOME}/`) ? `~${p.slice(HOME.length)}` : p);

function help(title: string, markdown: string, actions: Action[] = []): DetailSpec {
  return detail({ title, markdown, actions });
}

const BW_LOGIN = help(
  "Log in to Bitwarden",
  `# Log in to Bitwarden once

The Bitwarden CLI is installed but not logged in. In a terminal:

\`\`\`sh
bw config server https://vault.example.com   # only for a self-hosted or EU server
bw login
\`\`\`

Then come back: Backslash asks for your master password to **unlock** the vault
(\`bw unlock\`) and keeps the session in memory until the launcher closes.

To stay unlocked longer, run \`bw unlock --raw\` and paste the session key in
**Settings → Extensions → Passwords → Bitwarden session**: it is kept in your
system keyring.`,
  [open("https://bitwarden.com/help/cli/", "Bitwarden CLI Documentation")],
);

const OP_SIGNIN = (message?: string) =>
  help(
    "Sign in to 1Password",
    `# Connect the 1Password CLI

The \`op\` command is installed but not signed in${message ? ` (\`${message.replace(/`/g, "'")}\`)` : ""}.

The simplest way: in the **1Password app → Settings → Developer**, turn on
**Integrate with 1Password CLI**. \`op\` then asks the app, which unlocks with
your system authentication, and Backslash works with no further setup.

Sessions created with \`eval $(op signin)\` live in a terminal's environment and
are not seen by the launcher.`,
    [open("https://developer.1password.com/docs/cli/app-integration/", "1Password CLI App Integration")],
  );

const KEEPASS_SETUP = help(
  "Choose a KeePassXC database",
  `# Choose your database

Set the path of your \`.kdbx\` file in **Settings → Extensions → Passwords →
KeePassXC database** (and a key file if you use one).

Backslash asks for the database password when you open the list, checks it with
\`keepassxc-cli\`, and keeps it **in memory only** until the launcher closes.
It is never saved.`,
);

/** The row shown for a manager that can't list its entries yet. */
export function stateItem(l: Exclude<Loaded, { state: "ready" }>, ctx: Context, several: boolean): Item {
  const b = backendOf(l.backend);
  const base = {
    id: `state:${l.backend}`,
    section: several ? b.name : "Setup",
    accessories: several ? [{ tag: b.name, color: b.tint }] : [],
  };
  const prefs = ctx.preferences;
  if (l.state === "error") {
    return {
      ...base,
      title: `${b.name} failed`,
      subtitle: l.detail,
      icon: { source: Icons.alert, tint: "red" },
      detail: { markdown: `\`\`\`\n${l.detail}\n\`\`\`` },
      actions: [action("Try Again", () => refresh(), { icon: Icons.refresh })],
    };
  }
  switch (l.backend) {
    case "bitwarden":
      return l.state === "signed-out"
        ? {
          ...base,
          title: "Log in to Bitwarden",
          subtitle: "Run `bw login` once in a terminal",
          icon: { source: Icons.person, tint: b.tint },
          actions: [action("Show How", () => BW_LOGIN, { icon: Icons.info })],
        }
        : {
          ...base,
          title: "Unlock Bitwarden",
          subtitle: l.detail ? `Vault of ${l.detail} is locked` : "Your vault is locked",
          icon: { source: Icons.lock, tint: b.tint },
          actions: [action("Unlock", () => bitwardenUnlockForm(l.detail), { icon: Icons.key })],
        };
    case "1password":
      return {
        ...base,
        title: "Sign in to 1Password",
        subtitle: "Turn on the 1Password app's CLI integration",
        icon: { source: Icons.person, tint: b.tint },
        actions: [
          action("Show How", () => OP_SIGNIN(l.detail), { icon: Icons.info }),
          action("Try Again", () => refresh(), {
            icon: Icons.refresh,
          }),
        ],
      };
    case "keepassxc":
      return l.state === "unconfigured"
        ? {
          ...base,
          title: "Choose a KeePassXC database",
          subtitle: "Set its path in the extension's settings",
          icon: { source: Icons.settings, tint: b.tint },
          actions: [action("Show How", () => KEEPASS_SETUP, { icon: Icons.info })],
        }
        : {
          ...base,
          title: `Unlock ${String(l.detail ?? "").split("/").pop()}`,
          subtitle: tilde(String(l.detail ?? "")),
          icon: { source: Icons.lock, tint: b.tint },
          actions: [action("Unlock", () => keepassUnlockForm(prefs), { icon: Icons.key })],
        };
    case "pass":
      return {
        ...base,
        title: "Set up pass",
        subtitle: l.detail ?? `No store in ${tilde(passStore())}`,
        icon: { source: Icons.settings, tint: b.tint },
        actions: [open("https://www.passwordstore.org/#setup", "Open pass Setup Guide")],
      };
  }
}
