// Views shared by the commands: OATH account rows, the add and rename forms, and the
// PIV, FIDO2 and OpenPGP rows of the overview.

import {
  type Action,
  action,
  clipboard,
  close,
  type Color,
  copy,
  detail,
  field as input,
  form,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  paste,
  pop,
  toast,
} from "@backslash/api";
import {
  type Account,
  cleanSecret,
  field,
  groupCode,
  installCommand,
  oath,
  osFamily,
  type OtpAuth,
  parseCardStatus,
  parseOtpauth,
  parseSingleCode,
  type Report,
  slotTitle,
  triesLeft,
} from "./lib.ts";
import { type Device, gpgCardStatus, NotInstalled, osRelease, releaseFromGpg, ykman } from "./system.ts";

export const changes = new EventTarget();
export const changed = () => changes.dispatchEvent(new Event("change"));

/** Yields once, then again on each change or tick, until the user leaves. */
export async function* live<T>(load: () => Promise<T>, signal: AbortSignal, every?: () => number): AsyncGenerator<T> {
  while (!signal.aborted) {
    yield await load();
    await new Promise<void>((resolve) => {
      const timer = every ? setTimeout(done, every()) : undefined;
      function done() {
        clearTimeout(timer);
        changes.removeEventListener("change", done);
        signal.removeEventListener("abort", done);
        resolve();
      }
      changes.addEventListener("change", done);
      signal.addEventListener("abort", done);
    });
  }
}

const keyLabel = (d?: Device) => (d ? `${d.name}${d.serial ? ` (${d.serial})` : ""}` : "YubiKey");

// ---------------------------------------------------------------------------
// Empty and error states

export async function installItem(): Promise<Item> {
  const command = installCommand(osFamily(await osRelease()));
  return {
    id: "install",
    title: "ykman is not installed",
    subtitle: "Install YubiKey Manager to use your YubiKey here",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "This extension talks to the key through **ykman** (YubiKey Manager); OATH, PIV and OpenPGP also need the",
        "smart card daemon **pcscd**:",
        "",
        "```",
        command,
        "```",
        "",
        "Or with pipx: `pipx install yubikey-manager`.",
      ].join("\n"),
    },
    actions: [
      copy(command, "Copy Install Command"),
      open("https://docs.yubico.com/software/yubikey/tools/ykman/", "ykman Documentation", { icon: Icons.book }),
    ],
  };
}

export function noKeyItem(): Item {
  return {
    id: "none",
    title: "No YubiKey plugged in",
    subtitle: "Plug your key in, then press Ctrl+R",
    icon: { source: Icons.key, tint: "gray" },
    detail: {
      markdown: "No YubiKey was found. If it is plugged in, check that your user may access it " +
        "(the `libu2f-udev` / `yubikey-manager` udev rules) and that **pcscd** runs.",
    },
    actions: [],
  };
}

export function errorItem(title: string, message: string, section?: string): Item {
  const gpg = /scdaemon|smart card/i.test(message);
  return {
    id: `error:${section ?? ""}:${title}`,
    title,
    subtitle: message,
    icon: { source: Icons.alert, tint: "orange" },
    section,
    detail: { markdown: message },
    actions: gpg ? [releaseAction()] : [],
  };
}

function releaseAction(): Action {
  return action("Release Key from gpg", async () => {
    await releaseFromGpg();
    await toast("gpg released the key", { style: "success" });
    changed();
  }, { icon: Icons.lock, section: "Key" });
}

// ---------------------------------------------------------------------------
// OATH

export interface Oath {
  device?: Device;
  accounts: Account[];
}

async function touchCode(o: Oath, a: Account, password?: string): Promise<string> {
  await toast(a.hotp ? "Generating the next code…" : "Touch your YubiKey…");
  const code = parseSingleCode(await ykman(oath.code(o.device?.serial, a.id, password), 45_000));
  if (!code) throw new Error("ykman returned no code");
  return code;
}

