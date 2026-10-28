import {
  action,
  type Color,
  copy,
  Icons,
  type Item,
  list,
  meta,
  refresh,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  aspect,
  type Backlight,
  type Family,
  install,
  logicalSize,
  type Monitor,
  percent,
  PRESETS,
  refreshText,
  resolution,
  scaleText,
  stepped,
} from "../lib.ts";
import {
  type Backlights,
  backlights,
  ddcDisplays,
  family,
  monitors,
  type NightLight,
  nightLight,
  session,
  setBacklight,
  setNightLight,
} from "../system.ts";

interface Prefs {
  ddc?: boolean;
  temperature?: number;
}

const set = (b: Backlight, pct: number, via: Backlights["via"]) => async () => {
  await setBacklight(b, pct, via);
  return refresh();
};

function brightnessItem(b: Backlight, via: Backlights["via"]): Item {
  const pct = percent(b);
  const ddc = b.kind === "ddc";
  const tint: Color = pct >= 75 ? "yellow" : pct >= 35 ? "orange" : "gray";
  return {
    id: `brightness:${b.id}`,
    title: ddc ? b.name : "Brightness",
    subtitle: ddc ? "External monitor (DDC/CI)" : b.name,
    icon: { source: Icons.sun, tint },
    section: "Brightness",
    keywords: ["brightness", "luminosité", "backlight", "dim", b.name],
    accessories: [{ tag: `${pct} %`, color: tint === "gray" ? undefined : tint }],
    detail: {
      stats: [{ label: "brightness", value: `${pct} %` }],
      metadata: [
        meta.progress("Level", pct / 100),
        meta.text("Device", b.name, { icon: ddc ? Icons.monitor : Icons.sun }),
        meta.text("Raw value", `${b.current} / ${b.max}`),
        meta.text("Through", ddc ? "ddcutil" : via === "brightnessctl" ? "brightnessctl" : "systemd-logind", {
          icon: Icons.settings,
        }),
      ],
    },
    actions: [
      submenu(
        "Set Brightness",
        PRESETS.map((p) => action(`${p} %`, set(b, p, via), { icon: p >= 50 ? Icons.sun : Icons.moon })),
        { icon: Icons.sun },
      ),
      action("Brighter", set(b, stepped(pct, 10), via), { icon: Icons.arrowUp, shortcut: "<Ctrl>Up" }),
      action("Dimmer", set(b, stepped(pct, -10), via), { icon: Icons.arrowDown, shortcut: "<Ctrl>Down" }),
      ...PRESETS.map((p, i) =>
        action(`Set to ${p} %`, set(b, p, via), { icon: Icons.sun, shortcut: `<Ctrl>${i + 1}`, section: "Presets" })
      ),
    ],
  };
}

function noBrightness(fam?: Family): Item {
  return {
    id: "brightness:none",
    title: "No adjustable backlight",
    subtitle: "desktop monitors need DDC/CI",
    icon: { source: Icons.sun, tint: "gray" },
    section: "Brightness",
    detail: {
      markdown: [
        "Laptop panels are adjusted through the kernel's backlight; none was found here.",
        "For **external monitors**, install ddcutil, allow your user to use I²C (`sudo usermod -aG i2c $USER`), then turn on **External monitors (DDC/CI)** in this extension's preferences.",
        `\`${install(fam, "ddcutil")}\``,
        "brightnessctl is used when installed:",
        `\`${install(fam, "brightnessctl")}\``,
      ].join("\n\n"),
    },
    actions: [action("Check Again", () => refresh(), { icon: Icons.refresh })],
  };
}

const BACKENDS: Record<string, string> = {
  gnome: "GNOME Settings",
  kde: "KDE Plasma",
  hyprsunset: "hyprsunset",
  wlsunset: "wlsunset",
  gammastep: "gammastep",
  redshift: "Redshift",
};

