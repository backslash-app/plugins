import {
  type Action,
  action,
  close,
  type Context,
  copy,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  open,
  openExternal,
  refresh,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  connection,
  expandPath,
  explainCupsError,
  installCups,
  type Job,
  looksLikePath,
  lpstatProblem,
  osFamily,
  parseJobs,
  parseLpq,
  parseLpstat,
  prettyName,
  type Printer,
  size,
  type Status,
} from "../lib.ts";

const HOME = Deno.env.get("HOME") ?? "";
const DESKTOP = (Deno.env.get("XDG_CURRENT_DESKTOP") ?? "").toLowerCase();
const CUPS = "http://localhost:631";
const TEST_PAGE = "/usr/share/cups/data/testprint";

class NotInstalled extends Error {}

/** Runs a CUPS tool in the C locale (its messages are translated otherwise). */
async function cups(program: string, args: string[], signal?: AbortSignal): Promise<string> {
  let res: Deno.CommandOutput;
  try {
    res = await new Deno.Command(program, {
      args,
      env: { LC_ALL: "C" },
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal,
    }).output();
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) throw new NotInstalled(program);
    throw err;
  }
  const dec = new TextDecoder();
  const out = dec.decode(res.stdout);
  if (res.code !== 0) {
    throw new Error(`${program} exited with ${res.code}: ${dec.decode(res.stderr).trim() || out.trim()}`);
  }
  return out;
}

/** Like {@link cups}, with errors explained. */
async function admin(program: string, args: string[]): Promise<string> {
  try {
    return await cups(program, args);
  } catch (err) {
    if (err instanceof NotInstalled) throw new Error(`${program} was not found: install the CUPS client tools`);
    throw new Error(explainCupsError(String((err as Error).message)));
  }
}

async function status(signal: AbortSignal): Promise<Status & { jobs: Job[] }> {
  const p = await cups("lpstat", ["-l", "-p", "-d"], signal);
  const [a, v, o, q] = await Promise.all([
    cups("lpstat", ["-a"], signal).catch(() => ""),
    cups("lpstat", ["-v"], signal).catch(() => ""),
    cups("lpstat", ["-o"], signal).catch(() => ""),
    // lpq (cups-bsd) knows the file names; optional.
    cups("lpq", ["-a"], signal).catch(() => ""),
  ]);
  const st = parseLpstat(p, a, v);
  const titles = parseLpq(q);
  const jobs = parseJobs(o).map((j) => ({ ...j, ...titles.get(j.number) }));
  return { ...st, jobs };
}

/** Starts a desktop program that outlives the command; false when it is not installed. */
function launch(program: string, args: string[] = []): boolean {
  try {
    new Deno.Command(program, { args, stdin: "null", stdout: "null", stderr: "null" }).spawn().unref();
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound || err instanceof Deno.errors.NotCapable) return false;
    throw err;
  }
}

const settingsAction = action("Open Printer Settings", async () => {
  const candidates: [string, string[]][] = DESKTOP.includes("kde")
    ? [["systemsettings", ["kcm_printer_manager"]], ["system-config-printer", []]]
    : [["gnome-control-center", ["printers"]], ["system-config-printer", []], ["systemsettings", [
      "kcm_printer_manager",
    ]]];
  for (const [program, args] of candidates) if (launch(program, args)) return close();
  // No settings app: the CUPS web page does everything.
  await openExternal(`${CUPS}/printers/`);
  return close();
}, { icon: Icons.settings, shortcut: "<Ctrl>," });

const webAction = open(`${CUPS}/printers/`, "Open CUPS Web Page", { icon: Icons.globe, shortcut: "<Ctrl>w" });

// --- Printing a file -------------------------------------------------------------

async function printFile(path: string, printer: string | undefined, options: string[] = []): Promise<string> {
  if (!path.startsWith("/")) throw new Error(`Use an absolute path, e.g. ~/Documents/${path.split("/").pop()}`);
  const out = await admin("lp", [...(printer ? ["-d", printer] : []), ...options, path]);
  return out.match(/request id is (\S+)/)?.[1] ?? "";
}