export function accountItem(o: Oath, a: Account, password: string | undefined, left: number, many: boolean): Item {
  const title = a.issuer ?? a.name;
  const tint: Color = a.touch ? "orange" : a.hotp ? "blue" : "green";
  const needsTouch = a.touch || a.hotp;
  const copyLive: Action[] = needsTouch
    ? [
      action(a.touch ? "Touch and Copy Code" : "Copy Next Code", async () => {
        const code = await touchCode(o, a, password);
        await clipboard.write(code, { concealed: true });
        return close("Code copied");
      }, { icon: Icons.copy }),
      action(a.touch ? "Touch and Paste Code" : "Paste Next Code", async () => {
        const code = await touchCode(o, a, password);
        await clipboard.paste(code, { concealed: true });
      }, { icon: Icons.paste }),
    ]
    : [
      copy(a.code ?? "", "Copy Code", { concealed: true }),
      paste(a.code ?? "", "Paste Code", { concealed: true }),
    ];
  return {
    id: `oath:${o.device?.serial ?? ""}:${a.id}`,
    title,
    subtitle: a.issuer ? a.name : undefined,
    icon: { source: a.touch ? Icons.lock : Icons.key, tint },
    section: many ? keyLabel(o.device) : undefined,
    keywords: [a.id, a.name, a.issuer ?? ""],
    accessories: a.code
      ? [{ text: `${left}s`, color: left <= 5 ? "red" : undefined, tooltip: "Seconds left" }, {
        tag: groupCode(a.code),
      }]
      : [{ tag: a.touch ? "Touch" : "HOTP", color: tint }],
    detail: {
      stats: a.code
        ? [{ label: "Code", value: groupCode(a.code) }, { label: "Expires in", value: `${left}s` }]
        : undefined,
      metadata: [
        meta.text("Issuer", a.issuer ?? "None", { icon: Icons.globe }),
        meta.text("Account", a.name, { icon: Icons.person }),
        meta.text("Type", a.hotp ? "HOTP (counter)" : "TOTP (time)", { icon: Icons.clock }),
        meta.text("Requires touch", a.touch ? "Yes" : "No", {
          icon: Icons.lock,
          color: a.touch ? "orange" : undefined,
        }),
        meta.text("Stored on", keyLabel(o.device), { icon: Icons.key }),
      ],
      markdown: a.touch
        ? "This code is computed only after you touch the key: **Enter**, then touch it."
        : a.hotp
        ? "Each HOTP code is used once: **Enter** computes the next one."
        : undefined,
    },
    actions: [
      ...copyLive,
      action("Rename…", () => renameForm(o, a, password), {
        icon: Icons.text,
        shortcut: "<Ctrl>e",
        section: "Account",
      }),
      action("Add Account…", () => addForm(o.device ? [o.device] : [], "", password), {
        icon: Icons.plus,
        shortcut: "<Ctrl>n",
        section: "Account",
      }),
      copy(a.id, "Copy Account Name", { section: "Copy" }),
      action("Delete Account", async () => {
        await ykman(oath.delete(o.device?.serial, a.id, password));
        await toast(`${title} deleted from the YubiKey`, { style: "success" });
        changed();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Delete ${a.id} from the YubiKey? You can't sign in with it any more until you set 2FA up again`,
        shortcut: "<Ctrl>Delete",
        section: "Danger",
      }),
    ],
  };
}

function renameForm(o: Oath, a: Account, password?: string) {
  return form({
    title: `Rename ${a.issuer ?? a.name}`,
    submitTitle: "Rename",
    fields: [
      input.text("issuer", "Issuer", { value: a.issuer ?? "" }),
      input.text("name", "Account", { value: a.name, required: true }),
    ],
    async submit(values) {
      const name = String(values.name ?? "").trim();
      const issuer = String(values.issuer ?? "").trim();
      if (!name) throw new Error("The account needs a name");
      await ykman(oath.rename(o.device?.serial, a.id, issuer ? `${issuer}:${name}` : name, password));
      await toast("Account renamed", { style: "success" });
      changed();
      return pop();
    },
  });
}

