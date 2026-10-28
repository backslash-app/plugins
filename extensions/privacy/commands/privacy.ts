import {
  type Action,
  action,
  close,
  type Color,
  copy,
  exec,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  storage,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  busValue,
  clock,
  deviceUses,
  type Kind,
  KIND_TITLE,
  mergeUses,
  parseFuser,
  parseGeoclueClients,
  parsePs,
  parsePwDump,
  parseSourceOutputs,
  prettyApp,
  type Proc,
  since,
  subtitle,
  type Use,
} from "../lib.ts";

const DESKTOP = (Deno.env.get("XDG_CURRENT_DESKTOP") ?? "").toLowerCase();

/** Runs a program; undefined when it is missing or fails. */
async function tryRun(program: string, args: string[], signal?: AbortSignal): Promise<string | undefined> {
  try {
    const { code, stdout } = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "null",
      signal,
    }).output();
    const out = new TextDecoder().decode(stdout);
    // fuser exits with 1 when nobody holds the file.
    return code === 0 || program === "fuser" ? out : undefined;
  } catch {
    return undefined;
  }
}

interface Scan {
  uses: Use[];
  procs: Map<number, Proc>;
  /** What could be checked. */
  pipewire: boolean;
  pulse: boolean;
  cameras: string[];
}

async function cameraHolders(signal: AbortSignal): Promise<{ device: string; pids: number[] }[]> {
  // find instead of reading /dev from Deno: only the names of the video devices are needed.
  const list = await tryRun("find", ["/dev", "-maxdepth", "1", "-name", "video*"], signal);
  const devices = (list ?? "").split("\n").map((l) => l.trim()).filter(Boolean).sort();
  return await Promise.all(devices.map(async (device) => ({
    device,
    pids: parseFuser(await tryRun("fuser", [device], signal) ?? ""),
  })));
}

async function geoclue(signal: AbortSignal): Promise<Use[]> {
  const tree = await tryRun("busctl", ["--system", "--list", "tree", "org.freedesktop.GeoClue2"], signal);
  if (!tree) return [];
  const uses: Use[] = [];
  for (const path of parseGeoclueClients(tree)) {
    const get = (prop: string) =>
      tryRun("busctl", [
        "--system",
        "--json=short",
        "get-property",
        "org.freedesktop.GeoClue2",
        path,
        "org.freedesktop.GeoClue2.Client",
        prop,
      ], signal).then((o) => (o ? busValue(o) : undefined));
    const [active, id] = await Promise.all([get("Active"), get("DesktopId")]);
    if (active !== true) continue;
    const appId = typeof id === "string" && id ? id : undefined;
    uses.push({
      kind: "location",
      key: `location:${appId ?? path}`,
      app: appId ? prettyApp(appId.split(".").pop()!) : "An app",
      appId,
      device: "GeoClue",
      via: "geoclue",
    });
  }
  return uses;
}

async function scan(signal: AbortSignal): Promise<Scan> {
  const [dump, outputs, sources, holders, location] = await Promise.all([
    tryRun("pw-dump", [], signal),
    tryRun("pactl", ["-f", "json", "list", "source-outputs"], signal),
    tryRun("pactl", ["-f", "json", "list", "sources"], signal),
    cameraHolders(signal),
    geoclue(signal),
  ]);
  const pids = [...new Set(holders.flatMap((h) => h.pids))];
  const pw = dump ? parsePwDump(dump) : [];
  const pulse = outputs ? parseSourceOutputs(outputs, sources ?? "[]") : [];
  // Ask ps about every pid we know of, for names and start times.
  const allPids = [...new Set([...pids, ...pw.map((u) => u.pid), ...pulse.map((u) => u.pid)])].filter((
    p,
  ): p is number => !!p);
  const procs = parsePs(
    allPids.length
      ? await tryRun("ps", ["-o", "pid=,etimes=,user=,comm=,args=", "-p", allPids.join(",")], signal) ?? ""
      : "",
  );
  const direct = deviceUses(holders, procs);
  // PulseAudio first for the microphone: it knows the stream and source to mute.
  const uses = mergeUses(pulse, pw, direct, location);
  // The camera held only by PipeWire with no app found: still in use.
  const pwHeld = holders.filter((h) => h.pids.some((p) => procs.get(p)?.comm === "pipewire"));
  if (!uses.some((u) => u.kind === "camera") && pwHeld.length && !dump) {
    uses.push({
      kind: "camera",
      key: "camera:pipewire",
      app: "An app (through PipeWire)",
      device: pwHeld[0].device,
      via: "device",
    });
  }
  return {
    uses,
    procs,
    pipewire: !!dump,
    pulse: !!outputs,
    cameras: holders.map((h) => h.device),
  };
}

// --- "In use since" --------------------------------------------------------------