function printForm(path: string, printers: Printer[], defaultName?: string) {
  return form({
    title: "Print File",
    submitTitle: "Print",
    fields: [
      field.text("path", "File", { required: true, value: path, placeholder: "~/Documents/report.pdf" }),
      field.dropdown(
        "printer",
        "Printer",
        printers.map((p) => ({
          value: p.name,
          title: `${p.description ?? prettyName(p.name)}${p.isDefault ? " (default)" : ""}`,
        })),
        { value: defaultName ?? printers[0]?.name },
      ),
      field.text("copies", "Copies", { value: "1" }),
      field.checkbox("duplex", "Two-sided"),
      field.checkbox("gray", "Black and white"),
    ],
    async submit(values) {
      const file = expandPath(String(values.path), HOME);
      const copies = Math.max(1, Math.min(99, Number(values.copies) || 1));
      const id = await printFile(file, String(values.printer) || undefined, [
        "-n",
        String(copies),
        ...(values.duplex ? ["-o", "sides=two-sided-long-edge"] : []),
        ...(values.gray ? ["-o", "print-color-mode=monochrome"] : []),
      ]);
      return close(`Sent to ${prettyName(String(values.printer))}${id ? ` (${id})` : ""}`);
    },
  });
}

function printFileItem(query: string, st: Status): Item {
  const file = expandPath(query, HOME);
  const name = file.split("/").pop() ?? file;
  const target = st.printers.find((p) => p.isDefault) ?? st.printers[0];
  const on = (p: Printer, options = {}) =>
    action(p.description ?? prettyName(p.name), async () => {
      const id = await printFile(file, p.name);
      return close(`Printing ${name} on ${prettyName(p.name)}${id ? ` (${id})` : ""}`);
    }, { icon: Icons.printer, ...options });
  return {
    id: "print-file",
    title: `Print ${name}`,
    subtitle: target ? `on ${target.description ?? prettyName(target.name)}` : undefined,
    icon: { source: Icons.printer, tint: "blue" },
    section: "Print",
    keywords: [query, file],
    detail: {
      metadata: [
        meta.text("File", file, { icon: Icons.file }),
        ...(target
          ? [meta.text("Printer", target.description ?? prettyName(target.name), { icon: Icons.printer })]
          : []),
      ],
    },
    actions: [
      ...(target ? [on(target)] : []),
      submenu("Print On", st.printers.map((p) => on(p)), { icon: Icons.printer }),
      action("Print With Options…", () => printForm(query, st.printers, st.defaultName), {
        icon: Icons.settings,
        shortcut: "<Ctrl>p",
      }),
    ],
  };
}

// --- Items -----------------------------------------------------------------------

