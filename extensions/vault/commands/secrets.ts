import {
  type Action,
  action,
  clipboard,
  close,
  copy,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  paste,
  refresh,
  replace,
  storage,
  toast,
} from "@backslash/api";
import { type Cli, cli, errorItems, inTerminal, type Prefs, vault, VaultError } from "../cli.ts";
import {
  baseName,
  formatDate,
  joinPath,
  MASK,
  type Metadata,
  type Mount,
  parseList,
  parseMetadata,
  parseMounts,
  parseSecret,
  PRODUCT,
  relative,
  type Secret,
  shellQuote,
  shownValue,
  uiUrl,
  VERSION_LOOK,
  versionState,
} from "../lib.ts";

/** How far "All Secrets" walks, so a huge mount can't hang the launcher. */
const WALK_LIMIT = 2000;
const WALK_DEPTH = 12;
const WALK_CONCURRENCY = 6;

const fence = (text: string) => `\`\`\`\n${text.replace(/```/g, "ʼʼʼ")}\n\`\`\``;

async function listPath(c: Cli, path: string, signal?: AbortSignal) {
  try {
    return parseList(await vault(c, ["kv", "list", "-format=json", path], signal));
  } catch (e) {
    if (e instanceof VaultError && e.kind === "empty") return [];
    throw e;
  }
}

async function mounts(c: Cli, signal?: AbortSignal): Promise<Mount[]> {
  return parseMounts(await vault(c, ["secrets", "list", "-format=json"], signal)).kv;
}

/** `vault kv get` as the CLI would be typed, to copy. */
const getCommand = (c: Cli, path: string, field?: string) =>
  [c.program, "kv", "get", ...(field ? [`-field=${field}`] : []), shellQuote(path)].join(" ");

async function copySecretJson(c: Cli, mount: Mount, path: string) {
  const secret = parseSecret(await vault(c, ["kv", "get", "-format=json", path]), mount.version);
  if (secret.gone) throw new Error("The latest version of this secret was deleted");
  const keys = Object.keys(secret.data);
  const text = keys.length === 1 ? secret.data[keys[0]] : JSON.stringify(secret.data, null, 2);
  await clipboard.write(text, { concealed: true });
  return close(keys.length === 1 ? `Copied ${keys[0]}` : `Copied ${keys.length} keys as JSON`);
}

// ---------------------------------------------------------------------------
// Rows

