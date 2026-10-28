import {
  type Action,
  action,
  close,
  type Color,
  copy,
  Icons,
  type Item,
  list,
  meta,
  open,
  openExternal,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { descriptionMarkdown, EGO, type Extension, type Look, look, sortExtensions, STATE_LABELS } from "../lib.ts";
import {
  disable,
  enable,
  type Installed,
  installed,
  openPrefs,
  remoteInfo,
  setUserExtensions,
  uninstall,
} from "../gnome.ts";

const COLOR: Record<Look, Color> = { on: "green", off: "gray", error: "red", outdated: "orange", busy: "blue" };
const ICON: Record<Look, string> = {
  on: Icons.done,
  off: Icons.todo,
  error: Icons.alert,
  outdated: Icons.clock,
  busy: Icons.inProgress,
};

async function step(message: string, fn: () => Promise<unknown>) {
  await fn();
  await toast(message, { style: "success" });
  return refresh();
}

function onEgo(e: Extension, shell?: string): Action {
  return action("Open on extensions.gnome.org", async () => {
    const info = await remoteInfo(e.uuid, shell);
    if (!info) {
      await toast(`${e.name} isn't on extensions.gnome.org`, { style: "failure" });
      return;
    }
    await openExternal(info.link);
    return close();
  }, { icon: Icons.globe, shortcut: "<Ctrl>o", section: "Open" });
}

function extensionItem(e: Extension, state: Installed): Item {
  const l = look(e);
  const toggle = e.enabled
    ? action("Disable", () => step(`${e.name} disabled`, () => disable(e.uuid)), { icon: Icons.todo })
    : action("Enable", () => step(`${e.name} enabled`, () => enable(e.uuid)), { icon: Icons.done });
  const blocked = state.userDisabled && e.user;
  return {
    id: e.uuid,
    title: e.name,
    subtitle: e.description.split("\n")[0],
    icon: { source: ICON[l], tint: blocked ? "gray" : COLOR[l] },
    section: e.user ? "Installed by You" : "System Extensions",
    keywords: [e.uuid, e.author ?? "", STATE_LABELS[l]],
    accessories: [
      ...(e.hasUpdate
        ? [{ tag: "Update ready", color: "blue" as const, tooltip: "Log out and back in to use it" }]
        : []),
      ...(blocked ? [{ tag: "All user extensions off", color: "orange" as const }] : []),
      ...(e.hasPrefs ? [{ icon: Icons.settings, tooltip: "Has preferences" }] : []),
      ...(e.version ? [{ text: `v${e.version}` }] : []),
      { tag: STATE_LABELS[l], color: COLOR[l] },
    ],
    detail: {
      markdown: descriptionMarkdown(e.description) || undefined,
      metadata: [
        meta.text("State", `${e.enabled ? "Enabled" : "Disabled"} · ${e.state || "?"}`, {
          icon: { source: ICON[l], tint: COLOR[l] },
          color: COLOR[l],
        }),
        ...(e.version ? [meta.text("Version", e.version, { icon: Icons.tag })] : []),
        meta.text("UUID", e.uuid, { icon: Icons.hash }),
        meta.text("Installed", e.user ? "By you" : "By the system", { icon: Icons.package }),
        ...(e.author ? [meta.text("Author", e.author, { icon: Icons.person })] : []),
        ...(e.url ? [meta.link("Homepage", e.url.replace(/^https?:\/\//, ""), e.url)] : []),
        meta.text("Folder", e.path, { icon: Icons.folder }),
      ],
    },
    actions: [
      toggle,
      ...(e.hasPrefs
        ? [action("Open Preferences", () => {
          openPrefs(e.uuid);
          return close();
        }, { icon: Icons.settings, shortcut: "<Ctrl>p" })]
        : []),
      onEgo(e, state.shell),
      ...(e.url ? [open(e.url, "Open Homepage", { icon: Icons.external, section: "Open" })] : []),
      open(e.path, "Open Extension Folder", { icon: Icons.folder, section: "Open" }),
      copy(e.uuid, "Copy UUID", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
      userToggle(state),
      ...(e.user
        ? [action("Uninstall", () => step(`${e.name} uninstalled`, () => uninstall(e.uuid)), {
          icon: Icons.trash,
          destructive: true,
          confirm: `Uninstall ${e.name}? Its files are deleted`,
          shortcut: "<Ctrl>Delete",
          section: "Danger",
        })]
        : []),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

function userToggle(state: Installed): Action {
  return state.userDisabled
    ? action("Enable User Extensions", () => step("User extensions enabled", () => setUserExtensions(false)), {
      icon: Icons.power,
      section: "All Extensions",
    })
    : action("Disable All User Extensions", () => step("User extensions disabled", () => setUserExtensions(true)), {
      icon: Icons.power,
      confirm: "Turn off every extension you installed? Their own settings are kept",
      section: "All Extensions",
    });
}

function overviewItem(state: Installed): Item {
  const user = state.extensions.filter((e) => e.user);
  const on = state.extensions.filter((e) => e.enabled).length;
  const broken = state.extensions.filter((e) => ["error", "outdated"].includes(look(e))).length;
  return {
    id: "user-extensions",
    title: state.userDisabled ? "User Extensions Are Off" : "User Extensions Are On",
    subtitle: `${on} of ${state.extensions.length} enabled${state.shell ? ` · GNOME Shell ${state.shell}` : ""}`,
    icon: { source: Icons.power, tint: state.userDisabled ? "orange" : "green" },
    section: "GNOME Shell",
    keywords: ["disable all", "toggle", "user extensions", "désactiver toutes"],
    accessories: [
      ...(broken ? [{ tag: `${broken} with errors`, color: "red" as const }] : []),
      { tag: state.userDisabled ? "Off" : "On", color: state.userDisabled ? "orange" : "green" },
    ],
    detail: {
      stats: [
        { label: "Enabled", value: on, color: "green" },
        { label: "Yours", value: user.length },
        { label: "Errors", value: broken, color: broken ? "red" : undefined },
      ],
      markdown: state.userDisabled
        ? "Every extension you installed is off (`disable-user-extensions`). **Enter** turns them back on."
        : "**Enter** turns off every extension you installed at once, handy when the Shell misbehaves.",
      metadata: [
        ...(state.shell ? [meta.text("GNOME Shell", state.shell, { icon: Icons.monitor })] : []),
        meta.text("System extensions", String(state.extensions.length - user.length), { icon: Icons.package }),
      ],
    },
    actions: [
      userToggle(state),
      open(`${EGO}/local/`, "Open extensions.gnome.org", { icon: Icons.globe }),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

export default list({
  placeholder: "Filter extensions…",
  filter: {
    options: [{ value: "all", title: "All" }, { value: "enabled", title: "Enabled" }, {
      value: "disabled",
      title: "Disabled",
    }],
    default: "all",
  },
  empty: { title: "No extension", description: "Install one with Install GNOME Extension", icon: Icons.apps },
  status: (items) => `${items.filter((i) => i.id !== "user-extensions").length} extensions`,
  async items({ filter }) {
    const state = await installed();
    const shown = sortExtensions(state.extensions).filter((e) =>
      filter === "enabled" ? e.enabled : filter === "disabled" ? !e.enabled : true
    );
    const on = state.extensions.filter((e) => e.enabled).length;
    updateCommandMetadata({ subtitle: state.userDisabled ? "User extensions off" : `${on} enabled` }).catch(() => {});
    return [overviewItem(state), ...shown.map((e) => extensionItem(e, state))];
  },
});
