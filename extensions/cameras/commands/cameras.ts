import {
  type Action,
  action,
  type Context,
  copy,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { cameras, events, liveUrl, type Server, server, setDetection, SetupError, snapshots } from "../api.ts";
import {
  ago,
  type Camera,
  cameraLook,
  type Event,
  eventTitle,
  fps,
  labelColor,
  latestByCamera,
  prettyName,
  version,
} from "../lib.ts";
import { eventsList, setupItems } from "../views.ts";

function cameraItem(s: Server, c: Camera, snapshot: string | undefined, last: Event | undefined): Item {
  const look = cameraLook(c);
  const actions: Action[] = [
    open(liveUrl(s, c.name), "Open Live View", { icon: Icons.video }),
    action("Show Events", () => eventsList(() => s, c.name), { icon: Icons.history, shortcut: "<Ctrl>e" }),
    ...(snapshot ? [open(snapshot, "Open Snapshot", { icon: Icons.image, shortcut: "<Ctrl>o" })] : []),
    c.detecting
      ? action("Turn Detection Off", async () => {
        await setDetection(s, c.name, false);
        await toast(`Detection off on ${c.title}`, { message: "Until you turn it back on or Frigate restarts" });
        return refresh();
      }, {
        icon: Icons.eyeOff,
        shortcut: "<Ctrl>d",
        destructive: true,
        confirm: `Stop detecting objects on ${c.title}? No event is recorded meanwhile`,
        section: "Camera",
      })
      : action("Turn Detection On", async () => {
        await setDetection(s, c.name, true);
        await toast(`Detecting on ${c.title}`, { style: "success" });
        return refresh();
      }, { icon: Icons.eye, shortcut: "<Ctrl>d", section: "Camera" }),
    action("Refresh Snapshot", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Camera" }),
    copy(`${s.base}/api/${c.name}/latest.jpg`, "Copy Snapshot Link", { section: "Copy" }),
    copy(c.name, "Copy Camera Name", { section: "Copy" }),
  ];
  return {
    id: c.name,
    title: c.title,
    subtitle: last ? `${eventTitle(last)} ${ago(last.start)}` : undefined,
    icon: { source: Icons.camera, tint: look.color },
    section: c.enabled ? "Cameras" : "Disabled",
    keywords: [c.name, ...c.objects, ...c.zones, look.label],
    accessories: [
      ...(c.recording ? [{ icon: { source: Icons.dot, tint: "red" as const }, tooltip: "Recording" }] : []),
      ...(c.fps !== undefined ? [{ text: fps(c.fps), tooltip: "Camera frame rate" }] : []),
      { tag: look.label, color: look.color },
    ],
    detail: {
      image: snapshot,
      metadata: [
        meta.text("Status", look.label, { icon: { source: Icons.dot, tint: look.color }, color: look.color }),
        ...(last
          ? [meta.text("Last event", `${eventTitle(last)}, ${ago(last.start)}`, {
            icon: { source: Icons.eye, tint: labelColor(last.label) },
          })]
          : []),
        meta.text("Detection", c.detecting ? "On" : "Off", { icon: c.detecting ? Icons.eye : Icons.eyeOff }),
        meta.text("Recording", c.recording ? "On" : "Off", { icon: Icons.video }),
        meta.text("Snapshots", c.snapshots ? "On" : "Off", { icon: Icons.image }),
        ...(c.fps !== undefined ? [meta.text("Camera", fps(c.fps))] : []),
        ...(c.detectionFps !== undefined ? [meta.text("Detections", fps(c.detectionFps))] : []),
        ...(c.skippedFps ? [meta.text("Skipped", fps(c.skippedFps), { color: "orange" })] : []),
        ...(c.resolution ? [meta.text("Detect resolution", c.resolution)] : []),
        meta.tags("Tracks", c.objects.map((o) => ({ text: prettyName(o), color: labelColor(o) }))),
        ...(c.zones.length ? [meta.tags("Zones", c.zones.map(prettyName))] : []),
      ],
    },
    actions,
  };
}

let status = "";

export default (ctx: Context) =>
  list({
    placeholder: "Filter cameras…",
    empty: { title: "No camera", description: "Add cameras to Frigate's configuration", icon: Icons.camera },
    status: () => status,
    actions: [action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
    async *items({ signal }) {
      status = "";
      let s: Server;
      let found: Awaited<ReturnType<typeof cameras>>;
      let recent: Event[];
      try {
        s = server(ctx.preferences);
        [found, recent] = await Promise.all([
          cameras(s, signal),
          events(s, { limit: 50, signal }).catch(() => [] as Event[]),
        ]);
      } catch (e) {
        if (signal.aborted) throw e;
        if (e instanceof SetupError) {
          yield setupItems(e);
          return;
        }
        throw e;
      }
      const last = latestByCamera(recent);
      const down = found.cameras.filter((c) => cameraLook(c).color === "red").length;
      const off = found.cameras.filter((c) => c.enabled && !c.detecting).length;
      status = [
        `${found.cameras.length} camera${found.cameras.length === 1 ? "" : "s"}`,
        ...(down ? [`${down} without signal`] : []),
        ...(off ? [`detection off on ${off}`] : []),
        ...(found.version ? [`Frigate ${version(found.version)}`] : []),
      ].join(" · ");
      updateCommandMetadata({
        subtitle: down ? `${down} without signal` : off ? `Detection off on ${off}` : null,
      }).catch(() => {});
      const enabled = found.cameras.filter((c) => c.enabled).map((c) => c.name);
      // The last saved frames at once, then fresh ones.
      const cached = await snapshots(s, enabled, { deadline: 0, signal });
      yield found.cameras.map((c) => cameraItem(s, c, cached.get(c.name), last.get(c.name)));
      const fresh = await snapshots(s, enabled, { signal });
      yield found.cameras.map((c) => cameraItem(s, c, fresh.get(c.name), last.get(c.name)));
    },
  });
