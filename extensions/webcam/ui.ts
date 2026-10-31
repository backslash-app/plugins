// The views shared by the commands: cameras, their controls, and the snapshots.

import {
  type Action,
  action,
  type Color,
  copy,
  field,
  form,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  pop,
  refresh,
  submenu,
  toast,
} from "@backslash/api";
import {
  autoPartner,
  clamp,
  coarseStep,
  type Control,
  displayValue,
  formatSummary,
  formatTime,
  isInactive,
  isReadOnly,
  nextMenuValue,
  niceName,
  parseValue,
  ratio,
  sortControls,
} from "./lib.ts";
import {
  type Camera,
  controls,
  DEFAULT_FOLDER,
  setControls,
  type Shot,
  shots,
  snapshot,
  tilde,
  trash,
} from "./system.ts";

export type Prefs = Record<string, unknown>;

export const folderOf = (prefs: Prefs) => String(prefs.folder || DEFAULT_FOLDER);

const formatBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

// ---------------------------------------------------------------------------
// Snapshots

export async function takeAndShow(cam: Camera, prefs: Prefs) {
  await toast(`Smile! Taking a picture with ${cam.device.name}…`);
  const path = await snapshot(cam, folderOf(prefs), prefs);
  return snapshotsView(prefs, cam, path);
}

export function snapshotAction(cam: Camera, prefs: Prefs, o: { shortcut?: string; section?: string } = {}): Action {
  return action("Take Snapshot", () => takeAndShow(cam, prefs), { icon: Icons.camera, ...o });
}

function shotRow(s: Shot, prefs: Prefs, cam?: Camera): Item {
  return {
    id: s.path,
    title: s.name,
    subtitle: formatTime(s.mtime),
    icon: { source: Icons.image, tint: "blue" },
    accessories: [{ text: formatBytes(s.size) }],
    detail: {
      image: s.path,
      metadata: [
        meta.text("Taken", formatTime(s.mtime), { icon: Icons.clock }),
        meta.text("Size", formatBytes(s.size)),
        meta.text("File", tilde(s.path), { icon: Icons.file }),
      ],
    },
    actions: [
      open(s.path, "Open Picture"),
      ...(cam ? [snapshotAction(cam, prefs, { shortcut: "<Ctrl>n" })] : []),
      open(s.path.slice(0, s.path.lastIndexOf("/")), "Open Folder", { icon: Icons.folder, shortcut: "<Ctrl>o" }),
      copy(s.path, "Copy Path", { shortcut: "<Ctrl><Shift>c" }),
      action("Move to Trash", async () => {
        await trash(s.path);
        await toast(`${s.name} moved to the trash`, { style: "success" });
        return refresh();
      }, { icon: Icons.trash, destructive: true, confirm: `Move ${s.name} to the trash?`, shortcut: "<Ctrl>Delete" }),
    ],
  };
}

/** The pictures in the snapshot folder, newest first (the one just taken selected). */
export function snapshotsView(prefs: Prefs, cam?: Camera, taken?: string): ListSpec {
  return list({
    title: taken ? "Snapshot Taken" : "Webcam Snapshots",
    placeholder: "Filter snapshots…",
    empty: {
      title: "No snapshot yet",
      description: cam
        ? "Ctrl+N takes one"
        : `Take one with Take Webcam Snapshot; they are saved in ${folderOf(prefs)}`,
      icon: Icons.camera,
    },
    status: (items) => `${items.length} in ${folderOf(prefs)}`,
    actions: cam ? [snapshotAction(cam, prefs, { shortcut: "<Ctrl>n" })] : [],
    async items() {
      const list = await shots(folderOf(prefs));
      // The new picture first, even if the clock went backwards.
      if (taken) list.sort((a, b) => Number(b.path === taken) - Number(a.path === taken));
      return list.map((s) => shotRow(s, prefs, cam));
    },
  });
}

// ---------------------------------------------------------------------------
// Controls

async function apply(cam: Camera, c: Control, value: number, all: Control[]) {
  const v = clamp(c, value);
  const partner = autoPartner(c.name, all);
  // A manual value only sticks once the automatic mode is off.
  const pre: [string, number][] = partner && isInactive(c) && partner.control.value !== partner.manual
    ? [[partner.control.name, partner.manual]]
    : [];
  if (pre.length) await setControls(cam.node, pre);
  await setControls(cam.node, [[c.name, v]]);
  if (pre.length) await toast(`${niceName(partner!.control.name)} turned off to set ${niceName(c.name)}`);
  return refresh();
}