function printerItem(p: Printer, jobs: Job[], all: Printer[]): Item {
  const mine = jobs.filter((j) => j.printer === p.name);
  const paused = p.state === "disabled";
  const label = p.description ?? prettyName(p.name);
  const stateText = paused ? "Paused" : p.state === "printing" ? "Printing" : p.state === "idle" ? "Ready" : "Unknown";
  const color = paused ? "orange" : p.state === "printing" ? "blue" : "green";
  const actions: Action[] = [
    open(`${CUPS}/printers/${encodeURIComponent(p.name)}`, "Open in CUPS", { icon: Icons.globe }),
    action("Print File…", () => printForm("", [p, ...all.filter((x) => x !== p)], p.name), {
      icon: Icons.file,
      shortcut: "<Ctrl>p",
    }),
    paused
      ? action("Resume Printer", async () => {
        await admin("cupsenable", [p.name]);
        await admin("cupsaccept", [p.name]).catch(() => {});
        await toast(`${prettyName(p.name)} resumed`, { style: "success" });
        return refresh();
      }, { icon: Icons.play, shortcut: "<Ctrl>r", section: "Printer" })
      : action("Pause Printer", async () => {
        await admin("cupsdisable", [p.name]);
        await toast(`${prettyName(p.name)} paused`, { style: "success" });
        return refresh();
      }, { icon: Icons.pause, shortcut: "<Ctrl>r", section: "Printer" }),
    ...(!p.isDefault
      ? [action("Set as Default", async () => {
        await admin("lpoptions", ["-d", p.name]);
        await toast(`${prettyName(p.name)} is your default printer`, { style: "success" });
        return refresh();
      }, { icon: Icons.star, shortcut: "<Ctrl>d", section: "Printer" })]
      : []),
    action("Print Test Page", async () => {
      const id = await printFile(TEST_PAGE, p.name);
      await toast(`Test page sent${id ? ` (${id})` : ""}`, { style: "success" });
      return refresh();
    }, { icon: Icons.check, section: "Printer" }),
    ...(mine.length
      ? [action(`Cancel All Jobs (${mine.length})`, async () => {
        await admin("cancel", ["-a", p.name]);
        await toast(`Queue of ${prettyName(p.name)} cleared`, { style: "success" });
        return refresh();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Cancel all ${mine.length} job${mine.length === 1 ? "" : "s"} on ${prettyName(p.name)}?`,
        section: "Danger",
      })]
      : []),
    copy(p.name, "Copy Queue Name", { section: "Copy" }),
    ...(p.device ? [copy(p.device, "Copy Device URI", { section: "Copy" })] : []),
    settingsAction,
  ];
  return {
    id: `printer:${p.name}`,
    title: label,
    subtitle: p.location ?? (label !== prettyName(p.name) ? p.name : undefined),
    icon: { source: Icons.printer, tint: color },
    section: "Printers",
    keywords: [p.name, p.location ?? "", p.device ?? "", stateText],
    accessories: [
      ...(p.isDefault ? [{ icon: Icons.starFilled, tooltip: "Default printer", color: "yellow" as const }] : []),
      ...(mine.length ? [{ text: `${mine.length} job${mine.length === 1 ? "" : "s"}`, icon: Icons.inbox }] : []),
      ...(!p.accepting ? [{ tag: "Rejecting jobs", color: "red" as const }] : []),
      { tag: stateText, color },
    ],
    detail: {
      stats: [
        { label: "State", value: stateText, color },
        { label: "Queued", value: mine.length },
      ],
      markdown: [
        p.message ? `> ${p.message}` : "",
        paused
          ? "Paused printers keep their queue. Resuming needs printer admin rights: if it's refused, " +
            "add yourself to the `lpadmin` group or use the CUPS web page."
          : "",
      ].filter(Boolean).join("\n\n") || undefined,
      metadata: [
        meta.text("Queue", p.name, { icon: Icons.printer }),
        ...(p.isDefault ? [meta.text("Default", "Yes", { icon: Icons.starFilled, color: "yellow" })] : []),
        meta.text("Accepting jobs", p.accepting ? "Yes" : "No", { color: p.accepting ? undefined : "red" }),
        ...(p.job ? [meta.text("Printing", p.job)] : []),
        ...(p.alerts ? [meta.text("Alerts", p.alerts, { icon: Icons.alert, color: "orange" })] : []),
        meta.separator(),
        ...(p.location ? [meta.text("Location", p.location, { icon: Icons.pin })] : []),
        ...(connection(p.device) ? [meta.text("Connection", connection(p.device)!, { icon: Icons.plug })] : []),
        ...(p.since ? [meta.text(paused ? "Paused since" : "Since", p.since, { icon: Icons.clock })] : []),
        meta.link("CUPS", "localhost:631", `${CUPS}/printers/${encodeURIComponent(p.name)}`),
      ],
    },
    actions,
  };
}

function jobItem(j: Job & { rank?: string; title?: string }, printers: Printer[]): Item {
  const printer = printers.find((p) => p.name === j.printer);
  const active = j.rank === "active" || printer?.job === j.id;
  return {
    id: `job:${j.id}`,
    title: j.title ?? `Job ${j.number}`,
    subtitle: printer?.description ?? prettyName(j.printer),
    icon: { source: active ? Icons.inProgress : Icons.hourglass, tint: active ? "blue" : "gray" },
    section: "Queue",
    keywords: [j.id, j.user, j.printer],
    accessories: [
      { text: size(j.size), tooltip: "Size" },
      { avatar: j.user, tooltip: j.user },
      active ? { tag: "Printing", color: "blue" } : { tag: j.rank ?? "Waiting", color: "gray" },
    ],
    detail: {
      metadata: [
        meta.text("Job", j.id, { icon: Icons.hash }),
        ...(j.title ? [meta.text("Document", j.title, { icon: Icons.file })] : []),
        meta.text("Printer", printer?.description ?? prettyName(j.printer), { icon: Icons.printer }),
        meta.person("Owner", j.user),
        meta.text("Size", size(j.size)),
        meta.text("Submitted", j.date, { icon: Icons.clock }),
        meta.text("Status", active ? "Printing" : j.rank ? `In queue (${j.rank})` : "In queue"),
      ],
    },
    actions: [
      action("Cancel Job", async () => {
        await admin("cancel", [j.id]);
        await toast(`Job ${j.id} cancelled`, { style: "success" });
        return refresh();
      }, { icon: Icons.cross, destructive: true, confirm: `Cancel ${j.title ?? `job ${j.id}`}?` }),
      open(`${CUPS}/jobs/`, "Open Jobs in CUPS", { icon: Icons.globe }),
      copy(j.id, "Copy Job ID", { section: "Copy" }),
    ],
  };
}

async function setupItems(kind: "missing" | "no-scheduler"): Promise<Item[]> {
  const os = await Deno.readTextFile("/etc/os-release").catch(() => "");
  const family = osFamily(os);
  if (kind === "no-scheduler") {
    const cmd = "sudo systemctl enable --now cups";
    return [{
      id: "no-scheduler",
      title: "The printing service isn't running",
      subtitle: "Start CUPS to see your printers",
      icon: { source: Icons.alert, tint: "orange" },
      detail: {
        markdown:
          `CUPS is installed but its service (cupsd) is stopped. Start it, and at every boot:\n\n\`\`\`\n${cmd}\n\`\`\``,
      },
      actions: [copy(cmd, "Copy Command")],
    }];
  }
  const commands = installCups(family);
  return [{
    id: "no-cups",
    title: "CUPS isn't installed",
    subtitle: "Linux prints through CUPS: install it to add printers",
    icon: { source: Icons.printer, tint: "gray" },
    detail: {
      markdown: [
        "Printers on Linux are managed by **CUPS**. Install it, start its service, then add a printer from the settings or the CUPS web page (http://localhost:631).",
        "",
        ...commands.flatMap((c) => [family ? "" : `**${c.family}**`, "```", c.command, "```"]),
      ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n"),
    },
    actions: [
      copy(commands[0].command, "Copy Install Command"),
      open("https://www.cups.org", "Open cups.org", { icon: Icons.globe }),
    ],
  }];
}

const noPrinters: Item = {
  id: "no-printers",
  title: "No printers yet",
  subtitle: "Add one in the settings or on the CUPS web page",
  icon: { source: Icons.printer, tint: "gray" },
  detail: {
    markdown:
      "Network printers are usually found by themselves (IPP Everywhere). If yours isn't, add it from the printer settings or at http://localhost:631/admin.",
  },
  actions: [settingsAction, open(`${CUPS}/admin`, "Add Printer in CUPS", { icon: Icons.plus })],
};

let summary = "";

export default (ctx: Context) =>
  list({
    placeholder: "Filter printers and jobs, or type a file path to print…",
    actions: [webAction, settingsAction],
    status: () => summary,
    // Refreshed every 4 s while open: the queue moves as pages come out.
    async *items({ signal }) {
      let last = "";
      while (!signal.aborted) {
        let items: Item[];
        try {
          const st = await status(signal);
          const queued = st.jobs.length;
          summary = `${st.printers.length} printer${st.printers.length === 1 ? "" : "s"}${
            queued ? ` · ${queued} job${queued === 1 ? "" : "s"} queued` : ""
          }${st.defaultName ? ` · default ${prettyName(st.defaultName)}` : ""}`;
          updateCommandMetadata({ subtitle: queued ? `${queued} job${queued === 1 ? "" : "s"} queued` : null })
            .catch(() => {});
          items = st.printers.length === 0 ? [noPrinters] : [
            ...(looksLikePath(ctx.query) ? [printFileItem(ctx.query, st)] : []),
            ...st.printers.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
              .map((p) => printerItem(p, st.jobs, st.printers)),
            ...st.jobs.map((j) => jobItem(j, st.printers)),
          ];
        } catch (err) {
          if (signal.aborted) return;
          if (err instanceof NotInstalled) items = await setupItems("missing");
          else {
            const problem = lpstatProblem(String((err as Error).message));
            if (problem === "no-scheduler") items = await setupItems("no-scheduler");
            else if (problem === "no-printers") items = [noPrinters];
            else throw err;
          }
          summary = "";
          const key = JSON.stringify(items.map((i) => i.id));
          if (key !== last) yield items;
          return;
        }
        const key = JSON.stringify(items.map((i) => [i.id, i.title, i.accessories, i.detail?.stats]));
        if (key !== last) {
          last = key;
          yield items;
        }
        await new Promise((r) => setTimeout(r, 4000));
      }
    },
  });
