// Items, actions and views shared by the commands.

import {
  type Action,
  action,
  close,
  type Color,
  type Context,
  copy,
  detail,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  openExternal,
  paste,
  refresh,
  toast,
} from "@backslash/api";
import { capturePackages, type Entry, installMarkdown, parsePayload, type PayloadKind, wifiPayload } from "./lib.ts";
import { capacity, type Ecc, TooLong } from "./qr.ts";
import {
  copyImage,
  family,
  forget,
  generate,
  type Generated,
  MissingTool,
  picturesFolder,
  remember,
  save,
  scanScreen,
  session,
  tilde,
} from "./system.ts";

export interface Prefs {
  ecc?: string;
  openLinks?: boolean;
}

export const eccOf = (ctx: Context): Ecc => {
  const e = String((ctx.preferences as Prefs).ecc ?? "M").trim().toUpperCase();
  return (["L", "M", "Q", "H"].includes(e) ? e : "M") as Ecc;
};

const ECC_NAMES: Record<Ecc, string> = {
  L: "Low (7 %)",
  M: "Medium (15 %)",
  Q: "Quartile (25 %)",
  H: "High (30 %)",
};

export const KINDS: Record<PayloadKind, { icon: string; tint: Color; name: string }> = {
  url: { icon: Icons.link, tint: "blue", name: "Link" },
  wifi: { icon: Icons.wifi, tint: "teal", name: "Wi-Fi network" },
  email: { icon: Icons.mail, tint: "orange", name: "Email" },
  phone: { icon: Icons.bell, tint: "green", name: "Phone number" },
  sms: { icon: Icons.comment, tint: "green", name: "Text message" },
  geo: { icon: Icons.pin, tint: "red", name: "Location" },
  contact: { icon: Icons.person, tint: "purple", name: "Contact" },
  otp: { icon: Icons.key, tint: "yellow", name: "One-time password" },
  event: { icon: Icons.calendar, tint: "pink", name: "Event" },
  text: { icon: Icons.text, tint: "gray", name: "Text" },
};

/** Copies the text (concealed when it holds a secret), opens what can be opened. */
function contentActions(text: string, secret: boolean, openTarget?: string): Action[] {
  const fields = parsePayload(text).fields.filter((f) => f.secret);
  return [
    ...(openTarget ? [open(openTarget, "Open", { icon: Icons.external })] : []),
    copy(text, "Copy Text", { concealed: secret, section: "Copy" }),
    paste(text, "Paste Text", { concealed: secret, section: "Copy" }),
    ...fields.map((f) => copy(f.value, `Copy ${f.label}`, { concealed: true, section: "Copy", icon: Icons.key })),
  ];
}

/** Copy the picture, save PNG/SVG. */
function imageActions(text: string, g: Generated): Action[] {
  return [
    action("Copy QR Code Image", async () => {
      if (!(await copyImage(g.file))) {
        await toast("Couldn't copy the picture", { style: "failure", message: "Install wl-clipboard or xclip" });
        return;
      }
      await remember([{ kind: "generated", text, at: Date.now() }]);
      return close("QR code copied");
    }, { icon: Icons.image, shortcut: "<Ctrl><Shift>c" }),
    action("Save to Pictures", async () => {
      const path = await save(text, g, "png");
      await remember([{ kind: "generated", text, at: Date.now() }]);
      await toast(`Saved to ${tilde(path)}`, { style: "success" });
      return close();
    }, { icon: Icons.download, shortcut: "<Ctrl>s", section: "Save" }),
    action("Save as SVG", async () => {
      const path = await save(text, g, "svg");
      await toast(`Saved to ${tilde(path)}`, { style: "success" });
      return close();
    }, { icon: Icons.download, section: "Save" }),
    copy(g.file, "Copy Image Path", { section: "Save", icon: Icons.file }),
    action("Open QR Codes Folder", async () => {
      const folder = await picturesFolder();
      await Deno.mkdir(folder, { recursive: true }).catch(() => {});
      await openExternal(folder);
      return close();
    }, { icon: Icons.folder, section: "Save" }),
  ];
}

/** A text as a QR code: the picture in the detail panel. */
export async function qrItem(
  text: string,
  ecc: Ecc,
  o: { id?: string; section?: string; subtitle?: string; extra?: Metadata[]; actions?: Action[] } = {},
): Promise<Item> {
  const p = parsePayload(text);
  const kind = KINDS[p.kind];
  let g: Generated;
  try {
    g = await generate(text, ecc);
  } catch (e) {
    if (!(e instanceof TooLong)) throw e;
    return {
      id: o.id ?? "too-long",
      title: "Too long for a QR code",
      subtitle: `${new TextEncoder().encode(text).length} bytes; at most ${capacity("byte", ecc)} at level ${ecc}`,
      icon: { source: Icons.alert, tint: "orange" },
      section: o.section,
      detail: { markdown: "Shorten the text, or pick the **Low** error correction level in the preferences." },
    };
  }
  const shown = p.secret ? p.fields.map((f) => (f.secret ? { ...f, value: "••••••••" } : f)) : p.fields;
  return {
    id: o.id ?? `qr:${text}`,
    title: p.secret ? p.title : text.length > 120 ? `${text.slice(0, 120)}…` : text.split("\n")[0],
    subtitle: o.subtitle ?? kind.name,
    icon: { source: Icons.qr, tint: kind.tint },
    section: o.section,
    detail: {
      image: g.file,
      metadata: [
        meta.tags("Content", [{ text: kind.name, color: kind.tint }]),
        ...shown.map((f) => meta.text(f.label, f.value)),
        meta.separator(),
        meta.text("Version", `${g.code.version} · ${g.code.size} × ${g.code.size} modules`, { icon: Icons.qr }),
        meta.text("Error correction", ECC_NAMES[g.code.ecc], { icon: Icons.shield }),
        meta.text("Encoding", g.code.mode === "byte" ? "Bytes (UTF-8)" : g.code.mode, { icon: Icons.text }),
        ...(o.extra ?? []),
      ],
    },
    actions: [...imageActions(text, g), ...contentActions(text, !!p.secret, p.open), ...(o.actions ?? [])],
  };
}

