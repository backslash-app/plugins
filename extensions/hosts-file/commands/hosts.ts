import {
  type Accessory,
  type Action,
  action,
  copy,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  refresh,
  toast,
} from "@backslash/api";
import {
  addressKind,
  BACKUP_PATH,
  entries,
  HOSTS_PATH,
  type Indexed,
  isBlock,
  isProtected,
  removeLine,
  setEnabled,
} from "../lib.ts";
import { blockForm, entryForm } from "../forms.ts";
import { hasBackup, live, read, restoreBackup, write } from "../system.ts";

/** Above this, the list is searched by the code rather than loaded at once. */
const LARGE = 2000;

const KIND_TINT = {
  Blocked: "red",
  Loopback: "gray",
  "Local network": "blue",
  "IPv6 local": "teal",
  Internet: "purple",
} as const;

function globalActions(backup: boolean): Action[] {
  return [
    action("Add Entry", () => entryForm({ standalone: false }), {
      icon: Icons.plus,
      shortcut: "<Ctrl>n",
      section: "File",
    }),
    action("Block a Domain", () => blockForm(false), { icon: Icons.shield, shortcut: "<Ctrl>b", section: "File" }),
    open(HOSTS_PATH, "Open Hosts File", { icon: Icons.file, shortcut: "<Ctrl><Shift>o", section: "File" }),
    ...(backup
      ? [action("Restore Previous Version", async () => {
        await restoreBackup();
        await toast("Hosts file restored", { style: "success", message: `From ${BACKUP_PATH}` });
        return refresh();
      }, {
        icon: Icons.history,
        destructive: true,
        confirm: "Replace /etc/hosts with the version before the last change?",
        section: "File",
      })]
      : []),
  ];
}

function item(x: Indexed, backup: boolean): Item {
  const e = x.entry;
  const kind = addressKind(e.ip);
  const system = isProtected(e);
  const blocked = isBlock(e);
  const accessories: Accessory[] = [];
  if (!e.enabled) accessories.push({ tag: "Disabled", color: "gray" });
  if (system) accessories.push({ icon: { source: Icons.lock, tint: "gray" }, tooltip: "Needed by the system" });
  accessories.push({ tag: e.ip, color: e.enabled ? KIND_TINT[kind] : "gray" });

  const line = e.raw.replace(/\r$/, "");
  const metadata: Metadata[] = [
    meta.text("Address", e.ip, { icon: Icons.globe }),
    meta.tags("Host names", e.hosts.map((h) => ({ text: h, color: e.enabled ? "blue" as const : "gray" as const }))),
    meta.text("Kind", kind, { color: e.enabled ? KIND_TINT[kind] : undefined }),
    meta.text("State", e.enabled ? "Enabled" : "Disabled (commented out)", { color: e.enabled ? "green" : undefined }),
    ...(e.comment ? [meta.text("Comment", e.comment)] : []),
    ...(x.section ? [meta.text("Group", x.section)] : []),
    ...(system ? [meta.text("Protected", "Needed by the system: it can't be disabled or removed here")] : []),
    meta.separator(),
    meta.text("Line", x.index + 1),
  ];

  const toggle = action(e.enabled ? "Disable" : "Enable", async () => {
    const { text, file } = await read();
    await write(text, setEnabled(file, x.index, e.raw, !e.enabled));
    await toast(`${e.hosts[0]} ${e.enabled ? "disabled" : "enabled"}`, { style: "success" });
    return refresh();
  }, { icon: e.enabled ? Icons.eyeOff : Icons.eye, shortcut: "<Ctrl>t" });

  return {
    id: `${x.index}:${line}`,
    title: e.hosts[0],
    subtitle: e.hosts.length > 1 ? e.hosts.slice(1).join(" ") : e.comment,
    icon: {
      source: blocked ? Icons.shield : system ? Icons.lock : Icons.globe,
      tint: !e.enabled ? "gray" : blocked ? "red" : KIND_TINT[kind],
    },
    section: x.section ? (x.section.length > 60 ? `${x.section.slice(0, 59)}…` : x.section) : "Entries",
    keywords: [e.ip, ...e.hosts.slice(1), e.comment ?? "", e.enabled ? "enabled" : "disabled"].filter(Boolean),
    accessories,
    detail: { markdown: "```\n" + line + "\n```", metadata },
    actions: [
      ...(system ? [] : [toggle]),
      copy(line, "Copy Line"),
      ...(system ? [] : [
        action("Edit Entry", () => entryForm({ standalone: false, edit: { index: x.index, entry: e } }), {
          icon: Icons.text,
          shortcut: "<Ctrl>e",
        }),
      ]),
      copy(e.ip, "Copy Address", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
      copy(e.hosts.join(" "), "Copy Host Names", { section: "Copy" }),
      ...(system ? [] : [action("Remove Entry", async () => {
        const { text, file } = await read();
        await write(text, removeLine(file, x.index, e.raw));
        await toast(`${e.hosts[0]} removed`, { style: "success" });
        return refresh();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Remove ${e.hosts[0]} (${e.ip}) from /etc/hosts?`,
        shortcut: "<Ctrl>BackSpace",
        section: "Danger",
      })]),
      ...globalActions(backup),
    ],
  };
}

const empty = {
  title: "No entry in /etc/hosts",
  description: "Add one with Ctrl+N, or block a domain with Ctrl+B",
  icon: Icons.globe,
};

const count = (n: number) => `${n} ${n === 1 ? "entry" : "entries"}`;

const disabledCount = (items: Item[]) => items.filter((i) => i.accessories?.some((a) => a.tag === "Disabled")).length;

export default async () => {
  const [{ file }, backup] = await Promise.all([read(), hasBackup()]);
  const all = entries(file);
  if (all.length > LARGE) {
    // Blocklists of tens of thousands of lines: search them instead of loading them.
    return list({
      placeholder: `Search ${all.length} entries…`,
      empty,
      actions: globalActions(backup),
      status: (items) => `${items.length < all.length ? `${items.length} of ` : ""}${count(all.length)}`,
      async search(query) {
        const { file } = await read();
        const q = query.trim().toLowerCase();
        const found = entries(file).filter((x) =>
          !q || x.entry.ip.includes(q) || x.entry.hosts.some((h) => h.toLowerCase().includes(q)) ||
          (x.entry.comment ?? "").toLowerCase().includes(q)
        );
        return found.slice(0, 200).map((x) => item(x, backup));
      },
    });
  }
  return list({
    placeholder: "Search host names and addresses…",
    empty,
    actions: globalActions(backup),
    status: (items) => {
      const disabled = disabledCount(items);
      return `${count(items.length)}${disabled ? `, ${disabled} disabled` : ""}`;
    },
    // Again after each change, the forms' included.
    items: ({ signal }) =>
      live(async () => {
        const [{ file }, backup] = await Promise.all([read(), hasBackup()]);
        return entries(file).map((x) => item(x, backup));
      }, signal),
  });
};
