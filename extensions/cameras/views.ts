// The events list, shared by Camera Events and a camera's "Show Events".

import {
  type Action,
  action,
  copy,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  refresh,
  toast,
} from "@backslash/api";
import {
  clipUrl,
  deleteEvent,
  eventPictures,
  events,
  eventUrl,
  pruneEventPictures,
  retain,
  type Server,
  SetupError,
  snapshotUrl,
} from "./api.ts";
import { ago, duration, type Event, eventTitle, inGroup, labelColor, labelIcon, percent, prettyName } from "./lib.ts";
import type { SetupKind } from "./net.ts";

export function eventItem(s: Server, e: Event, picture: string | undefined, showCamera: boolean): Item {
  const live = !e.end;
  const actions: Action[] = [
    ...(e.hasClip ? [open(clipUrl(s, e.id), "Play Clip", { icon: Icons.play })] : []),
    ...(picture ? [open(picture, "Open Snapshot", { icon: Icons.image, shortcut: "<Ctrl>o" })] : []),
    open(eventUrl(s, e.id), "Open in Frigate", { icon: Icons.window, shortcut: "<Ctrl>f" }),
    ...(e.hasSnapshot
      ? [open(snapshotUrl(s, e.id), "Open Full Snapshot in Browser", { icon: Icons.external, section: "Open" })]
      : []),
    action(e.retained ? "Stop Keeping" : "Keep Forever", async () => {
      await retain(s, e.id, !e.retained);
      await toast(e.retained ? "Retention applies again" : "Kept forever", { style: "success" });
      return refresh();
    }, { icon: e.retained ? Icons.starFilled : Icons.star, shortcut: "<Ctrl>s", section: "Event" }),
    copy(e.hasClip ? clipUrl(s, e.id) : eventUrl(s, e.id), e.hasClip ? "Copy Clip Link" : "Copy Link", {
      section: "Event",
    }),
    action("Delete Event", async () => {
      await deleteEvent(s, e.id);
      await toast("Event deleted");
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: "Delete this event with its clip and snapshot?",
      shortcut: "<Ctrl><Shift>Delete",
      section: "Event",
    }),
  ];
  return {
    id: e.id,
    title: eventTitle(e),
    subtitle: showCamera ? prettyName(e.camera) : e.zones.map(prettyName).join(", ") || undefined,
    icon: picture ?? { source: labelIcon(e.label), tint: labelColor(e.label) },
    section: live
      ? "In Progress"
      : new Date(e.start).toDateString() === new Date().toDateString()
      ? "Today"
      : "Earlier",
    keywords: [e.label, e.subLabel ?? "", e.camera, ...e.zones, e.description ?? ""],
    accessories: [
      ...(e.retained ? [{ icon: { source: Icons.starFilled, tint: "yellow" as const }, tooltip: "Kept forever" }] : []),
      ...(e.score !== undefined ? [{ text: percent(e.score), tooltip: "Top score" }] : []),
      ...(live ? [{ tag: "live", color: "red" as const }] : e.end ? [{ text: duration(e.end - e.start) }] : []),
      { text: ago(e.start), icon: Icons.clock },
    ],
    detail: {
      image: picture,
      markdown: e.description,
      metadata: [
        meta.tags("Label", [{ text: prettyName(e.label), color: labelColor(e.label) }]),
        ...(e.subLabel ? [meta.text("Recognized", e.subLabel, { icon: Icons.person })] : []),
        meta.text("Camera", prettyName(e.camera), { icon: Icons.camera }),
        ...(e.zones.length ? [meta.tags("Zones", e.zones.map(prettyName))] : []),
        ...(e.score !== undefined ? [meta.progress("Score", e.score)] : []),
        meta.text("Started", new Date(e.start).toLocaleString("en-GB"), { icon: Icons.clock }),
        meta.text("Duration", live ? "In progress" : duration((e.end ?? e.start) - e.start)),
        meta.text("Clip", e.hasClip ? "Yes" : "No", { icon: Icons.video }),
        ...(e.retained ? [meta.text("Kept", "Forever", { icon: Icons.starFilled, color: "yellow" })] : []),
      ],
    },
    actions,
  };
}

export function setupItems(e: SetupError): Item[] {
  const CONFIGURE = "**Settings → Extensions → Frigate → Configure**";
  const guide: Record<SetupKind, string> = {
    url:
      `## Connect Frigate\n\nSet its address in ${CONFIGURE}: \`http://frigate.lan:5000\` (the internal port, no sign-in) or \`https://frigate.lan:8971\` with a Frigate user and password.`,
    auth:
      `## Sign in\n\n${e.message}. Port 8971 needs a Frigate user (Settings → Users in Frigate); port 5000 needs none.`,
    permission: `## Not allowed\n\n${e.message}.`,
    host:
      "## Address out of reach\n\nThis extension may reach `frigate`, local names (`*.lan`, `*.local`, `*.home.arpa`…), private networks and Tailscale. Use Frigate's local address in " +
      CONFIGURE + ".",
    tls:
      `## Self-signed HTTPS certificate\n\nFrigate's port 8971 uses a self-signed certificate. Paste it (PEM) as **Certificate** in ${CONFIGURE}, or use \`http://…:5000\` on your network.`,
    down: `## Frigate doesn't answer\n\nCheck that \`${
      e.base ?? "…"
    }\` opens in a browser, and the address in ${CONFIGURE}.`,
    unknown: `## Not Frigate\n\n${e.message}. Use the address of Frigate's web interface.`,
  };
  return [{
    id: "setup",
    title: e.message,
    subtitle: "Settings → Extensions → Frigate → Configure",
    icon: { source: e.kind === "auth" ? Icons.key : Icons.camera, tint: "orange" },
    detail: { markdown: guide[e.kind] },
    actions: [
      ...(e.base && e.kind !== "host" ? [open(e.base, "Open Frigate", { icon: Icons.globe })] : []),
      action("Try Again", () => refresh(), { icon: Icons.refresh }),
    ],
  }];
}

/** Recent events, newest first, with their snapshot; `camera` narrows to one. */
export function eventsList(getServer: () => Server, camera?: string): ListSpec {
  let count = 0;
  return list({
    title: camera ? `${prettyName(camera)} Events` : undefined,
    placeholder: "Filter events by label, camera, zone…",
    filter: {
      options: [
        { value: "all", title: "All" },
        { value: "people", title: "People" },
        { value: "vehicles", title: "Vehicles" },
        { value: "animals", title: "Animals" },
      ],
      default: "all",
    },
    empty: {
      title: "No event",
      description: camera ? "Nothing detected on this camera lately" : "Nothing detected lately",
      icon: Icons.camera,
    },
    status: () => `${count} event${count === 1 ? "" : "s"}`,
    actions: [action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
    async *items({ filter, signal }) {
      count = 0;
      let s: Server;
      let list: Event[];
      try {
        s = getServer();
        list = (await events(s, { camera, limit: 100, signal })).filter((e) => inGroup(e.label, filter));
      } catch (e) {
        if (signal.aborted) throw e;
        if (e instanceof SetupError) {
          yield setupItems(e);
          return;
        }
        throw e;
      }
      count = list.length;
      // Rows at once, then with their pictures.
      yield list.map((e) => eventItem(s, e, undefined, !camera));
      const pictures = await eventPictures(s, list.slice(0, 40), { signal });
      yield list.map((e) => eventItem(s, e, pictures.get(e.id), !camera));
      pruneEventPictures(s).catch(() => {});
    },
  });
}