/** A history line: generated ones show their code, scanned ones the picture they came from. */
export async function entryItem(e: Entry, ecc: Ecc): Promise<Item> {
  const when = new Date(e.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const remove = action("Remove from History", async () => {
    await forget(e);
    return refresh();
  }, { icon: Icons.trash, destructive: true, section: "Danger" });
  const clear = action("Clear History", async () => {
    await forget();
    return refresh();
  }, { icon: Icons.trash, destructive: true, section: "Danger", confirm: "Forget every generated and scanned code?" });
  if (e.kind === "generated") {
    return await qrItem(e.text, ecc, {
      id: `history:${e.kind}:${e.text}`,
      section: "Recent",
      subtitle: `Generated · ${when}`,
      extra: [meta.text("Created", when, { icon: Icons.history })],
      actions: [remove, clear],
    });
  }
  const p = parsePayload(e.text);
  const kind = KINDS[p.kind];
  const shown = p.fields.map((f) => (f.secret ? { ...f, value: "••••••••" } : f));
  return {
    id: `history:${e.kind}:${e.text}`,
    title: p.title,
    subtitle: `Scanned · ${when}`,
    icon: { source: kind.icon, tint: kind.tint },
    section: "Recent",
    accessories: [{ tag: kind.name }],
    detail: {
      image: e.image,
      markdown: p.secret || p.kind === "url" ? undefined : "```\n" + e.text.slice(0, 3000) + "\n```",
      metadata: [
        meta.tags("Content", [{ text: kind.name, color: kind.tint }]),
        ...shown.map((f) => meta.text(f.label, f.value)),
        meta.separator(),
        meta.text("Scanned", when, { icon: Icons.scan }),
      ],
    },
    actions: [
      ...contentActions(e.text, !!p.secret, p.open),
      action("Show as QR Code", async () => {
        const item = await qrItem(e.text, ecc);
        return list({ title: "QR Code", items: [item] });
      }, { icon: Icons.qr, section: "Copy" }),
      remove,
      clear,
    ],
  };
}

// ---------------------------------------------------------------------------
// Scanning

/** Hides the launcher and starts the background scan; failures become an explanation. */
export const startScan = (ctx: Context) => async () => {
  try {
    await scanScreen({ openLinks: !!(ctx.preferences as Prefs).openLinks });
  } catch (e) {
    if (e instanceof MissingTool) {
      const fam = await family();
      const packages = e.packages.length ? e.packages : capturePackages(session());
      return detail({
        title: "Scan QR Code",
        markdown: installMarkdown(`**${e.message}.** Install it, then try again.`, packages, fam),
      });
    }
    throw e;
  }
  return close();
};

export function scanItem(ctx: Context): Item {
  return {
    id: "scan",
    title: "Scan QR Code on Screen",
    subtitle: "Select the code: the text is copied",
    icon: { source: Icons.scan, tint: "blue" },
    section: "Scan",
    keywords: ["scan", "read", "decode", "lire", "scanner", "screen", "écran"],
    detail: {
      markdown:
        "Drag a rectangle around a QR code anywhere on the screen. Its content is copied, shown in a notification and kept in the history here. Wi-Fi passwords and one-time password seeds are not copied: open this command to see them.",
    },
    actions: [action("Scan QR Code on Screen", startScan(ctx), { icon: Icons.scan })],
  };
}

// ---------------------------------------------------------------------------
// Wi-Fi

export function wifiForm(ecc: Ecc) {
  return form({
    title: "Wi-Fi QR Code",
    submitTitle: "Create QR Code",
    fields: [
      field.text("ssid", "Network name (SSID)", { required: true }),
      field.password("password", "Password", { placeholder: "Empty for an open network" }),
      field.dropdown("security", "Security", [
        { value: "WPA", title: "WPA / WPA2 / WPA3" },
        { value: "WEP", title: "WEP" },
        { value: "nopass", title: "None" },
      ], { value: "WPA" }),
      field.checkbox("hidden", "Hidden network"),
    ],
    async submit(values) {
      const text = wifiPayload({
        ssid: String(values.ssid),
        password: values.security === "nopass" ? undefined : String(values.password ?? "") || undefined,
        security: String(values.security),
        hidden: !!values.hidden,
      });
      const item = await qrItem(text, ecc, { subtitle: "Wi-Fi network · scan it to join" });
      return list({ title: `Wi-Fi · ${values.ssid}`, items: [item] });
    },
  });
}
