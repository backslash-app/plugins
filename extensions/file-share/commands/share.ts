import {
  action,
  clipboard,
  close,
  type Context,
  field,
  form,
  Icons,
  type Item,
  list,
  type ListSpec,
  open,
  type Outcome,
  submenu,
  toast,
} from "@backslash/api";
import { instance, privatebin, readUpload, remember, upload0x0 } from "../api.ts";
import { EXPIRIES, type Expiry, expiry, receiveCommand, retentionDays, type Share, size, textTitle } from "../lib.ts";
import { type Copied, copied, crocInstalled, crocSend, tilde } from "../system.ts";
import historyView from "./history.ts";

/** What gets shared: the copied files, or a text. */
interface What {
  paths: string[];
  text?: string;
  label: string;
  bytes: number;
  dirs: boolean;
}

const fromCopied = (c: Copied): What | undefined => {
  if (c.files.length) {
    return {
      paths: c.files.map((f) => f.path),
      label: c.files.length === 1 ? c.files[0].name : `${c.files.length} files`,
      bytes: c.files.reduce((n, f) => n + f.bytes, 0),
      dirs: c.files.some((f) => f.dir),
    };
  }
  if (c.text) {
    return {
      paths: [],
      text: c.text,
      label: textTitle(c.text),
      bytes: new TextEncoder().encode(c.text).length,
      dirs: false,
    };
  }
  return undefined;
};

const links = (shares: Share[]) => shares.map((s) => s.url).filter(Boolean).join("\n");

async function done(shares: Share[], what: string): Promise<ReturnType<typeof close>> {
  await remember(shares);
  const text = links(shares);
  await clipboard.write(text);
  return close(`${what}: link${shares.length === 1 ? "" : "s"} copied`);
}

async function to0x0(w: What, e: Expiry, ctx: Context) {
  const secret = ctx.preferences.secretUrls !== false;
  const shares: Share[] = [];
  if (w.text !== undefined) {
    shares.push(
      await upload0x0({ name: "text.txt", bytes: new TextEncoder().encode(w.text) }, e, { secret, signal: ctx.signal }),
    );
    shares[0].name = w.label;
    shares[0].kind = "text";
  } else {
    for (const path of w.paths) shares.push(await upload0x0(await readUpload(path), e, { secret, signal: ctx.signal }));
  }
  return done(shares, `Uploaded to 0x0.st for ${e.title}`);
}

async function toPrivatebin(w: What, e: Expiry, ctx: Context, extra: { burn?: boolean; password?: string } = {}) {
  const base = instance(ctx.preferences);
  const shares: Share[] = [];
  const o = { expiry: e, signal: ctx.signal, ...extra };
  if (w.text !== undefined) {
    const s = await privatebin(base, { text: w.text }, o);
    shares.push({ ...s, name: w.label });
  } else {
    // One paste per file: every PrivateBin version reads a single attachment.
    for (const path of w.paths) shares.push(await privatebin(base, { file: await readUpload(path) }, o));
  }
  return done(shares, `Encrypted on ${new URL(base).hostname}${extra.burn ? ", burns after reading" : ""}`);
}

async function toCroc(w: What) {
  const t = await crocSend(w.text !== undefined ? { text: w.text } : { files: w.paths });
  await remember([{
    id: t.unit,
    service: "croc",
    name: w.label,
    kind: w.text !== undefined ? "text" : w.paths.length > 1 ? "files" : "file",
    bytes: w.bytes,
    created: Date.now(),
    code: t.code,
    unit: t.unit,
    log: t.log,
    webUrl: t.webUrl,
    paths: w.paths,
  }]);
  await clipboard.write(t.code);
  return close(`croc code ${t.code} copied: the receiver runs ${receiveCommand(t.code)}`);
}

