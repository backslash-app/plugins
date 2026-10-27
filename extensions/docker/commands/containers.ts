import { action, copy, detail, exec, type Item, list, refresh } from "@backslash/api";

interface Container {
  ID: string;
  Image: string;
  Names: string;
  State: string;
  Status: string;
  Ports?: string;
}

/** Docker first, Podman otherwise (same CLI). */
async function engine(): Promise<string> {
  for (const program of ["docker", "podman"]) {
    try {
      await exec(program, ["version", "--format", "{{.Client.Version}}"]);
      return program;
    } catch {
      // try the next one
    }
  }
  throw new Error("Neither Docker nor Podman is available");
}

function item(cli: string, c: Container): Item {
  const running = c.State === "running";
  const run = (verb: string) => async () => {
    await exec(cli, [verb, c.ID]);
    return refresh();
  };
  return {
    id: c.ID,
    title: c.Names,
    subtitle: c.Image,
    icon: "utilities-terminal",
    section: running ? "Running" : "Stopped",
    keywords: [c.ID, c.Image],
    accessories: [{ text: c.Status }, { tag: c.State, color: running ? "green" : "gray" }],
    actions: [
      action("Show Logs", async () => {
        const logs = await exec(cli, ["logs", "--tail", "100", c.ID]).catch((e) => e.message);
        return detail({
          title: c.Names,
          markdown: `# ${c.Names}\n\n\`\`\`\n${logs || "No logs."}\n\`\`\``,
          metadata: { Image: c.Image, Status: c.Status, Ports: c.Ports || "—", ID: c.ID },
        });
      }),
      running
        ? action("Stop", run("stop"), { shortcut: "<Ctrl>s" })
        : action("Start", run("start"), { shortcut: "<Ctrl>s" }),
      action("Restart", run("restart"), { shortcut: "<Ctrl>r" }),
      copy(`${cli} exec -it ${c.Names} sh`, "Copy Shell Command"),
      copy(c.ID, "Copy ID"),
      action("Remove", run("rm"), { destructive: true, confirm: `Remove ${c.Names}?` }),
    ],
  };
}

export default list({
  placeholder: "Filter containers…",
  empty: { title: "No containers", description: "Nothing created yet" },
  items: async () => {
    const cli = await engine();
    const out = await exec(cli, ["ps", "-a", "--format", "{{json .}}"]);
    const containers = out.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Container)
      // Podman prints `Names` as an array.
      .map((c) => ({ ...c, Names: Array.isArray(c.Names) ? c.Names.join(", ") : c.Names }));
    return containers.sort((a, b) => Number(b.State === "running") - Number(a.State === "running")).map((c) =>
      item(cli, c)
    );
  },
});