function valueForm(cam: Camera, c: Control, all: Control[]) {
  return form({
    title: niceName(c.name),
    submitTitle: "Set",
    fields: [
      field.text("value", c.min !== undefined ? `Value (${c.min} to ${c.max})` : "Value", {
        value: String(c.value ?? ""),
        required: true,
        placeholder: c.default !== undefined ? `Default ${c.default}` : undefined,
      }),
    ],
    async submit(values) {
      await apply(cam, c, parseValue(c, String(values.value ?? "")), all);
      return pop();
    },
  });
}

function controlActions(cam: Camera, c: Control, all: Control[], prefs: Prefs): Action[] {
  if (isReadOnly(c)) return [copy(String(c.value ?? ""), "Copy Value")];
  const reset = c.default !== undefined && c.value !== c.default
    ? [action("Reset to Default", () => apply(cam, c, c.default!, all), {
      icon: Icons.history,
      shortcut: "<Ctrl>r",
      section: "Value",
    })]
    : [];
  const snap = snapshotAction(cam, prefs, { shortcut: "<Ctrl>n", section: "Camera" });
  if (c.type === "bool") {
    return [
      action(c.value ? "Turn Off" : "Turn On", () => apply(cam, c, c.value ? 0 : 1, all), { icon: Icons.power }),
      ...reset,
      snap,
    ];
  }
  if (c.type === "menu" || c.type === "intmenu") {
    const next = nextMenuValue(c);
    const label = (v: number) => c.menu.find((m) => m.value === v)?.label ?? String(v);
    return [
      ...(next !== undefined
        ? [action(`Switch to ${label(next)}`, () => apply(cam, c, next, all), { icon: Icons.cycle })]
        : []),
      submenu(
        "Choose…",
        c.menu.map((m) =>
          action(m.label, () => apply(cam, c, m.value, all), { icon: m.value === c.value ? Icons.check : Icons.dot })
        ),
        { icon: Icons.chevronRight, shortcut: "<Ctrl>l" },
      ),
      ...reset,
      snap,
    ];
  }
  if (c.type === "int" || c.type === "int64") {
    const step = coarseStep(c);
    return [
      action(`Increase by ${step}`, () => apply(cam, c, (c.value ?? 0) + step, all), { icon: Icons.plus }),
      action(`Decrease by ${step}`, () => apply(cam, c, (c.value ?? 0) - step, all), { icon: Icons.minus }),
      action("Set Value…", () => valueForm(cam, c, all), {
        icon: Icons.settings,
        shortcut: "<Ctrl>e",
        section: "Value",
      }),
      ...(c.max !== undefined
        ? [action("Set to Maximum", () => apply(cam, c, c.max!, all), { icon: Icons.arrowUp, section: "Value" })]
        : []),
      ...(c.min !== undefined
        ? [action("Set to Minimum", () => apply(cam, c, c.min!, all), { icon: Icons.arrowDown, section: "Value" })]
        : []),
      ...reset,
      snap,
    ];
  }
  if (c.type === "button") return [action("Press", () => apply(cam, c, 1, all), { icon: Icons.bolt }), snap];
  return [copy(String(c.value ?? ""), "Copy Value"), snap];
}