/** Adds from an otpauth:// link, or from a secret typed by hand. */
export function addForm(keys: Device[], uri: string, password?: string) {
  const many = keys.length > 1;
  return form({
    title: "Add Account to YubiKey",
    submitTitle: "Add",
    fields: [
      input.text("uri", "otpauth:// link", { placeholder: "otpauth://totp/GitHub:you?secret=…", value: uri }),
      input.text("issuer", "Or: issuer", { placeholder: "GitHub" }),
      input.text("name", "Account", { placeholder: "you@example.com" }),
      input.password("secret", "Secret key", { placeholder: "JBSWY3DPEHPK3PXP" }),
      input.checkbox("touch", "Require a touch for each code"),
      ...(many
        ? [input.dropdown("device", "YubiKey", keys.map((k) => ({ value: k.serial ?? "", title: keyLabel(k) })), {
          value: keys[0].serial ?? "",
        })]
        : []),
    ],
    async submit(values) {
      const serial = many ? String(values.device) : keys[0]?.serial;
      const touch = values.touch === true;
      const link = String(values.uri ?? "").trim();
      let added: OtpAuth;
      if (link) {
        added = parseOtpauth(link);
        await ykman(oath.uri(serial, link, touch, password), 30_000);
      } else {
        const name = String(values.name ?? "").trim();
        if (!name) throw new Error("Paste an otpauth:// link, or give the account name and its secret key");
        added = {
          type: "totp",
          issuer: String(values.issuer ?? "").trim() || undefined,
          name,
          secret: cleanSecret(String(values.secret ?? "")),
          digits: 6,
          period: 30,
          algorithm: "SHA1",
        };
        await ykman(oath.add(serial, added, touch, password), 30_000);
      }
      changed();
      return close(`${added.issuer ?? added.name} added to the YubiKey`);
    },
  });
}

// ---------------------------------------------------------------------------
// Overview

export function deviceItem(d: Device): Item {
  const fields = d.info?.fields ?? [];
  const firmware = d.firmware ?? field(fields, "Firmware version");
  const enabled = d.info?.applications.filter((a) => /enabled/i.test(a.usb)).map((a) => a.name) ?? [];
  const disabled = d.info?.applications.filter((a) => /disabled/i.test(a.usb)).map((a) => a.name) ?? [];
  const table = d.info?.applications.length
    ? [
      "| Application | USB | NFC |",
      "|---|---|---|",
      ...d.info.applications.map((a) => `| ${a.name} | ${a.usb} | ${a.nfc ?? "–"} |`),
    ].join("\n")
    : undefined;
  return {
    id: `device:${d.serial ?? d.name}`,
    title: d.name,
    subtitle: [d.serial ? `Serial ${d.serial}` : "", firmware ? `Firmware ${firmware}` : ""].filter(Boolean).join(
      " · ",
    ),
    icon: { source: Icons.key, tint: "green" },
    section: "YubiKeys",
    keywords: ["yubikey", d.serial ?? "", ...d.interfaces],
    accessories: d.interfaces.map((i) => ({ tag: i, color: "gray" as const })),
    detail: {
      markdown: d.error ?? table,
      metadata: [
        ...fields.map(([k, v]) => meta.text(k, v)),
        ...(d.info?.notes.length ? [meta.separator(), ...d.info.notes.map((n) => meta.text("Note", n))] : []),
        ...(enabled.length ? [meta.tags("Enabled", enabled.map((e) => ({ text: e, color: "green" as const })))] : []),
        ...(disabled.length ? [meta.tags("Disabled", disabled.map((e) => ({ text: e, color: "gray" as const })))] : []),
      ],
    },
    actions: [
      ...(d.serial ? [copy(d.serial, "Copy Serial Number")] : []),
      releaseAction(),
      open("https://docs.yubico.com/software/yubikey/tools/ykman/", "ykman Documentation", {
        icon: Icons.book,
        section: "Help",
      }),
    ],
  };
}