const SEEN_KEY = "first-seen";
let seen: Record<string, number> | undefined;

async function firstSeen(uses: Use[]): Promise<Record<string, number>> {
  seen ??= (await storage.get<Record<string, number>>(SEEN_KEY).catch(() => undefined)) ?? {};
  const now = Date.now();
  const next: Record<string, number> = {};
  for (const u of uses) next[u.key] = seen[u.key] ?? now;
  const changed = Object.keys(next).length !== Object.keys(seen).length ||
    Object.keys(next).some((k) => seen![k] !== next[k]);
  seen = next;
  if (changed) storage.set(SEEN_KEY, next).catch(() => {});
  return next;
}

// --- Settings ----------------------------------------------------------------------

function launch(program: string, args: string[] = []): boolean {
  try {
    new Deno.Command(program, { args, stdin: "null", stdout: "null", stderr: "null" }).spawn().unref();
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound || err instanceof Deno.errors.NotCapable) return false;
    throw err;
  }
}

const GNOME_PANEL: Record<Kind, string> = {
  camera: "camera",
  microphone: "microphone",
  screen: "sharing",
  location: "location",
};

function settings(kind: Kind): Action {
  return action(`Open ${kind === "screen" ? "Sharing" : KIND_TITLE[kind]} Settings`, () => {
    const tries: [string, string[]][] = DESKTOP.includes("kde")
      ? [["systemsettings", [kind === "microphone" ? "kcm_pulseaudio" : "kcm_app-permissions"]]]
      : [["gnome-control-center", [GNOME_PANEL[kind]]], ["gnome-control-center", ["privacy"]]];
    if (kind === "microphone") tries.push(["pavucontrol", ["--tab=2"]]);
    for (const [program, args] of tries) if (launch(program, args)) return close();
    throw new Error("No settings app found (GNOME Settings, KDE System Settings or pavucontrol)");
  }, { icon: Icons.settings, shortcut: "<Ctrl>," });
}

// --- Items -------------------------------------------------------------------------

const KIND_ICON: Record<Kind, string> = {
  camera: Icons.camera,
  microphone: Icons.mic,
  screen: Icons.monitor,
  location: Icons.pin,
};
const KIND_COLOR: Record<Kind, Color> = { camera: "green", microphone: "orange", screen: "blue", location: "purple" };

function useItem(u: Use, procs: Map<number, Proc>, firstAt: number): Item {
  const p = u.pid ? procs.get(u.pid) : undefined;
  const forMs = Date.now() - firstAt;
  const color: Color = u.paused ? "gray" : KIND_COLOR[u.kind];
  const kill = (signal: "TERM" | "KILL", title: string, options: Record<string, unknown>) =>
    action(title, async () => {
      await exec("kill", [`-${signal}`, String(u.pid)]);
      await toast(`${signal === "TERM" ? "Asked" : "Forced"} ${u.app} to quit`, { style: "success" });
    }, { destructive: true, section: "App", ...options });
  const actions: Action[] = [];
  if (u.kind === "microphone" && u.sourceName) {
    actions.push(action(u.sourceMuted ? "Unmute Microphone" : "Mute Microphone", async () => {
      await exec("pactl", ["set-source-mute", u.sourceName!, u.sourceMuted ? "0" : "1"]);
      await toast(u.sourceMuted ? "Microphone unmuted" : "Microphone muted for every app", { style: "success" });
    }, { icon: u.sourceMuted ? Icons.mic : Icons.speakerOff, shortcut: "<Ctrl>m" }));
  }
  if (u.kind === "microphone" && u.streamIndex !== undefined) {
    actions.push(action(u.streamMuted ? `Unmute for ${u.app}` : `Mute for ${u.app} Only`, async () => {
      await exec("pactl", ["set-source-output-mute", String(u.streamIndex), u.streamMuted ? "0" : "1"]);
      await toast(`${u.app} ${u.streamMuted ? "hears you again" : "no longer hears you"}`, { style: "success" });
    }, { icon: Icons.speakerOff }));
  }
  if (u.pid) {
    actions.push(
      kill("TERM", `Quit ${u.app}`, {
        icon: Icons.stop,
        confirm: `Quit ${u.app} (pid ${u.pid})? Unsaved work may be lost.`,
        shortcut: "<Ctrl>k",
      }),
      kill("KILL", "Force Quit", { icon: Icons.cross, confirm: `Kill ${u.app} right away?` }),
    );
  }
  actions.push(settings(u.kind));
  if (u.pid) actions.push(copy(String(u.pid), "Copy PID", { section: "Copy" }));
  if (p?.args) actions.push(copy(p.args, "Copy Command Line", { section: "Copy" }));

  const metadata: Metadata[] = [
    meta.text("App", u.app, { icon: KIND_ICON[u.kind] }),
    ...(u.appId ? [meta.text("App ID", u.appId)] : []),
    ...(u.device ? [meta.text(u.kind === "screen" ? "Stream" : "Device", u.device, { icon: Icons.plug })] : []),
    meta.text("Status", u.paused ? "Paused" : "In use", { color }),
    meta.text("In use for", `${forMs < 60_000 ? "Just now" : since(forMs / 1000)} (since ${clock(firstAt)})`, {
      icon: Icons.clock,
    }),
    meta.separator(),
    ...(u.pid ? [meta.text("PID", u.pid)] : []),
    ...(p
      ? [meta.text("Program", p.comm, { icon: Icons.terminal })]
      : u.binary
      ? [meta.text("Program", u.binary)]
      : []),
    ...(p ? [meta.text("Running for", since(p.elapsed))] : []),
    ...(p ? [meta.person("User", p.user)] : []),
    ...(u.kind === "microphone" && u.sourceMuted !== undefined
      ? [meta.text("Microphone", u.sourceMuted ? "Muted" : "Live", { color: u.sourceMuted ? "gray" : "orange" })]
      : []),
    meta.text(
      "Found with",
      { pipewire: "PipeWire", pulse: "PulseAudio", device: "Device files", geoclue: "GeoClue" }[u.via],
    ),
  ];
  return {
    id: u.key,
    title: u.app,
    subtitle: u.device,
    icon: { source: KIND_ICON[u.kind], tint: color },
    section: KIND_TITLE[u.kind],
    keywords: [u.binary ?? "", u.appId ?? "", String(u.pid ?? ""), u.kind],
    accessories: [
      ...(u.kind === "microphone" && u.sourceMuted ? [{ icon: Icons.speakerOff, tooltip: "Microphone muted" }] : []),
      {
        text: forMs < 60_000 ? "just now" : since(forMs / 1000),
        icon: Icons.clock,
        tooltip: `Since ${clock(firstAt)}`,
      },
      u.paused ? { tag: "Paused", color: "gray" } : { tag: u.kind === "screen" ? "Sharing" : "In use", color },
    ],
    detail: {
      markdown: p?.args ? "```\n" + (p.args.length > 400 ? p.args.slice(0, 400) + "…" : p.args) + "\n```" : undefined,
      metadata,
    },
    actions,
  };
}

