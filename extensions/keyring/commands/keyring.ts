import {
  type Action,
  action,
  clipboard,
  close,
  type Color,
  copy,
  detail,
  Icons,
  type Item,
  list,
  meta,
  refresh,
  submenu,
  toast,
} from "@backslash/api";
import { collections, isLocked, items, lock, openManager, readSecret, remove, unlock } from "../dbus.ts";
import {
  age,
  attributeTable,
  type Collection,
  formatDate,
  pathName,
  schemaInfo,
  type SecretItem,
  summary,
  titleOf,
  userOf,
} from "../lib.ts";

/** Everything loaded, for secret-tool to tell items with the same attributes apart. */
let loaded: SecretItem[] = [];
let status = "";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits for the user to type the password in the keyring's prompt. */
async function waitUnlocked(c: Collection, seconds = 60): Promise<boolean> {
  for (let i = 0; i < seconds; i++) {
    if (!(await isLocked(c.path).catch(() => true))) return true;
    await sleep(1000);
  }
  return false;
}

function unlockAction(c: Collection): Action {
  return action("Unlock Keyring", async () => {
    const prompted = await unlock(c.path);
    if (prompted) {
      await toast(`Type the password of “${c.label}” in the keyring prompt`);
      if (!(await waitUnlocked(c))) {
        throw new Error(`“${c.label}” is still locked: unlock it in Seahorse or KWalletManager (Ctrl+O)`);
      }
    }
    await toast(`${c.label} unlocked`, { style: "success" });
    return refresh();
  }, { icon: Icons.key, shortcut: "<Ctrl>u", section: "Keyring" });
}

function lockAction(c: Collection): Action {
  return action("Lock Keyring", async () => {
    await lock(c.path);
    await toast(`${c.label} locked`, { style: "success" });
    return refresh();
  }, { icon: Icons.lock, shortcut: "<Ctrl>l", section: "Keyring" });
}

const managerAction = (c: Collection | string) =>
  action("Open in Keyring Manager", () => {
    const name = openManager(typeof c === "string" ? c : c.path);
    return close(`Opening ${name}…`);
  }, { icon: Icons.external, shortcut: "<Ctrl>o", section: "Keyring" });

function secretAction(item: SecretItem, how: "copy" | "paste"): Action {
  return action(how === "copy" ? "Copy Secret" : "Paste Secret", async () => {
    const secret = await readSecret(item, loaded);
    // Clipboard histories (Backslash's included) don't record concealed text.
    if (how === "paste") {
      await clipboard.paste(secret, { concealed: true });
      return close();
    }
    await clipboard.write(secret, { concealed: true });
    return close("Secret copied");
  }, { icon: how === "copy" ? Icons.key : Icons.paste });
}

