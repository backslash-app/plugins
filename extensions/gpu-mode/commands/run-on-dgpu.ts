import { action, close, copy, field, form, Icons, type Item, list, storage } from "@backslash/api";
import { type App, commandLine, envPrefix } from "../lib.ts";
import { apps, launch, offload } from "../system.ts";

const RECENT = "recent";

async function recent(): Promise<string[]> {
  return (await storage.get<string[]>(RECENT).catch(() => undefined)) ?? [];
}

async function remember(id: string) {
  await storage.set(RECENT, [id, ...(await recent()).filter((r) => r !== id)].slice(0, 8)).catch(() => {});
}

const commandForm = (env: Record<string, string>) =>
  form({
    title: "Run a Command on the Discrete GPU",
    submitTitle: "Run",
    fields: [field.text("command", "Command", { placeholder: "glxgears, steam, blender…", required: true })],
    async submit(values) {
      const line = String(values.command ?? "").trim();
      if (!line) throw new Error("Type a command to run");
      await launch(line, line.split(/\s+/)[0], env);
      return close(`Started ${line.split(/\s+/)[0]} on the discrete GPU`);
    },
  });

export default list({
  placeholder: "Search apps to start on the discrete GPU…",
  empty: { title: "No application found", description: "Ctrl+N runs any command instead", icon: Icons.apps },
  async items() {
    const [found, how, last] = await Promise.all([apps(), offload(), recent()]);
    const prefix = envPrefix(how.env);
    const row = (a: App, section: string): Item => ({
      id: `${section}:${a.id}`,
      title: a.name,
      subtitle: a.comment,
      icon: a.icon ?? Icons.apps,
      section,
      keywords: [...a.keywords, a.id],
      accessories: a.prefersDgpu ? [{ tag: "Prefers discrete GPU", color: "purple" }] : [],
      detail: {
        metadata: [
          { label: "Command", value: commandLine(a.exec), icon: Icons.terminal },
          {
            label: "Discrete GPU",
            value: how.gpu ? `${how.gpu.vendor} ${how.gpu.name}` : "Not detected",
            icon: Icons.cpu,
          },
          { label: "Offload by", value: how.source, icon: Icons.settings },
          { label: "Environment", value: prefix, icon: Icons.code },
          { label: "Entry", value: a.file, icon: Icons.file },
        ],
        markdown: how.gpu ? undefined : "No discrete GPU was found: the app may start on the only GPU there is.",
      },
      actions: [
        action("Run on Discrete GPU", async () => {
          await launch(a.exec, a.name, how.env);
          await remember(a.id);
          return close(`${a.name} started on the discrete GPU`);
        }, { icon: Icons.rocket }),
        copy(`${prefix} ${commandLine(a.exec)}`, "Copy Command Line", { icon: Icons.terminal }),
        copy(`${prefix} %command%`, "Copy Steam Launch Options", { section: "Copy" }),
        action("Run a Command…", () => commandForm(how.env), { icon: Icons.terminal, shortcut: "<Ctrl>n" }),
      ],
    });
    const recents = last.map((id) => found.find((a) => a.id === id)).filter((a): a is App => !!a);
    return [
      ...recents.map((a) => row(a, "Recent")),
      ...found.filter((a) => !recents.includes(a)).map((a) => row(a, "Applications")),
    ];
  },
});