function idleItem(kind: Kind, note?: { title: string; text: string }): Item {
  return {
    id: `idle:${kind}`,
    title: note?.title ?? "Not in use",
    subtitle: note?.text,
    icon: { source: note ? Icons.question : KIND_ICON[kind], tint: "gray" },
    section: KIND_TITLE[kind],
    keywords: [kind],
    accessories: note ? [] : [{ icon: Icons.check, tooltip: "Nothing is using it" }],
    detail: {
      markdown: note ? note.text : `No app is using the ${KIND_TITLE[kind].toLowerCase()} right now.`,
    },
    actions: [settings(kind)],
  };
}

let summary = "";

export default list({
  placeholder: "Filter apps…",
  status: () => summary,
  // Checked every 3 s while open.
  async *items({ signal }) {
    let last = "";
    let lastSubtitle: string | null | undefined;
    while (!signal.aborted) {
      const s = await scan(signal);
      if (signal.aborted) return;
      const firsts = await firstSeen(s.uses);
      const text = subtitle(s.uses);
      if (text !== lastSubtitle) {
        lastSubtitle = text;
        updateCommandMetadata({ subtitle: text }).catch(() => {});
      }
      summary = text ?? "Nothing is watching or listening";
      const items: Item[] = [];
      const notes: Record<Kind, { title: string; text: string } | undefined> = {
        camera: s.cameras.length === 0 ? { title: "No camera", text: "No video device is connected" } : undefined,
        microphone: !s.pulse && !s.pipewire
          ? {
            title: "Can't check",
            text: "Install pipewire-pulse or pulseaudio-utils (pactl), or PipeWire's pw-dump, to see who records",
          }
          : undefined,
        screen: !s.pipewire
          ? { title: "Can't check", text: "Screen sharing is seen through PipeWire: pw-dump isn't available" }
          : undefined,
        location: undefined,
      };
      for (const kind of ["camera", "microphone", "screen", "location"] as Kind[]) {
        const mine = s.uses.filter((u) => u.kind === kind).sort((a, b) => Number(a.paused) - Number(b.paused));
        if (mine.length) items.push(...mine.map((u) => useItem(u, s.procs, firsts[u.key] ?? Date.now())));
        else items.push(idleItem(kind, notes[kind]));
      }
      const key = JSON.stringify(items.map((i) => [i.id, i.subtitle, i.accessories, i.actions?.map((a) => a.title)]));
      if (key !== last) {
        last = key;
        yield items;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  },
});