function passwordForm(w: What, e: Expiry) {
  return form({
    title: "PrivateBin with a Password",
    submitTitle: "Encrypt and Upload",
    fields: [
      field.password("password", "Password", { required: true }),
      field.dropdown("expiry", "Expires after", EXPIRIES.map((x) => ({ value: x.privatebin, title: x.title })), {
        value: e.privatebin,
      }),
      field.checkbox("burn", "Burn after reading"),
    ],
    async submit(values, ctx) {
      const password = String(values.password ?? "");
      if (!password) {
        await toast("Type a password", { style: "failure" });
        return;
      }
      return await toPrivatebin(w, expiry(values.expiry), ctx, { password, burn: values.burn === true });
    },
  });
}

const textForm = form({
  title: "Share a Text",
  submitTitle: "Next",
  fields: [field.textArea("text", "Text", { required: true, placeholder: "What to share" })],
  submit(values) {
    const text = String(values.text ?? "");
    if (!text.trim()) return;
    return servicesView({
      paths: [],
      text,
      label: textTitle(text),
      bytes: new TextEncoder().encode(text).length,
      dirs: false,
    });
  },
});

const textAction = action("Share a Text…", () => textForm, { icon: Icons.text, shortcut: "<Ctrl>t", section: "More" });
const historyAction = action("Shared Files", () => historyView, {
  icon: Icons.history,
  shortcut: "<Ctrl>h",
  section: "More",
});

function serviceItems(w: What, ctx: Context, croc: boolean): Item[] {
  const e = expiry(ctx.preferences.expiry);
  const expiryMenu = (title: string, run: (x: Expiry) => Promise<Outcome>) =>
    submenu(title, EXPIRIES.map((x) => action(x.title, () => run(x), { icon: Icons.clock })), {
      icon: Icons.clock,
      shortcut: "<Ctrl>e",
    });
  const maxDays = Math.floor(retentionDays(w.bytes));
  const items: Item[] = [];
  if (!w.dirs) {
    items.push({
      id: "0x0",
      title: "Upload to 0x0.st",
      subtitle: `Public: anyone with the link can download it · expires after ${e.title}`,
      icon: { source: Icons.globe, tint: "orange" },
      section: "Share With",
      accessories: [{ tag: "public", color: "orange" }, {
        text: `kept ≤ ${maxDays} d`,
        tooltip: "0x0.st keeps big files less long",
      }],
      detail: {
        markdown: [
          "## 0x0.st — public file hosting",
          "**Anyone who has the link can download the file**, and 0x0.st's operator can read it: don't use it for",
          "anything private. Links are long and hard to guess, but not secret.",
          `Files are deleted after the expiry you choose, ${maxDays} days at most for this size (512 MiB maximum).`,
          "The delete token is kept in **Shared Files**, to remove it sooner.",
        ].join("\n\n"),
      },
      actions: [
        action(`Upload, Expires After ${e.title}`, () => to0x0(w, e, ctx), { icon: Icons.upload }),
        expiryMenu("Expire After…", (x) => to0x0(w, x, ctx)),
        open("https://0x0.st", "About 0x0.st", { icon: Icons.info, section: "More" }),
        textAction,
        historyAction,
      ],
    });
    items.push({
      id: "privatebin",
      title: "Encrypt with PrivateBin",
      subtitle: `End-to-end encrypted: the key only lives in the link · expires after ${e.title}`,
      icon: { source: Icons.lock, tint: "green" },
      section: "Share With",
      accessories: [{ tag: "encrypted", color: "green" }, { text: tryHost(ctx) }],
      detail: {
        markdown: [
          "## PrivateBin — encrypted paste",
          "The text or file is encrypted **here** (AES-256-GCM); the server only stores ciphertext. The key is in",
          "the part of the link after `#`, which browsers never send: whoever has the full link can read it.",
          "Add a password for a second factor, or burn after reading for a one-time link.",
        ].join("\n\n"),
      },
      actions: [
        action(`Encrypt, Expires After ${e.title}`, () => toPrivatebin(w, e, ctx), { icon: Icons.lock }),
        action("Burn After Reading", () => toPrivatebin(w, e, ctx, { burn: true }), {
          icon: Icons.eyeOff,
          shortcut: "<Ctrl>b",
        }),
        action("With a Password…", () => passwordForm(w, e), { icon: Icons.key, shortcut: "<Ctrl>p" }),
        expiryMenu("Expire After…", (x) => toPrivatebin(w, x, ctx)),
        textAction,
        historyAction,
      ],
    });
  }
  items.push(
    croc
      ? {
        id: "croc",
        title: "Send with croc",
        subtitle: "Straight to another computer, end-to-end encrypted, any size, folders too",
        icon: { source: Icons.bolt, tint: "blue" },
        section: "Share With",
        accessories: [{ tag: "direct", color: "blue" }],
        detail: {
          markdown: [
            "## croc — direct transfer",
            "croc waits in the background (even when Backslash is closed) until the receiver types the",
            "**code phrase**, which is copied for you. Nothing is stored on a server: the relay only passes",
            "encrypted data. The receiver runs:",
            "```\nCROC_SECRET=<code> croc\n```",
            "(`croc <code>` on Windows). Follow it in **Shared Files**.",
          ].join("\n\n"),
        },
        actions: [
          action("Send and Copy the Code", () => toCroc(w), { icon: Icons.bolt }),
          textAction,
          historyAction,
        ],
      }
      : {
        id: "croc",
        title: "croc is not installed",
        subtitle: "Install croc to send files straight to another computer (e.g. sudo apt install croc)",
        icon: { source: Icons.bolt, tint: "gray" },
        section: "Share With",
        actions: [open("https://github.com/schollz/croc#install", "How to Install croc", { icon: Icons.download })],
      },
  );
  return items;
}

