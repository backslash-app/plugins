import {
  type Action,
  action,
  close,
  copy,
  Icons,
  type Item,
  list,
  meta,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { BACKEND_NAMES, displayTag, type Family, installMarkdown, type Layout } from "../lib.ts";
import { family, load, type State, switchTo } from "../system.ts";

const KIND_NAMES = { xkb: "Keyboard layout", ibus: "IBus input method", fcitx5: "Fcitx 5 input method" };

function layoutItem(l: Layout, s: State, section: string, position: number, count: number): Item {
  const isMethod = l.kind !== "xkb" && !(l.kind === "fcitx5" && /^keyboard-/.test(l.key));
  const actions: Action[] = [];
  if (!l.active) {
    actions.push(action(`Switch to ${l.name}`, async () => {
      await switchTo(s, l);
      updateCommandMetadata({ subtitle: l.name }).catch(() => {});
      return close(`Keyboard: ${l.name}`);
    }, { icon: Icons.keyboard }));
    actions.push(action("Switch and Stay", async () => {
      await switchTo(s, l);
      await toast(`Switched to ${l.name}`, { style: "success" });
      return refresh();
    }, { icon: Icons.refresh, shortcut: "<Ctrl>s" }));
  }
  actions.push(
    copy(l.variant ? `${l.code}(${l.variant})` : l.code, "Copy Layout Code", {
      section: "Copy",
      shortcut: "<Ctrl><Shift>c",
    }),
    copy(l.name, "Copy Name", { section: "Copy" }),
    action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "View" }),
  );
  return {
    id: `${l.kind}:${l.key}:${l.code}:${l.variant ?? ""}`,
    title: l.name,
    subtitle: l.active ? "Current" : undefined,
    icon: { source: isMethod ? Icons.font : Icons.keyboard, tint: l.active ? "green" : isMethod ? "purple" : "blue" },
    section,
    keywords: [l.code, l.variant ?? "", l.key, "layout", "disposition", "clavier", "keyboard"],
    accessories: [
      ...(l.active ? [{ icon: Icons.check, color: "green" as const, tooltip: "Current layout" }] : []),
      { tag: displayTag(l), color: l.active ? "green" : "gray" },
    ],
    detail: {
      stats: [
        { label: "Code", value: displayTag(l), color: l.active ? "green" : undefined },
        { label: "Position", value: `${position} of ${count}` },
      ],
      metadata: [
        meta.text("Name", l.name, { icon: isMethod ? Icons.font : Icons.keyboard }),
        meta.text("State", l.active ? "Current" : "Available", {
          icon: l.active ? Icons.check : Icons.dottedCircle,
          color: l.active ? "green" : "gray",
        }),
        meta.separator(),
        meta.text("Type", KIND_NAMES[l.kind]),
        meta.text(isMethod ? "Engine" : "Layout", l.kind === "xkb" || !isMethod ? l.code : l.key, { icon: Icons.code }),
        ...(l.variant ? [meta.text("Variant", l.variant)] : []),
        ...(s.backend ? [meta.text("Managed by", BACKEND_NAMES[s.backend], { icon: Icons.settings })] : []),
      ],
    },
    actions,
  };
}

function setupItems(s: State, fam?: Family): Item[] {
  if (s.backend) {
    return [{
      id: "single",
      title: "Only one layout is set up",
      subtitle: s.backend ? BACKEND_NAMES[s.backend] : undefined,
      icon: { source: Icons.info, tint: "blue" },
      detail: {
        markdown: {
          gnome: "Add layouts in **Settings → Keyboard → Input Sources**.",
          kde: "Add layouts in **System Settings → Keyboard → Layouts**.",
          hyprland:
            "List several layouts in your Hyprland config:\n\n```\ninput {\n  kb_layout = us,fr\n  kb_variant = ,azerty\n}\n```",
          sway: "List several layouts in your Sway config:\n\n```\ninput type:keyboard {\n  xkb_layout us,fr\n}\n```",
          x11: "Set several layouts, for example:\n\n`setxkbmap -layout us,fr -option grp:alt_shift_toggle`",
        }[s.backend],
      },
      actions: [action("Check Again", () => refresh(), { icon: Icons.refresh })],
    }];
  }
  const x11 = s.wanted.includes("x11");
  if (s.error) {
    return [{
      id: "error",
      title: "Couldn't read the keyboard layouts",
      subtitle: s.wanted.map((b) => BACKEND_NAMES[b]).join(", "),
      icon: { source: Icons.alert, tint: "red" },
      detail: { markdown: "The desktop's keyboard tool answered with an error:\n\n```\n" + s.error + "\n```" },
      actions: [action("Check Again", () => refresh(), { icon: Icons.refresh }), copy(s.error, "Copy Error")],
    }];
  }
  return [{
    id: "setup",
    title: x11 ? "Install setxkbmap" : "No keyboard layout backend",
    subtitle: "GNOME, KDE Plasma, Hyprland, Sway or X11",
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: x11
        ? installMarkdown(
          "On X11, Backslash reads layouts with **setxkbmap**, and switches with **xkb-switch** when it is installed.",
          ["setxkbmap", "xkb-switch"],
          fam,
        )
        : s.wanted.includes("kde")
        ? installMarkdown("On KDE Plasma, Backslash talks to the keyboard daemon with **gdbus**.", ["gdbus"], fam)
        : "Backslash couldn't reach this desktop's keyboard settings. Supported: GNOME (gsettings), KDE Plasma (D-Bus), Hyprland (hyprctl), Sway (swaymsg) and X11 (setxkbmap).",
      metadata: [meta.tags("Supported", ["GNOME", "KDE Plasma", "Hyprland", "Sway", "X11", "IBus", "Fcitx 5"])],
    },
    actions: [action("Check Again", () => refresh(), { icon: Icons.refresh })],
  }];
}

let summary = "";

export default list({
  placeholder: "Filter keyboard layouts and input methods…",
  empty: { title: "No layout matches", icon: Icons.keyboard },
  status: () => summary,
  async items() {
    const s = await load();
    const all = [...s.layouts, ...s.methods];
    const current = s.methods.find((m) => m.active && s.framework === "fcitx5") ?? s.layouts.find((l) => l.active) ??
      s.methods.find((m) => m.active);
    updateCommandMetadata({ subtitle: current ? current.name : null }).catch(() => {});
    summary = [
      current ? `Current: ${current.name}` : undefined,
      `${s.layouts.length} layout${s.layouts.length === 1 ? "" : "s"}`,
      s.methods.length ? `${s.methods.length} in ${s.framework === "fcitx5" ? "Fcitx 5" : "IBus"}` : undefined,
      s.backend ? BACKEND_NAMES[s.backend] : undefined,
    ].filter(Boolean).join(" · ");
    const items = [
      ...s.layouts.map((l, i) =>
        layoutItem(l, s, l.kind === "ibus" ? "Input Methods" : "Layouts", i + 1, s.layouts.length)
      ),
      ...s.methods.map((m, i) =>
        layoutItem(m, s, s.framework === "fcitx5" ? "Fcitx 5" : "IBus", i + 1, s.methods.length)
      ),
    ];
    if (all.length > 1) return items;
    return [...items, ...setupItems(s, await family())];
  },
});