function controlRow(cam: Camera, c: Control, all: Control[], prefs: Prefs): Item {
  const inactive = isInactive(c);
  const partner = autoPartner(c.name, all);
  const r = ratio(c);
  const changed = c.default !== undefined && c.value !== undefined && c.value !== c.default;
  return {
    id: c.name,
    title: niceName(c.name),
    subtitle: c.name,
    icon: {
      source: c.type === "bool"
        ? (c.value ? Icons.squareCheck : Icons.square)
        : c.menu.length
        ? Icons.layers
        : Icons.sun,
      tint: inactive ? "gray" : "blue",
    },
    section: c.section,
    keywords: [c.name, c.type, ...c.menu.map((m) => m.label)],
    accessories: [
      ...(inactive
        ? [{
          tag: "auto",
          color: "gray" as Color,
          tooltip: partner ? `Set by ${niceName(partner.control.name)}` : "Inactive",
        }]
        : []),
      ...(changed ? [{ icon: { source: Icons.dot, tint: "orange" as Color }, tooltip: `Default: ${c.default}` }] : []),
      { text: displayValue(c) },
    ],
    detail: {
      metadata: [
        meta.text("Value", displayValue(c), { icon: Icons.sun }),
        ...(r !== undefined ? [meta.progress("Range", r, `${c.min} … ${c.max}`)] : []),
        ...(c.default !== undefined
          ? [meta.text("Default", c.menu.find((m) => m.value === c.default)?.label ?? String(c.default))]
          : []),
        ...(c.step && c.step > 1 ? [meta.text("Step", c.step)] : []),
        ...(c.menu.length
          ? [
            meta.tags(
              "Choices",
              c.menu.map((m) => ({ text: m.label, color: m.value === c.value ? "blue" as Color : undefined })),
            ),
          ]
          : []),
        ...(inactive
          ? [meta.text(
            "Inactive",
            partner ? `${niceName(partner.control.name)} is on: changing this turns it off` : "Set by the camera",
          )]
          : []),
        meta.separator(),
        meta.text("Control", c.name),
        meta.text("Camera", `${cam.device.name} (${cam.node})`, { icon: Icons.camera }),
      ],
    },
    actions: controlActions(cam, c, all, prefs),
  };
}

export function controlsView(cam: Camera, prefs: Prefs): ListSpec {
  return list({
    title: cam.device.name,
    placeholder: "Filter controls: brightness, exposure, focus, zoom…",
    empty: { title: "This camera has no adjustable controls", icon: Icons.camera },
    status: (items) => `${items.length} controls · ${cam.node}`,
    actions: [
      snapshotAction(cam, prefs, { shortcut: "<Ctrl>n" }),
      action("Reset All to Defaults", async () => {
        const all = await controls(cam.node);
        const values = all.filter((c) =>
          !isReadOnly(c) && c.type !== "button" && c.default !== undefined && c.value !== c.default
        )
          // Automatic modes first, so manual values they override aren't refused.
          .sort((a, b) => Number(!!autoPartner(a.name, all)) - Number(!!autoPartner(b.name, all)))
          .map((c) => [c.name, c.default!] as [string, number]);
        for (const v of values) await setControls(cam.node, [v]).catch(() => {});
        await toast(`${values.length} controls reset`, { style: "success" });
        return refresh();
      }, { icon: Icons.history, destructive: true, confirm: "Reset every control of this camera to its default?" }),
    ],
    async items({ signal }) {
      const all = sortControls(await controls(cam.node, signal));
      return all.map((c) => controlRow(cam, c, all, prefs));
    },
  });
}

// ---------------------------------------------------------------------------
// Cameras

export function cameraRow(cam: Camera, prefs: Prefs, isDefault: boolean): Item {
  const formats = formatSummary(cam.formats);
  return {
    id: cam.node,
    title: cam.device.name,
    subtitle: cam.node,
    icon: { source: Icons.camera, tint: "blue" },
    keywords: [...cam.device.nodes, cam.info.driver ?? "", cam.device.bus],
    accessories: [
      ...(isDefault ? [{ tag: "default", color: "blue" as Color }] : []),
      ...(cam.info.driver ? [{ text: cam.info.driver }] : []),
    ],
    detail: {
      metadata: [
        meta.text("Device", cam.node, { icon: Icons.camera }),
        meta.text("Other nodes", cam.device.nodes.filter((n) => n !== cam.node).join(", ") || "—"),
        ...(cam.info.driver ? [meta.text("Driver", cam.info.driver)] : []),
        ...(cam.device.bus ? [meta.text("Bus", cam.device.bus, { icon: Icons.plug })] : []),
        ...(formats ? [meta.text("Largest pictures", formats, { icon: Icons.image })] : []),
        meta.separator(),
        meta.text("Snapshots", folderOf(prefs), { icon: Icons.folder }),
      ],
    },
    actions: [
      action("Show Controls", () => controlsView(cam, prefs), { icon: Icons.settings }),
      snapshotAction(cam, prefs),
      action("Show Snapshots", () => snapshotsView(prefs, cam), { icon: Icons.image, shortcut: "<Ctrl>s" }),
      copy(cam.node, "Copy Device Path", { shortcut: "<Ctrl><Shift>c" }),
    ],
  };
}