function mountItem(c: Cli, m: Mount): Item {
  return {
    id: `mount:${m.path}`,
    title: m.path,
    subtitle: m.description || undefined,
    icon: { source: Icons.database, tint: "purple" },
    section: "Secrets Engines",
    keywords: ["mount", "kv", `v${m.version}`],
    accessories: [{ tag: `KV v${m.version}`, color: m.version === 2 ? "blue" : "gray" }],
    detail: {
      metadata: [
        meta.text("Path", m.path, { icon: Icons.database }),
        meta.text("Engine", `${m.type === "generic" ? "generic (KV v1)" : `KV version ${m.version}`}`),
        ...(m.description ? [meta.text("Description", m.description)] : []),
        meta.text("Accessor", m.accessor || "—"),
        meta.tags("Options", [
          ...(m.local ? [{ text: "Local", color: "gray" as const }] : []),
          ...(m.sealWrap ? [{ text: "Seal wrap", color: "purple" as const }] : []),
          { text: m.version === 2 ? "Versioned" : "Unversioned", color: m.version === 2 ? "blue" : "gray" },
        ]),
        meta.separator(),
        meta.link("Server", c.address, `${c.address}/ui/`),
      ],
    },
    actions: [
      action("Browse", () => folderView(c, m, ""), { icon: Icons.folder }),
      action("Search All Secrets in Mount", () => walkView(c, [m]), { icon: Icons.search }),
      open(uiUrl(c.address, c.program, m), `Open in ${PRODUCT[c.program]} UI`, { shortcut: "<Ctrl>o" }),
      copy(m.path, "Copy Path", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    ],
  };
}

function entryItem(c: Cli, m: Mount, path: string, section?: string): Item {
  const folder = path.endsWith("/");
  const relativePath = path.slice(m.path.length);
  const name = baseName(path);
  const ui = open(uiUrl(c.address, c.program, m, relativePath, folder), `Open in ${PRODUCT[c.program]} UI`, {
    shortcut: "<Ctrl>o",
  });
  if (folder) {
    return {
      id: path,
      title: name,
      subtitle: section ? m.path : undefined,
      icon: { source: Icons.folder, tint: "blue" },
      section,
      keywords: relativePath.split("/"),
      actions: [
        action("Open Folder", () => folderView(c, m, relativePath), { icon: Icons.folder }),
        action("Search All Secrets Below", () => walkView(c, [m], relativePath), { icon: Icons.search }),
        ui,
        copy(path, "Copy Path", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      ],
    };
  }
  return {
    id: path,
    title: section ? relativePath : name,
    subtitle: section ? m.path : undefined,
    icon: { source: Icons.key, tint: "yellow" },
    section,
    keywords: relativePath.split("/"),
    detail: {
      metadata: [
        meta.text("Path", path, { icon: Icons.key }),
        meta.text("Mount", `${m.path} (KV v${m.version})`, { icon: Icons.database }),
      ],
      markdown: "Enter shows its keys; values stay hidden until you reveal them.",
    },
    actions: [
      action("Show Keys", () => secretView(c, m, path), { icon: Icons.key }),
      action("Copy Secret", () => copySecretJson(c, m, path), {
        icon: Icons.copy,
        section: "Copy",
      }),
      ui,
      copy(path, "Copy Path", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(getCommand(c, path), `Copy ${c.program} kv get Command`, { section: "Copy", icon: Icons.terminal }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Views

function folderView(c: Cli, m: Mount, relativePath: string): ListSpec {
  const path = joinPath(m.path, relativePath);
  return list({
    title: path,
    placeholder: `Filter ${path}…`,
    empty: { title: "Empty folder", description: `${path} has no secrets yet.`, icon: Icons.folder },
    status: (items) => items[0]?.id === "error" ? "" : `${items.length} entr${items.length === 1 ? "y" : "ies"}`,
    items: async ({ signal }) => {
      try {
        const entries = await listPath(c, path, signal);
        return entries.map((e) => entryItem(c, m, joinPath(path, e.name)));
      } catch (e) {
        return errorItems(e, c);
      }
    },
  });
}

async function* walk(c: Cli, roots: { mount: Mount; path: string }[], signal: AbortSignal) {
  const queue = roots.map((r) => ({ ...r, depth: 0 }));
  let found = 0;
  while (queue.length && found < WALK_LIMIT && !signal.aborted) {
    const batch = queue.splice(0, WALK_CONCURRENCY);
    const results = await Promise.all(batch.map(async (job) => {
      try {
        return { job, entries: await listPath(c, job.path, signal) };
      } catch (e) {
        if (e instanceof VaultError && (e.kind === "denied" || e.kind === "other")) return { job, entries: [] };
        throw e;
      }
    }));
    const secrets: { mount: Mount; path: string }[] = [];
    for (const { job, entries } of results) {
      for (const e of entries) {
        const full = joinPath(job.path, e.name);
        if (e.folder) {
          if (job.depth < WALK_DEPTH) queue.push({ mount: job.mount, path: full, depth: job.depth + 1 });
        } else secrets.push({ mount: job.mount, path: full });
      }
    }
    found += secrets.length;
    yield secrets;
  }
}

const cacheKey = (c: Cli, scope: string) => `walk:${c.address}:${scope}`;

async function* walkItems(c: Cli, signal: AbortSignal, only?: Mount[], below = ""): AsyncIterable<Item[]> {
  const scope = only ? joinPath(only[0].path, below) : "";
  try {
    const ms = only ?? await mounts(c, signal);
    const byPath = new Map(ms.map((m) => [m.path, m]));
    const cached = await storage.get<string[]>(cacheKey(c, scope)).catch(() => undefined);
    const items = (paths: string[]) =>
      paths.flatMap((path) => {
        const m = byPath.get(path.slice(0, path.indexOf("/") + 1));
        return m ? [entryItem(c, m, path, m.path)] : [];
      });
    if (cached?.length) yield items(cached);
    const found: string[] = [];
    const roots = only ? [{ mount: only[0], path: scope }] : ms.map((m) => ({ mount: m, path: m.path }));
    for await (const batch of walk(c, roots, signal)) {
      found.push(...batch.map((s) => s.path));
      // Keep the cached list on screen until the walk has found as much.
      if (!cached || found.length >= cached.length) yield items(found);
    }
    found.sort();
    yield items(found);
    await storage.set(cacheKey(c, scope), found).catch(() => {});
  } catch (e) {
    yield errorItems(e, c);
  }
}

function walkView(c: Cli, only?: Mount[], below = ""): ListSpec {
  const scope = only ? joinPath(only[0].path, below) : "";
  return list({
    title: scope ? `Secrets in ${scope}` : "All Secrets",
    placeholder: "Search secrets by path…",
    empty: { title: "No secrets", description: "No KV secret your token can list.", icon: Icons.key },
    status: (items) => items[0]?.id === "error" ? "" : `${items.length} secret${items.length === 1 ? "" : "s"}`,
    items: ({ signal }) => walkItems(c, signal, only, below),
  });
}

function keyItem(
  c: Cli,
  m: Mount,
  path: string,
  secret: Secret,
  key: string,
  reveal: boolean,
  version: number | undefined,
  rerender: (reveal: boolean) => ListSpec,
): Item {
  const value = secret.data[key];
  const lines = value.split("\n").length;
  const field = version ? [`-version=${version}`, `-field=${key}`] : [`-field=${key}`];
  return {
    id: `key:${key}`,
    title: key,
    subtitle: shownValue(value.replace(/\s*\n\s*/g, " ⏎ "), reveal),
    icon: { source: reveal ? Icons.eye : Icons.lock, tint: reveal ? "orange" : "gray" },
    section: "Keys",
    accessories: [
      ...(lines > 1 ? [{ tag: `${lines} lines`, color: "gray" as const }] : []),
      { text: `${value.length} char${value.length === 1 ? "" : "s"}` },
    ],
    detail: {
      markdown: reveal ? fence(value || "(empty)") : `\`${MASK}\`\n\nCtrl+R reveals the values.`,
      metadata: [
        meta.text("Key", key, { icon: Icons.key }),
        meta.text("Path", path),
        meta.text("Length", `${value.length} characters${lines > 1 ? `, ${lines} lines` : ""}`),
        ...(secret.version
          ? [
            meta.text("Version", String(secret.version.version), { icon: Icons.history }),
            meta.text("Updated", formatDate(secret.version.created) || "—", { icon: Icons.clock }),
          ]
          : []),
      ],
    },
    actions: [
      copy(value, "Copy Value", { concealed: true }),
      paste(value, "Paste Value", { concealed: true, shortcut: "<Ctrl><Shift>v" }),
      action(reveal ? "Hide Values" : "Reveal Values", () => replace(rerender(!reveal)), {
        icon: reveal ? Icons.eyeOff : Icons.eye,
        shortcut: "<Ctrl>r",
      }),
      copy(key, "Copy Key Name", { section: "Copy", shortcut: "<Ctrl>." }),
      copy(JSON.stringify(secret.data, null, 2), "Copy All as JSON", { concealed: true, section: "Copy" }),
      copy(
        [c.program, "kv", "get", ...field, shellQuote(path)].join(" "),
        `Copy ${c.program} kv get Command`,
        { section: "Copy", icon: Icons.terminal },
      ),
      copy(path, "Copy Path", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      open(uiUrl(c.address, c.program, m, path.slice(m.path.length), false), `Open in ${PRODUCT[c.program]} UI`, {
        shortcut: "<Ctrl>o",
      }),
    ],
  };
}

function versionItems(c: Cli, m: Mount, path: string, md: Metadata, shown?: number): Item[] {
  return md.versions.map((v) => {
    const state = versionState(v, md.currentVersion);
    const look = VERSION_LOOK[state];
    const actions: Action[] = [];
    if (state === "current" || state === "live") {
      actions.push(action(`Show Version ${v.version}`, () => secretView(c, m, path, v.version), {
        icon: Icons.history,
      }));
    }
    if (state === "deleted") {
      actions.push(action("Undelete Version", async () => {
        await vault(c, ["kv", "undelete", `-versions=${v.version}`, path]);
        await toast(`Version ${v.version} restored`, { style: "success", message: path });
        return refresh();
      }, { icon: Icons.refresh, confirm: `Restore version ${v.version} of ${path}?` }));
    }
    actions.push(copy(String(v.version), "Copy Version Number", { section: "Copy" }));
    return {
      id: `version:${v.version}`,
      title: `Version ${v.version}`,
      subtitle: relative(v.created) || undefined,
      icon: {
        source: state === "current" ? Icons.check : state === "live" ? Icons.history : Icons.trash,
        tint: look.color,
      },
      section: "Versions",
      keywords: ["version", look.label],
      accessories: [
        ...(v.version === shown ? [{ tag: "Shown", color: "purple" as const }] : []),
        { tag: look.label, color: look.color },
      ],
      detail: {
        metadata: [
          meta.text("Version", String(v.version), { icon: Icons.history }),
          meta.text("State", look.label, { icon: Icons.dot, color: look.color }),
          meta.text("Created", formatDate(v.created) || "—", { icon: Icons.clock }),
          ...(v.deleted ? [meta.text("Deleted", formatDate(v.deleted), { icon: Icons.trash })] : []),
          meta.separator(),
          meta.text("Current version", String(md.currentVersion)),
          meta.text("Kept versions", md.maxVersions ? String(md.maxVersions) : "Mount default"),
          ...(md.casRequired ? [meta.text("Check-and-set", "Required")] : []),
          ...(md.deleteVersionAfter !== "0s" ? [meta.text("Delete after", md.deleteVersionAfter)] : []),
          ...Object.entries(md.customMetadata).map(([k, val]) => meta.text(k, val, { icon: Icons.tag })),
        ],
      },
      actions,
    };
  });
}

function secretView(c: Cli, m: Mount, path: string, version?: number, reveal = false): ListSpec {
  const rerender = (r: boolean) => secretView(c, m, path, version, r);
  return list({
    title: version ? `${path} (version ${version})` : path,
    placeholder: "Filter keys…",
    empty: { title: "No keys", description: "This secret has no data.", icon: Icons.key },
    status: (items) => {
      const keys = items.filter((i) => i.section === "Keys").length;
      return `${keys} key${keys === 1 ? "" : "s"}${reveal ? " · values shown" : ""}`;
    },
    items: async ({ signal }) => {
      try {
        const args = ["kv", "get", "-format=json", ...(version ? [`-version=${version}`] : []), path];
        const [secretJson, mdJson] = await Promise.all([
          vault(c, args, signal),
          m.version === 2
            ? vault(c, ["kv", "metadata", "get", "-format=json", path], signal).catch(() => "")
            : Promise.resolve(""),
        ]);
        const secret = parseSecret(secretJson, m.version);
        const md = mdJson ? parseMetadata(mdJson) : undefined;
        const items: Item[] = Object.keys(secret.data).sort().map((key) =>
          keyItem(c, m, path, secret, key, reveal, version, rerender)
        );
        if (secret.gone) {
          items.unshift({
            id: "gone",
            title: secret.version?.destroyed ? "This version was destroyed" : "This version was deleted",
            subtitle: secret.version?.deleted ? relative(secret.version.deleted) : undefined,
            icon: { source: Icons.trash, tint: "orange" },
            section: "Keys",
            actions: [],
          });
        }
        if (md) items.push(...versionItems(c, m, path, md, secret.version?.version));
        return items;
      } catch (e) {
        return errorItems(e, c);
      }
    },
    actions: [
      action(reveal ? "Hide Values" : "Reveal Values", () => replace(rerender(!reveal)), {
        icon: reveal ? Icons.eyeOff : Icons.eye,
        shortcut: "<Ctrl>r",
      }),
    ],
  });
}

// ---------------------------------------------------------------------------
// The command

export default list({
  placeholder: "Filter secrets engines…",
  filter: {
    options: [
      { value: "mounts", title: "Mounts" },
      { value: "all", title: "All Secrets" },
    ],
  },
  empty: {
    title: "No KV secrets engine",
    description: "Your token can't see any KV mount. Enable one with vault secrets enable -version=2 kv.",
    icon: Icons.database,
  },
  status: (items) =>
    items[0]?.id === "error"
      ? ""
      : items.some((i) => i.id?.startsWith("mount:"))
      ? `${items.length} KV mount${items.length === 1 ? "" : "s"}`
      : `${items.length} secret${items.length === 1 ? "" : "s"}`,
  items: async function* (ctx) {
    let c: Cli | undefined;
    try {
      c = await cli(ctx.preferences as Prefs);
      if (ctx.filter === "all") {
        yield* walkItems(c, ctx.signal);
        return;
      }
      const ms = await mounts(c, ctx.signal);
      const actions = [
        inTerminal(c, `Log In with ${c.program} login`, ["login"], { icon: Icons.key }),
      ];
      yield ms.map((m) => {
        const item = mountItem(c!, m);
        return { ...item, actions: [...item.actions!, ...actions] };
      });
    } catch (e) {
      yield errorItems(e, c);
    }
  },
});
