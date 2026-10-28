import { action, close, copy, exec, Icons, type Item, list, meta, refresh, toast } from "@backslash/api";
import {
  CATEGORIES,
  CINNAMON_TOGGLES,
  commandLine,
  type Desktop,
  DESKTOP_NAMES,
  detectDesktop,
  GNOME_TOGGLES,
  isDarkScheme,
  isOn,
  type Panel,
  panelsFor,
  parseGnomeVersion,
  type Toggle,
} from "../lib.ts";

const PATH = (Deno.env.get("PATH") ?? "").split(":").filter(Boolean);

/**
 * Whether a program is on PATH. Folders outside the read permission can't be looked into: when
 * none can, assume it is there.
 */
async function installed(program: string): Promise<boolean> {
  let looked = false;
  for (const dir of PATH) {
    try {
      const info = await Deno.stat(`${dir}/${program}`);
      looked = true;
      if (info.isFile) return true;
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) looked = true;
    }
  }
  return !looked;
}

/** Starts the settings window detached from Backslash, with the first command that is installed. */
function launch(panel: Panel): string {
  for (const [program, ...args] of panel.commands) {
    try {
      new Deno.Command(program, {
        args,
        env: panel.env,
        stdin: "null",
        stdout: "null",
        stderr: "null",
      }).spawn().unref();
      return program;
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound || err instanceof Deno.errors.NotCapable)) throw err;
    }
  }
  throw new Error(`${panel.commands.map((c) => c[0]).join(" or ")} is not installed`);
}

function panelItem(p: Panel, desktop: Desktop): Item {
  const command = commandLine(p.commands[0]);
  return {
    id: p.id,
    title: p.title,
    subtitle: p.description,
    icon: { source: p.icon, tint: p.tint },
    section: p.category,
    keywords: [...p.keywords, p.category, ...p.commands.flat()],
    detail: {
      markdown: p.description,
      metadata: [
        meta.tags("Category", [{ text: p.category, color: p.tint }]),
        meta.text("Desktop", p.env ? "GNOME (installed apart)" : DESKTOP_NAMES[desktop], { icon: Icons.monitor }),
        meta.text("Opens", command, { icon: Icons.terminal }),
        ...(p.commands.length > 1
          ? [meta.text("Or", p.commands.slice(1).map((c) => c[0]).join(", "), { color: "gray" })]
          : []),
      ],
    },
    actions: [
      action("Open", () => {
        launch(p);
        return close();
      }, { icon: Icons.external }),
      copy(command, "Copy Command", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    ],
  };
}

function toggleItem(t: Toggle, on: boolean, set: (on: boolean) => Promise<void>): Item {
  return {
    id: `toggle:${t.id}`,
    title: t.title,
    subtitle: t.description,
    icon: { source: on ? t.icon[0] : t.icon[1], tint: on ? t.tint : "gray" },
    section: "Quick Toggles",
    keywords: [...t.keywords, "toggle", "switch", "basculer", "activer", "désactiver"],
    accessories: [{ tag: on ? "On" : "Off", color: on ? t.tint : "gray" }],
    detail: {
      markdown: t.description,
      metadata: [
        meta.text("State", on ? "On" : "Off", { icon: on ? Icons.check : Icons.cross, color: on ? "green" : "gray" }),
        ...(t.schema ? [meta.text("Setting", `${t.schema} ${t.key}`, { icon: Icons.braces })] : []),
      ],
    },
    actions: [
      action(on ? `Turn Off ${t.title}` : `Turn On ${t.title}`, async () => {
        await set(!on);
        await toast(`${t.title} ${on ? "off" : "on"}`, { style: "success" });
        return refresh();
      }, { icon: on ? t.icon[1] : t.icon[0] }),
    ],
  };
}

/** gsettings switches; keys this version doesn't have are left out. */
async function gsettingsToggles(toggles: Toggle[]): Promise<Item[]> {
  const items = await Promise.all(toggles.map(async (t) => {
    const value = await exec("gsettings", ["get", t.schema, t.key]).catch(() => undefined);
    if (value === undefined) return undefined;
    return toggleItem(t, isOn(t, value), async (on) => {
      await exec("gsettings", ["set", t.schema, t.key, on ? t.on : t.off]);
    });
  }));
  return items.filter((i): i is Item => i !== undefined);
}

/** Plasma's dark mode: switch between Breeze Dark and Breeze Light. */
async function plasmaToggles(): Promise<Item[]> {
  const read = (program: string) =>
    exec(program, ["--file", "kdeglobals", "--group", "General", "--key", "ColorScheme"]);
  const scheme = await read("kreadconfig6").catch(() => read("kreadconfig5")).catch(() => undefined);
  if (scheme === undefined) return [];
  const toggle: Toggle = {
    id: "dark",
    title: "Dark Colors",
    description: `Switch between Breeze Dark and Breeze Light (now: ${scheme || "Breeze"})`,
    schema: "",
    key: "",
    on: "BreezeDark",
    off: "BreezeLight",
    icon: [Icons.moon, Icons.sun],
    tint: "purple",
    keywords: ["dark mode", "dark theme", "mode sombre", "thème sombre", "breeze"],
  };
  return [toggleItem(toggle, isDarkScheme(scheme), async (on) => {
    await exec("plasma-apply-colorscheme", [on ? "BreezeDark" : "BreezeLight"]);
  })];
}

export default async () => {
  const desktop = detectDesktop(Deno.env.get("XDG_CURRENT_DESKTOP") ?? "");
  const gnomeInstalled = desktop === "gnome" || desktop === "other" ? await installed("gnome-control-center") : false;
  const gnomeVersion = gnomeInstalled
    ? await exec("gnome-control-center", ["--version"]).then(parseGnomeVersion).catch(() => undefined)
    : undefined;
  const all = panelsFor(desktop, { gnomeVersion, gnomeInstalled });
  // Only panels whose program is here (pavucontrol, blueman… are optional on Xfce and window managers).
  const available = await Promise.all(
    all.map(async (p) => (await Promise.all(p.commands.map((c) => installed(c[0])))).some(Boolean)),
  );
  const panels = all.filter((_, i) => available[i]);
  const toggles = desktop === "gnome"
    ? await gsettingsToggles(GNOME_TOGGLES)
    : desktop === "cinnamon"
    ? await gsettingsToggles(CINNAMON_TOGGLES)
    : desktop === "kde"
    ? await plasmaToggles()
    : [];

  const order = (p: Panel) => CATEGORIES.indexOf(p.category);
  const items = [
    ...toggles,
    ...panels.map((p, i) => ({ p, i })).sort((a, b) => order(a.p) - order(b.p) || a.i - b.i).map(({ p }) =>
      panelItem(p, desktop)
    ),
  ];
  const name = DESKTOP_NAMES[desktop];
  return list({
    placeholder: `Search ${desktop === "other" ? "" : `${name} `}settings…`,
    empty: {
      title: desktop === "other" ? "No settings app found" : "No settings panel matches",
      description: desktop === "other"
        ? "Install nm-connection-editor, blueman, pavucontrol, nwg-look or GNOME Settings to see them here"
        : `Try another word, in English or in French`,
      icon: Icons.settings,
    },
    status: `${name} · ${panels.length} panels${toggles.length ? ` · ${toggles.length} quick toggles` : ""}`,
    items,
  });
};