function nightItem(n: NightLight | undefined, prefs: Prefs, fam?: Family): Item {
  if (!n) {
    const s = session();
    const pkg = s.desktop === "hyprland" ? "hyprsunset" : s.wayland ? "wlsunset" : "gammastep";
    return {
      id: "night",
      title: "Night Light unavailable",
      subtitle: `install ${pkg}`,
      icon: { source: Icons.moon, tint: "gray" },
      section: "Night Light",
      detail: {
        markdown: [
          "GNOME and KDE Plasma have their own night light. On Hyprland, Sway and other compositors, or X11, Backslash runs **hyprsunset**, **wlsunset**, **gammastep** or **Redshift** at a fixed temperature.",
          `\`${install(fam, pkg)}\``,
        ].join("\n\n"),
      },
      actions: [action("Check Again", () => refresh(), { icon: Icons.refresh })],
    };
  }
  const kelvin = n.temperature ?? prefs.temperature ?? 4000;
  const scheduled = n.enabled && n.active === false && (n.backend === "gnome" || n.backend === "kde");
  return {
    id: "night",
    title: n.enabled ? "Turn Night Light Off" : "Turn Night Light On",
    subtitle: n.enabled ? scheduled ? "On · waiting for its schedule" : "On" : "Off",
    icon: { source: Icons.moon, tint: n.enabled ? "orange" : "gray" },
    section: "Night Light",
    keywords: ["night light", "lumière nocturne", "veilleuse", "blue light", "redshift", "warm", "chaud"],
    accessories: [{ tag: n.enabled ? "On" : "Off", color: n.enabled ? "orange" : undefined }],
    detail: {
      stats: [
        { label: "night light", value: n.enabled ? "On" : "Off", color: n.enabled ? "orange" : undefined },
        ...(n.enabled || n.temperature ? [{ label: "temperature", value: `${kelvin} K` }] : []),
      ],
      metadata: [
        meta.text("Handled by", BACKENDS[n.backend] ?? n.backend, { icon: Icons.settings }),
        ...(n.schedule ? [meta.text("Schedule", n.schedule, { icon: Icons.clock })] : []),
        ...(n.backend !== "gnome" && n.backend !== "kde"
          ? [meta.text("Runs", "In the background until turned off (systemd user unit)", { icon: Icons.info })]
          : []),
      ],
    },
    actions: [
      action(n.enabled ? "Turn Off" : "Turn On", async () => {
        await setNightLight(!n.enabled, prefs.temperature ?? 4000);
        await toast(`Night light ${n.enabled ? "off" : "on"}`, { style: "success" });
        return refresh();
      }, { icon: n.enabled ? Icons.sun : Icons.moon, shortcut: "<Ctrl>n" }),
    ],
  };
}

function monitorItem(m: Monitor, source?: string): Item {
  const res = resolution(m);
  const tags = [
    ...(m.builtin ? [{ text: "Built-in", color: "blue" as const }] : []),
    ...(m.primary
      ? [{ text: source === "hyprctl" || source === "swaymsg" ? "Focused" : "Primary", color: "green" as const }]
      : []),
    ...(!m.enabled ? [{ text: "Disabled", color: "gray" as const }] : []),
    ...(m.vrr ? [{ text: "VRR", color: "purple" as const }] : []),
  ];
  return {
    id: `monitor:${m.name}`,
    title: m.description,
    subtitle: m.name,
    icon: { source: m.builtin ? Icons.window : Icons.monitor, tint: m.enabled ? "blue" : "gray" },
    section: "Monitors",
    keywords: [m.name, m.make ?? "", m.model ?? "", "monitor", "écran", "display"],
    accessories: m.enabled
      ? [
        { text: `${m.width}×${m.height}` },
        { text: refreshText(m) },
        ...(m.scale !== 1 ? [{ tag: scaleText(m.scale) }] : []),
      ]
      : [{ tag: "Off" }],
    detail: {
      stats: m.enabled
        ? [
          { label: "resolution", value: res },
          { label: "refresh", value: refreshText(m) },
          { label: "scale", value: scaleText(m.scale) },
        ]
        : [],
      metadata: [
        ...(tags.length ? [meta.tags("Status", tags)] : []),
        meta.text("Connector", m.name, { icon: Icons.plug }),
        ...(m.make ? [meta.text("Make", m.make)] : []),
        ...(m.model ? [meta.text("Model", m.model)] : []),
        ...(m.serial ? [meta.text("Serial", m.serial)] : []),
        meta.separator(),
        ...(m.enabled
          ? [
            meta.text("Aspect ratio", aspect(m.width, m.height)),
            ...(m.scale !== 1 ? [meta.text("Looks like", logicalSize(m))] : []),
            meta.text("Position", `${m.x}, ${m.y}`),
            ...(m.transform && m.transform !== "normal" ? [meta.text("Rotation", m.transform)] : []),
          ]
          : []),
        ...(m.modes.length > 1 ? [meta.tags("Modes", m.modes.slice(0, 8))] : []),
        ...(source ? [meta.text("Source", source, { icon: Icons.terminal })] : []),
      ],
    },
    actions: [
      copy(m.name, "Copy Connector Name"),
      copy(`${m.width}x${m.height}@${m.refresh.toFixed(2)}`, "Copy Mode", { section: "Copy" }),
      copy(
        [`${m.description} (${m.name})`, `${res} @ ${refreshText(m)}`, `Scale ${scaleText(m.scale)}`].join("\n"),
        "Copy Details",
        { section: "Copy", shortcut: "<Ctrl><Shift>c" },
      ),
    ],
  };
}

