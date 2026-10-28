import {
  type Action,
  action,
  close,
  copy,
  exec,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  refresh,
  submenu,
  updateCommandMetadata,
} from "@backslash/api";
import {
  attachCommand,
  type Backend,
  invalidName,
  killCommand,
  longDate,
  newSessionCommand,
  parseTmuxSessions,
  parseZellijSessions,
  renameCommand,
  type Session,
  short,
  sortSessions,
  TMUX_SESSION_FORMAT,
  TMUX_WINDOW_FORMAT,
} from "../lib.ts";
import { runInTerminal, shellLine } from "../terminal.ts";

interface Prefs {
  terminal?: string;
}

const HOME = Deno.env.get("HOME") ?? "";
const NAMES: Record<Backend, string> = { tmux: "tmux", zellij: "zellij" };

interface Found {
  installed: Backend[];
  sessions: Session[];
}

const missing = (err: unknown) => err instanceof Deno.errors.NotFound;

async function tmux(): Promise<Session[] | undefined> {
  try {
    const out = await exec("tmux", ["list-sessions", "-F", TMUX_SESSION_FORMAT]);
    const windows = await exec("tmux", ["list-windows", "-a", "-F", TMUX_WINDOW_FORMAT]).catch(() => "");
    return parseTmuxSessions(out, windows);
  } catch (err) {
    if (missing(err)) return undefined;
    // "no server running on /tmp/tmux-1000/default", "error connecting to …": no session yet.
    return [];
  }
}

async function zellij(): Promise<Session[] | undefined> {
  try {
    return parseZellijSessions(await exec("zellij", ["list-sessions", "--no-formatting"]));
  } catch (err) {
    if (missing(err)) return undefined;
    return []; // "No active zellij sessions found."
  }
}

async function load(): Promise<Found> {
  const [t, z] = await Promise.all([tmux(), zellij()]);
  return {
    installed: [...(t ? ["tmux" as const] : []), ...(z ? ["zellij" as const] : [])],
    sessions: sortSessions([...(t ?? []), ...(z ?? [])]),
  };
}

const expandHome = (dir: string) => dir.trim().replace(/^~(?=\/|$)/, HOME);
const tilde = (path: string) => (HOME && path.startsWith(HOME) ? `~${path.slice(HOME.length)}` : path);

function newSessionForm(found: Found, prefs: Prefs, backend?: Backend) {
  const existing = found.sessions.map((s) => s.name);
  let n = 1;
  while (existing.includes(`session-${n}`)) n++;
  return form({
    title: "New Terminal Session",
    submitTitle: "Create Session",
    fields: [
      field.text("name", "Name", { required: true, value: `session-${n}`, placeholder: "work" }),
      ...(found.installed.length > 1
        ? [field.dropdown("backend", "Multiplexer", found.installed.map((b) => ({ value: b, title: NAMES[b] })), {
          value: backend ?? found.installed[0],
        })]
        : []),
      field.text("dir", "Start directory", { placeholder: "~ (home folder)" }),
      field.checkbox("attach", "Attach in a terminal now", { value: true }),
    ],
    async submit(values) {
      const name = String(values.name).trim();
      const error = invalidName(name, existing);
      if (error) throw new Error(error);
      const chosen = (values.backend as Backend | undefined) ?? found.installed[0];
      const dir = expandHome(String(values.dir ?? "")) || undefined;
      if (values.attach) {
        runInTerminal(
          newSessionCommand(chosen, name, false, dir),
          prefs.terminal || undefined,
          dir ?? (HOME || undefined),
        );
        return close();
      }
      if (chosen === "zellij") {
        // zellij starts in the directory it is launched from.
        await new Deno.Command("zellij", { args: newSessionCommand(chosen, name, true).slice(1), cwd: dir }).output();
      } else {
        await exec("tmux", newSessionCommand(chosen, name, true, dir).slice(1));
      }
      return close(`Session “${name}” created`);
    },
  });
}