const fieldsMeta = (fields: [string, string][]): Metadata[] => fields.map(([k, v]) => meta.text(k, v));

export function pivItems(d: Device, r: Report, many: boolean): Item[] {
  const section = many ? `PIV · ${keyLabel(d)}` : "PIV";
  const pin = triesLeft(field(r.fields, "PIN tries remaining"));
  const puk = triesLeft(field(r.fields, "PUK tries remaining"));
  const slots = r.sections.filter((s) => /^Slot/i.test(s.title));
  const overview: Item = {
    id: `piv:${d.serial}`,
    title: "PIV Smart Card",
    subtitle: `PIN ${field(r.fields, "PIN tries remaining") ?? "?"} tries · ${slots.length} certificate${
      slots.length === 1 ? "" : "s"
    }`,
    icon: { source: Icons.shield, tint: r.warnings.length ? "orange" : "blue" },
    section,
    keywords: ["piv", "smart card", "certificate", "pin", "puk"],
    accessories: [
      ...(r.warnings.length
        ? [{ text: `${r.warnings.length} warning${r.warnings.length > 1 ? "s" : ""}`, color: "orange" as const }]
        : []),
      ...(pin === 0 ? [{ tag: "PIN blocked", color: "red" as const }] : []),
    ],
    detail: {
      stats: [
        ...(pin !== undefined
          ? [{ label: "PIN tries", value: pin, color: pin <= 1 ? "red" as const : undefined }]
          : []),
        ...(puk !== undefined
          ? [{ label: "PUK tries", value: puk, color: puk <= 1 ? "red" as const : undefined }]
          : []),
        { label: "Certificates", value: slots.length },
      ],
      markdown: r.warnings.length
        ? `${r.warnings.map((w) => `- ⚠ ${w}`).join("\n")}\n\nChange them with \`ykman piv access change-pin\`, ` +
          "`change-puk` and `change-management-key`."
        : undefined,
      metadata: fieldsMeta(r.fields),
    },
    actions: [copy(`ykman${d.serial ? ` --device ${d.serial}` : ""} piv info`, "Copy Info Command")],
  };
  const slotItems = slots.map((s): Item => {
    const subject = field(s.fields, "Subject DN") ?? field(s.fields, "Subject");
    const notAfter = field(s.fields, "Not after");
    const expired = notAfter ? Date.parse(notAfter) < Date.now() : false;
    const algorithm = field(s.fields, "Algorithm") ?? field(s.fields, "Private key type") ??
      field(s.fields, "Public key type");
    const fingerprint = field(s.fields, "Fingerprint");
    return {
      id: `piv:${d.serial}:${s.title}`,
      title: slotTitle(s.title),
      subtitle: subject ?? "Key without certificate",
      icon: { source: Icons.file, tint: expired ? "red" : "blue" },
      section,
      keywords: ["piv", "slot", "certificate", subject ?? ""],
      accessories: [
        ...(algorithm ? [{ tag: algorithm, color: "gray" as const }] : []),
        ...(notAfter
          ? [{
            text: expired ? "Expired" : `Until ${notAfter.slice(0, 10)}`,
            color: expired ? "red" as const : undefined,
          }]
          : []),
      ],
      detail: { metadata: fieldsMeta(s.fields) },
      actions: [
        ...(fingerprint ? [copy(fingerprint, "Copy Fingerprint")] : []),
        ...(subject ? [copy(subject, "Copy Subject", { section: "Copy" })] : []),
      ],
    };
  });
  return [overview, ...slotItems];
}