function noMonitors(fam?: Family): Item {
  const s = session();
  const tool = s.wayland
    ? { hyprland: "hyprctl", sway: "swaymsg", kde: "kscreen-doctor", gnome: "gdbus", other: "wlr-randr" }[s.desktop]
    : "xrandr";
  const xrandr =
    { arch: "xorg-xrandr", debian: "x11-xserver-utils", fedora: "xrandr", suse: "xrandr" }[fam ?? "debian"];
  const pkg = tool === "wlr-randr" ? "wlr-randr" : tool === "xrandr" ? xrandr : undefined;
  return {
    id: "monitors:none",
    title: "No monitor information",
    subtitle: `${tool} did not answer`,
    icon: { source: Icons.monitor, tint: "gray" },
    section: "Monitors",
    detail: {
      markdown: [
        "Monitors are listed by the compositor: **hyprctl** (Hyprland), **swaymsg** (Sway), **kscreen-doctor** (KDE), GNOME's display service, **wlr-randr** (other wlroots compositors) or **xrandr** (X11).",
        ...(pkg ? [`\`${install(fam, pkg)}\``] : []),
      ].join("\n\n"),
    },
    actions: [action("Check Again", () => refresh(), { icon: Icons.refresh })],
  };
}

export default list({
  placeholder: "Brightness, night light, monitors…",
  empty: { title: "Nothing to show", icon: Icons.monitor },
  status: (items) => {
    const b = items.find((i) => i.section === "Brightness" && i.accessories?.[0]?.tag);
    const n = items.find((i) => i.id === "night");
    const m = items.filter((i) => i.section === "Monitors" && i.id !== "monitors:none").length;
    return [
      b && `Brightness ${b.accessories![0].tag}`,
      n?.accessories && `Night light ${n.accessories[0].tag?.toLowerCase()}`,
      m && `${m} monitor${m > 1 ? "s" : ""}`,
    ].filter(Boolean).join(" · ") || "Display";
  },
  async *items({ preferences }) {
    const prefs = preferences as Prefs;
    const [bl, night, mons, fam] = await Promise.all([backlights(), nightLight(), monitors(), family()]);
    const subtitle = [
      bl.list[0] && `${percent(bl.list[0])} %`,
      night?.enabled && "Night light on",
    ].filter(Boolean).join(" · ") || null;
    updateCommandMetadata({ subtitle }).catch(() => {});
    const rest = [
      nightItem(night, prefs, fam),
      ...(mons.list.length ? mons.list.map((m) => monitorItem(m, mons.source)) : [noMonitors(fam)]),
    ];
    const panels = bl.list.map((b) => brightnessItem(b, bl.via));
    if (!prefs.ddc) {
      yield [...(panels.length ? panels : [noBrightness(fam)]), ...rest];
      return;
    }
    // External monitors answer slowly: show the rest first.
    yield [...panels, ...rest];
    const ddc = (await ddcDisplays()).map((b) => brightnessItem(b, bl.via));
    yield [...(panels.length || ddc.length ? [...panels, ...ddc] : [noBrightness(fam)]), ...rest];
  },
});