function renameForm(s: Session, found: Found) {
  return form({
    title: `Rename “${s.name}”`,
    submitTitle: "Rename",
    fields: [field.text("name", "New name", { required: true, value: s.name })],
    async submit(values) {
      const name = String(values.name).trim();
      if (name === s.name) return close();
      const error = invalidName(name, found.sessions.filter((x) => x.backend === s.backend).map((x) => x.name));
      if (error) throw new Error(error);
      const [program, ...args] = renameCommand(s, name);
      await exec(program, args);
      return close(`Renamed to “${name}”`);
    },
  });
}

function statusOf(s: Session): { text: string; color: "green" | "blue" | "gray" | "teal" } {
  if (s.exited) return { text: "Exited", color: "gray" };
  if (s.current) return { text: "Current", color: "teal" };
  if (s.attached) return { text: s.attached > 1 ? `Attached (${s.attached} clients)` : "Attached", color: "green" };
  return { text: "Detached", color: "blue" };
}

function metadata(s: Session): Metadata[] {
  const st = statusOf(s);
  const panes = s.windowList.reduce((n, w) => n + w.panes, 0);
  return [
    meta.text("Status", st.text, { icon: Icons.dot, color: st.color }),
    meta.text("Multiplexer", NAMES[s.backend], { icon: Icons.terminal }),
    ...(s.windows !== undefined
      ? [meta.text("Windows", panes ? `${s.windows} (${panes} pane${panes === 1 ? "" : "s"})` : s.windows)]
      : []),
    ...(s.path ? [meta.text("Directory", tilde(s.path), { icon: Icons.folder })] : []),
    ...(s.group ? [meta.text("Group", s.group, { icon: Icons.layers })] : []),
    meta.separator(),
    ...(s.created ? [meta.text("Created", longDate(s.created), { icon: Icons.calendar })] : []),
    ...(s.activity ? [meta.text("Last activity", longDate(s.activity), { icon: Icons.clock })] : []),
  ];
}

function windowsMarkdown(s: Session): string | undefined {
  if (s.backend === "zellij") {
    return s.exited ? "This session has exited. Attaching resurrects it with its layout." : undefined;
  }
  if (!s.windowList.length) return undefined;
  const lines = s.windowList.map((w) => {
    const what = [
      w.command ? `\`${w.command}\`` : "",
      w.panes > 1 ? `${w.panes} panes` : "",
      w.path ? tilde(w.path) : "",
    ]
      .filter(Boolean).join(" · ");
    return `- **${w.index}: ${w.name.replace(/[*_`]/g, "")}**${w.active ? " (active)" : ""}${what ? ` · ${what}` : ""}`;
  });
  return `### Windows\n\n${lines.join("\n")}`;
}