function tryHost(ctx: Context): string {
  try {
    return new URL(instance(ctx.preferences)).hostname;
  } catch {
    return "check Settings";
  }
}

function whatItems(w: What, c?: Copied): Item[] {
  if (w.text !== undefined) {
    return [{
      id: "text",
      title: w.label,
      subtitle: `Text · ${size(w.bytes)}`,
      icon: { source: Icons.text, tint: "gray" },
      section: "To Share",
      detail: { markdown: "```\n" + w.text.slice(0, 4000) + (w.text.length > 4000 ? "\n…" : "") + "\n```" },
      actions: [textAction, historyAction],
    }];
  }
  return (c?.files ?? []).map((f) => ({
    id: f.path,
    title: f.name,
    subtitle: tilde(f.path),
    icon: { source: f.dir ? Icons.folder : Icons.file, tint: "gray" },
    section: "To Share",
    accessories: [{ text: f.dir ? "folder" : size(f.bytes) }],
    actions: [open(f.path, "Open", { icon: Icons.external }), textAction, historyAction],
  }));
}

function servicesView(w: What, c?: Copied): ListSpec {
  return list({
    title: `Share ${w.label}`,
    placeholder: "Pick how to share…",
    actions: [textAction, historyAction],
    items: async (ctx) => [...serviceItems(w, ctx, await crocInstalled()), ...whatItems(w, c)],
  });
}

export default list({
  placeholder: "Pick how to share the copied files or text…",
  empty: {
    title: "Nothing copied",
    description: "Copy files in your file manager or some text, then open Share Files again — or Ctrl+T to type a text",
    icon: Icons.upload,
  },
  actions: [textAction, historyAction],
  status: (items) => {
    const files = items.filter((i) => i.section === "To Share");
    return files.length ? `${files.length} item${files.length === 1 ? "" : "s"} to share` : "Copy files or text first";
  },
  async items(ctx) {
    const [c, croc] = await Promise.all([copied(), crocInstalled()]);
    const w = fromCopied(c);
    if (!w) return [];
    return [...serviceItems(w, ctx, croc), ...whatItems(w, c)];
  },
});
