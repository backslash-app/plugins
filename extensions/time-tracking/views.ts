// Rows shared by the commands: an entry, the setup help.

import { type Action, action, copy, Icons, type Item, meta, open, refresh, toast } from "@backslash/api";
import { type Backend, SetupError, startTimer } from "./api.ts";
import {
  clockTime,
  dayKey,
  dayTitle,
  decimalHours,
  type Entry,
  entryLabel,
  formatClock,
  formatDuration,
  seconds,
  tintOf,
} from "./lib.ts";

export function setupItems(error: SetupError): Item[] {
  return [{
    id: "setup",
    title: error.message,
    subtitle: "Settings → Extensions → Time Tracking",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect a time tracker",
        "",
        "Set **Backend** to `toggl`, `clockify`, `timewarrior` or `kimai` (or leave it empty: the one you",
        "gave credentials for is used, else Timewarrior when it is installed). Then:",
        "",
        "- **Toggl Track**: the API token at the bottom of **Profile settings** (track.toggl.com/profile).",
        "- **Clockify**: **Profile settings → Advanced → API key → Generate**.",
        "- **Timewarrior**: nothing, the `timew` command of this computer is used.",
        "- **Kimai** (2.x): the server address (`https://kimai.example.lan` or `https://you.kimai.cloud`)",
        "  and an API token from **your profile → API Access**.",
        "",
        "Kimai can be on Kimai Cloud, this computer, your local network (`*.lan`, `*.local`, `192.168.x.x`…)",
        "or Tailscale (`*.ts.net`, `100.x.x.x`): the hosts an extension may reach are declared in advance.",
      ].join("\n"),
    },
    actions: [
      open("https://track.toggl.com/profile", "Open Toggl Profile", { icon: Icons.key }),
      open("https://app.clockify.me/user/preferences#advanced", "Open Clockify API Key", { icon: Icons.key }),
      open("https://timewarrior.net/docs/install/", "Install Timewarrior", { icon: Icons.download }),
    ],
  }];
}

/** Runs `load`, turning setup problems into the help row. */
export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof SetupError) return setupItems(e);
    throw e;
  }
}

export function entryMarkdownLine(e: Entry, now = Date.now()): string {
  const end = e.stop ? clockTime(e.stop) : "now";
  return `- ${clockTime(e.start)}–${end} **${entryLabel(e)}** ${formatDuration(seconds(e, now))}`;
}

export function entryDetail(b: Backend, e: Entry, now = Date.now()) {
  const s = seconds(e, now);
  return {
    stats: [
      {
        label: e.stop ? "duration" : "running for",
        value: e.stop ? formatDuration(s) : formatClock(s),
        color: e.stop ? undefined : "green" as const,
      },
      { label: "hours", value: decimalHours(s) },
    ],
    metadata: [
      meta.text("Description", e.description || "(none)", { icon: Icons.text }),
      ...(e.project ? [meta.tags("Project", [{ text: e.project.name, color: tintOf(e.project.color) }])] : []),
      ...(e.project?.client ? [meta.text("Client", e.project.client, { icon: Icons.person })] : []),
      ...(e.tags.length ? [meta.tags("Tags", e.tags)] : []),
      ...(e.billable ? [meta.text("Billable", "Yes", { icon: Icons.coin, color: "green" })] : []),
      meta.separator(),
      meta.text("Day", dayTitle(dayKey(e.start), new Date(now)), { icon: Icons.calendar }),
      meta.text("Started", clockTime(e.start), { icon: Icons.play }),
      meta.text("Stopped", e.stop ? clockTime(e.stop) : "Running", {
        icon: e.stop ? Icons.stop : Icons.timer,
        color: e.stop ? undefined : "green",
      }),
      meta.text("Tracker", b.name, { icon: Icons.clock }),
    ],
  };
}

export function resumeAction(b: Backend, e: Entry, options: { shortcut?: string; section?: string } = {}): Action {
  return action(e.stop ? "Continue" : "Restart", async () => {
    await startTimer(b, e, true);
    await toast("Timer started", { style: "success", message: entryLabel(e) });
    return refresh();
  }, { icon: Icons.play, ...options });
}

export function stopAction(b: Backend, e: Entry, options: { shortcut?: string; section?: string } = {}): Action {
  return action("Stop Timer", async () => {
    await b.stop(e);
    await toast("Timer stopped", { style: "success", message: `${entryLabel(e)} · ${formatDuration(seconds(e))}` });
    return refresh();
  }, { icon: Icons.stop, ...options });
}

export function deleteAction(b: Backend, e: Entry): Action {
  return action("Delete Entry", async () => {
    await b.remove(e);
    await toast("Entry deleted", { message: entryLabel(e) });
    return refresh();
  }, {
    icon: Icons.trash,
    destructive: true,
    confirm: `Delete “${entryLabel(e)}” (${formatDuration(seconds(e))})?`,
    shortcut: "<Ctrl><Shift>x",
    section: "Entry",
  });
}

export function copyEntry(e: Entry): Action {
  return copy(
    `${entryLabel(e)}: ${formatDuration(seconds(e))} (${clockTime(e.start)}–${e.stop ? clockTime(e.stop) : "now"})`,
    "Copy Entry",
    { shortcut: "<Ctrl><Shift>c", section: "Copy" },
  );
}