function item(s: Session, found: Found, prefs: Prefs): Item {
  const st = statusOf(s);
  const term = prefs.terminal || undefined;
  const attach = (title: string, window?: number) =>
    action(title, () => {
      runInTerminal(attachCommand(s, window), term, HOME || undefined);
      return close();
    }, { icon: Icons.terminal });
  const run = (argv: string[]) => async () => {
    await exec(argv[0], argv.slice(1));
    return refresh();
  };
  const actions: Action[] = [attach(s.exited ? "Resurrect in Terminal" : "Attach in Terminal")];
  if (s.windowList.length > 1) {
    actions.push(submenu(
      "Attach to Window",
      s.windowList.map((w) =>
        action(`${w.index}: ${w.name}`, () => {
          runInTerminal(attachCommand(s, w.index), term, HOME || undefined);
          return close();
        }, { icon: w.active ? Icons.check : Icons.window })
      ),
      { icon: Icons.window, shortcut: "<Ctrl>w" },
    ));
  }
  if (s.backend === "tmux" && s.attached) {
    actions.push(action("Detach Clients", run(["tmux", "detach-client", "-s", `=${s.name}`]), {
      icon: Icons.eyeOff,
      shortcut: "<Ctrl>d",
    }));
  }
  actions.push(
    action("New Session", () => newSessionForm(found, prefs, s.backend), {
      icon: Icons.plus,
      shortcut: "<Ctrl>n",
      section: "Session",
    }),
    ...(s.exited ? [] : [action("Rename Session", () => renameForm(s, found), {
      icon: Icons.text,
      shortcut: "F2",
      section: "Session",
    })]),
    copy(shellLine(attachCommand(s)), "Copy Attach Command", {
      icon: Icons.terminal,
      shortcut: "<Ctrl><Shift>c",
      section: "Copy",
    }),
    copy(s.name, "Copy Session Name", { section: "Copy" }),
    action(s.exited ? "Delete Session" : "Kill Session", run(killCommand(s)), {
      icon: Icons.trash,
      destructive: true,
      shortcut: "<Ctrl><Shift>Delete",
      confirm: s.attached || s.current
        ? `Kill “${s.name}”? It is attached: its programs will be closed.`
        : `Kill “${s.name}” and everything running in it?`,
      section: "Danger",
    }),
  );
  return {
    id: `${s.backend}:${s.name}`,
    title: s.name,
    subtitle: s.path ? tilde(s.path) : undefined,
    icon: { source: Icons.terminal, tint: st.color },
    section: NAMES[s.backend],
    keywords: [s.backend, ...s.windowList.flatMap((w) => [w.name, w.command ?? ""])],
    accessories: [
      ...(s.windows !== undefined
        ? [{ icon: Icons.window, text: String(s.windows), tooltip: `${s.windows} window${s.windows === 1 ? "" : "s"}` }]
        : []),
      ...(s.attached || s.current || s.exited ? [{ tag: st.text.replace(/ \(.*/, ""), color: st.color }] : []),
      ...(s.created
        ? [{ text: short(s.activity ?? s.created), tooltip: s.activity ? "Last activity" : "Created" }]
        : []),
    ],
    detail: {
      stats: s.backend === "tmux"
        ? [
          { label: "windows", value: s.windows ?? 0 },
          { label: "panes", value: s.windowList.reduce((n, w) => n + w.panes, 0) },
          { label: "clients", value: s.attached, color: s.attached ? "green" : undefined },
        ]
        : undefined,
      markdown: windowsMarkdown(s),
      metadata: metadata(s),
    },
    actions,
  };
}

let summary = "";

export default list({
  placeholder: "Filter tmux and zellij sessions…",
  empty: {
    title: "No terminal sessions",
    description: "Press Ctrl+N to start one. Sessions keep running when you close the terminal.",
    icon: Icons.terminal,
  },
  status: () => summary,
  async items({ preferences }) {
    const prefs = preferences as Prefs;
    const found = await load();
    if (!found.installed.length) {
      summary = "";
      return [{
        id: "missing",
        title: "Neither tmux nor zellij is installed",
        subtitle: "Install one of them with your package manager",
        icon: { source: Icons.alert, tint: "orange" },
        detail: {
          markdown:
            "Terminal Sessions lists the sessions of **tmux** and **zellij**, terminal multiplexers that keep your shells running in the background.\n\n```sh\nsudo apt install tmux      # Debian, Ubuntu\nsudo dnf install tmux      # Fedora\nsudo pacman -S tmux zellij # Arch\n```",
        },
        actions: [
          copy("sudo apt install tmux", "Copy apt Command", { icon: Icons.terminal }),
          copy("sudo dnf install tmux", "Copy dnf Command", { icon: Icons.terminal }),
        ],
      }];
    }
    const { sessions } = found;
    const attached = sessions.filter((s) => s.attached || s.current).length;
    summary = found.installed.map((b) => {
      const n = sessions.filter((s) => s.backend === b).length;
      return `${n} ${NAMES[b]}`;
    }).join(" · ") + ` · ${attached} attached`;
    await updateCommandMetadata({
      subtitle: sessions.length
        ? `${sessions.length} session${sessions.length === 1 ? "" : "s"}, ${attached} attached`
        : null,
    }).catch(() => {});
    const items = sessions.map((s) => item(s, found, prefs));
    // A way to create a session even when the list is empty or filtered out.
    items.push({
      id: "new",
      title: "New Session…",
      subtitle: found.installed.map((b) => NAMES[b]).join(" or "),
      icon: { source: Icons.plus, tint: "gray" },
      section: "Create",
      keywords: ["new", "create", "nouvelle"],
      actions: [action("New Session", () => newSessionForm(found, prefs), { icon: Icons.plus, shortcut: "<Ctrl>n" })],
    });
    return items;
  },
});