export function fidoItem(d: Device, r: Report, many: boolean): Item {
  const pin = field(r.fields, "PIN");
  const pinSet = pin !== undefined && !/not set/i.test(pin);
  const left = triesLeft(pin);
  const storage = field(r.fields, "Credential storage remaining");
  return {
    id: `fido:${d.serial}`,
    title: "FIDO2 / Passkeys",
    subtitle: pinSet ? `PIN set${left !== undefined ? ` · ${left} tries left` : ""}` : "No PIN set",
    icon: { source: Icons.lock, tint: pinSet ? "green" : "orange" },
    section: many ? `FIDO2 · ${keyLabel(d)}` : "FIDO2",
    keywords: ["fido", "fido2", "webauthn", "passkey", "u2f", "pin"],
    accessories: [
      ...(storage ? [{ text: `${storage} free`, tooltip: "Passkeys that still fit" }] : []),
      { tag: pinSet ? "PIN" : "No PIN", color: pinSet ? "green" : "orange" },
    ],
    detail: {
      markdown: pinSet
        ? undefined
        : "Without a PIN, websites can't store passkeys on the key. Set one with `ykman fido access change-pin`.",
      metadata: fieldsMeta(r.fields),
    },
    actions: [copy(`ykman${d.serial ? ` --device ${d.serial}` : ""} fido access change-pin`, "Copy Set PIN Command")],
  };
}

export function openpgpItem(d: Device, r: Report, many: boolean): Item {
  const pin = triesLeft(field(r.fields, "PIN tries remaining"));
  const admin = triesLeft(field(r.fields, "Admin PIN tries remaining"));
  const touch = r.sections.find((s) => /touch/i.test(s.title));
  return {
    id: `openpgp:${d.serial}`,
    title: "OpenPGP Card",
    subtitle: `Version ${field(r.fields, "OpenPGP version") ?? "?"} · PIN ${pin ?? "?"} tries`,
    icon: { source: Icons.key, tint: pin === 0 ? "red" : "purple" },
    section: many ? `OpenPGP · ${keyLabel(d)}` : "OpenPGP",
    keywords: ["openpgp", "gpg", "gnupg", "pgp", "card", "ssh"],
    accessories: pin === 0 ? [{ tag: "PIN blocked", color: "red" }] : [],
    detail: {
      stats: [
        ...(pin !== undefined
          ? [{ label: "PIN tries", value: pin, color: pin <= 1 ? "red" as const : undefined }]
          : []),
        ...(admin !== undefined
          ? [{ label: "Admin PIN tries", value: admin, color: admin <= 1 ? "red" as const : undefined }]
          : []),
      ],
      metadata: [
        ...fieldsMeta(r.fields),
        ...(touch ? [meta.separator(), ...touch.fields.map(([k, v]) => meta.text(`Touch · ${k}`, v))] : []),
      ],
    },
    actions: [
      action("Show gpg Card Status", cardStatusView, { icon: Icons.eye }),
      releaseAction(),
    ],
  };
}

async function cardStatusView() {
  let text: string;
  try {
    text = await gpgCardStatus();
  } catch (e) {
    if (e instanceof NotInstalled) throw new Error("gpg (GnuPG) is not installed");
    throw new Error(`gpg can't read the card: ${(e as Error).message}`);
  }
  const fields = parseCardStatus(text);
  const keys = fields.filter(([k]) => /key$/i.test(k) && !/URL/i.test(k));
  return detail({
    title: "gpg Card Status",
    markdown: `\`\`\`\n${text.trim()}\n\`\`\``,
    metadata: fields.filter(([, v]) => v).slice(0, 20).map(([k, v]) => meta.text(k, v)),
    actions: [
      ...keys.filter(([, v]) => v && v !== "[none]").map(([k, v]) =>
        copy(v.replace(/\s+/g, ""), `Copy ${k} Fingerprint`)
      ),
      releaseAction(),
    ],
  });
}