function revealView(item: SecretItem) {
  return action("Reveal Secret", async () => {
    const secret = await readSecret(item, loaded);
    const fence = "`".repeat(Math.max(3, ...[...secret.matchAll(/`+/g)].map((m) => m[0].length + 1)));
    return detail({
      title: titleOf(item),
      markdown: `${fence}\n${secret}\n${fence}`,
      metadata: [
        meta.text("Length", `${[...secret].length} characters`),
        meta.text("Keyring", pathName(item.collection)),
      ],
      actions: [copy(secret, "Copy Secret", { concealed: true })],
    });
  }, { icon: Icons.eye, shortcut: "<Ctrl>r" });
}

function itemRow(item: SecretItem, c: Collection | undefined): Item {
  const info = schemaInfo(item);
  const user = userOf(item.attributes);
  const locked = item.locked || c?.locked === true;
  const attrs = Object.entries(item.attributes).filter(([k]) => k !== "xdg:schema");
  const keyringName = c?.label ?? pathName(item.collection);
  return {
    id: item.path,
    title: titleOf(item),
    subtitle: summary(item) || undefined,
    icon: {
      source: locked ? Icons.lock : info.app ? Icons.shield : Icons.key,
      tint: locked ? "gray" : info.app ? "teal" : "yellow",
    },
    section: keyringName,
    keywords: [info.name, ...attrs.map(([, v]) => v).filter((v) => v.length < 80)],
    accessories: [
      { tag: info.name, color: info.app ? "teal" as Color : "gray" as Color },
      ...(item.modified ? [{ text: age(item.modified), tooltip: `Modified ${formatDate(item.modified)}` }] : []),
    ],
    detail: {
      markdown: attributeTable(item.attributes),
      metadata: [
        meta.text("Kind", info.name, { icon: Icons.key }),
        ...(user ? [meta.text("User", user, { icon: Icons.person })] : []),
        meta.text("Keyring", `${keyringName}${locked ? " (locked)" : ""}`, {
          icon: locked ? Icons.lock : Icons.archive,
        }),
        meta.separator(),
        meta.text("Created", formatDate(item.created), { icon: Icons.calendar }),
        meta.text("Modified", formatDate(item.modified), { icon: Icons.history }),
        meta.text("Object", item.path),
      ],
    },
    actions: [
      secretAction(item, "copy"),
      secretAction(item, "paste"),
      ...(user
        ? [copy(user, "Copy Username", { icon: Icons.person, shortcut: "<Ctrl><Shift>c", section: "Copy" })]
        : []),
      revealView(item),
      copy(titleOf(item), "Copy Label", { section: "Copy" }),
      ...(attrs.length
        ? [
          submenu("Copy Attribute", attrs.map(([k, v]) => copy(v, k, { icon: Icons.tag })), {
            icon: Icons.tag,
            section: "Copy",
          }),
        ]
        : []),
      ...(c ? [locked ? unlockAction(c) : lockAction(c)] : []),
      managerAction(c ?? item.collection),
      action("Delete Item", async () => {
        const prompted = await remove(item);
        loaded = loaded.filter((x) => x.path !== item.path);
        await toast(prompted ? "Confirm the deletion in the keyring prompt" : `${titleOf(item)} deleted`, {
          style: prompted ? "info" : "success",
        });
        return refresh();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Delete “${titleOf(item)}” from ${keyringName}? Apps using it will ask again`,
        shortcut: "<Ctrl>Delete",
        section: "Item",
      }),
    ],
  };
}

function collectionRow(c: Collection, shown: number): Item {
  return {
    id: c.path,
    title: c.label,
    subtitle: c.locked ? "Locked: unlock it to see its items" : `${shown} item${shown === 1 ? "" : "s"}`,
    icon: { source: c.locked ? Icons.lock : Icons.archive, tint: c.locked ? "orange" : "blue" },
    section: c.locked ? "Locked Keyrings" : "Keyrings",
    keywords: ["keyring", "collection", "wallet", c.locked ? "locked" : "unlocked"],
    accessories: [
      ...(c.isDefault ? [{ tag: "default", color: "blue" as Color, tooltip: "Where apps save new secrets" }] : []),
      { tag: c.locked ? "locked" : "unlocked", color: c.locked ? "orange" as Color : "green" as Color },
    ],
    detail: {
      metadata: [
        meta.text("Keyring", c.label, { icon: Icons.archive }),
        meta.text("State", c.locked ? "Locked" : "Unlocked", { icon: c.locked ? Icons.lock : Icons.key }),
        meta.text("Items", c.items.length),
        ...(c.isDefault ? [meta.text("Default", "New secrets are saved here")] : []),
        meta.text("Created", formatDate(c.created), { icon: Icons.calendar }),
        meta.text("Modified", formatDate(c.modified), { icon: Icons.history }),
        meta.text("Object", c.path),
      ],
    },
    actions: [
      c.locked ? unlockAction(c) : lockAction(c),
      managerAction(c),
      copy(c.label, "Copy Name", { section: "Copy" }),
    ],
  };
}

export default list({
  placeholder: "Filter by label, user, server or attribute…",
  empty: {
    title: "No secrets",
    description: "Your keyrings are empty, or locked: unlock them with Ctrl+U on the keyring",
    icon: Icons.key,
  },
  status: () => status,
  async *items({ preferences, signal }) {
    const showApp = preferences.showAppSecrets === true;
    const cols = await collections(signal);
    const byPath = new Map(cols.map((c) => [c.path, c]));
    const order = new Map(cols.map((c, i) => [c.path, c.isDefault ? -1 : i]));
    const found: SecretItem[] = [];
    let hidden = 0;

    const rows = () => {
      const visible = found
        .filter((i) => showApp || !schemaInfo(i).app)
        .sort((a, b) =>
          (order.get(a.collection) ?? 99) - (order.get(b.collection) ?? 99) ||
          titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: "base" })
        );
      hidden = found.length - visible.length;
      const count = (c: Collection) => visible.filter((i) => i.collection === c.path).length;
      const locked = cols.filter((c) => c.locked);
      status = `${visible.length} item${visible.length === 1 ? "" : "s"} in ${cols.length} keyring${
        cols.length === 1 ? "" : "s"
      }${locked.length ? ` · ${locked.length} locked` : ""}${hidden ? ` · ${hidden} app secrets hidden` : ""}`;
      return [
        ...locked.map((c) => collectionRow(c, count(c))),
        ...visible.map((i) => itemRow(i, byPath.get(i.collection))),
        ...cols.filter((c) => !c.locked).map((c) => collectionRow(c, count(c))),
      ];
    };

    yield rows();
    for await (const batch of items(cols.flatMap((c) => c.items), signal)) {
      found.push(...batch);
      loaded = found;
      yield rows();
    }
    loaded = found;
    yield rows();
  },
});
