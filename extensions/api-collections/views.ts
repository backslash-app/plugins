// Rows and pages shared by both commands: a request with its preview, the
// response page, the form asking for missing variables, environment switching.

import {
  type Action,
  action,
  type Context,
  copy,
  detail,
  type DetailSpec,
  field,
  form,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  refresh,
  replace,
  submenu,
  toast,
} from "@backslash/api";
import {
  type Collection,
  currentEnvironment,
  type Entry,
  forgetTypedVariables,
  HOME,
  pickEnvironment,
  saveTypedVariables,
  variables,
} from "./collections.ts";
import {
  FORMAT_NAMES,
  formatBytes,
  formatMs,
  hasSecret,
  isSecretName,
  METHOD_COLORS,
  prettyBody,
  type Request,
  resolveRequest,
  type Response,
  SECRET_HEADER,
  send,
  shortUrl,
  statusTint,
  tilde,
  toCurl,
  variablesOf,
} from "./lib.ts";

const fence = (text: string, lang = "") => {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((t) => t.length));
  const f = "`".repeat(longest + 1);
  return `${f}${lang}\n${text}\n${f}`;
};

const header = (r: Request, name: string) => r.headers.find(([k]) => k.toLowerCase() === name)?.[1] ?? "";

const FORMAT_ICONS = { bruno: Icons.layers, http: Icons.globe, hurl: Icons.terminal } as const;

export const where = (c: Collection) => tilde(c.path, HOME);

/** The file and line to open, relative to the collection for Bruno. */
const fileLabel = (c: Collection, e: Entry) =>
  c.format === "bruno" ? e.file.slice(c.path.length + 1) : `${c.name}${e.def.line ? `:${e.def.line}` : ""}`;

// ---------------------------------------------------------------------------
// Sending

const TIMEOUT = 30_000;

async function sendResolved(c: Collection, e: Entry, r: Request, ctx: Context): Promise<DetailSpec> {
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(TIMEOUT)]);
  let res: Response;
  try {
    res = await send(r, { signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error(`No answer after ${TIMEOUT / 1000} s`);
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message.replace(/^error sending request for url \([^)]*\): /, ""));
  }
  return responseView(c, e, r, res);
}

/** Sends the request, or asks first for the variables it can't resolve. */
export async function run(c: Collection, e: Entry, ctx: Context) {
  const { vars } = await variables(c);
  const { request, missing } = resolveRequest(e.def, vars);
  if (missing.length) return variablesForm(c, e, missing);
  return sendResolved(c, e, request, ctx);
}

function variablesForm(c: Collection, e: Entry, names: string[]) {
  return form({
    title: `Variables for “${e.def.name}”`,
    submitTitle: "Send Request",
    fields: names.map((n) =>
      isSecretName(n)
        ? field.password(n, n, { required: true })
        : field.text(n, n, { required: true, placeholder: `{{${n}}}` })
    ),
    async submit(values, ctx) {
      await saveTypedVariables(c, Object.fromEntries(names.map((n) => [n, String(values[n] ?? "")])));
      const { vars } = await variables(c);
      const { request, missing } = resolveRequest(e.def, vars);
      if (missing.length) throw new Error(`Still missing: ${missing.join(", ")}`);
      return replace(await sendResolved(c, e, request, ctx));
    },
  });
}

export function responseView(c: Collection, e: Entry, r: Request, res: Response): DetailSpec {
  const status = `${res.status} ${res.statusText}`.trim();
  let body: string;
  if (res.text === undefined) body = `_Binary body (${res.contentType || "unknown type"}), ${formatBytes(res.size)}._`;
  else if (!res.text) body = "_Empty body._";
  else {
    const pretty = prettyBody(res.contentType, res.text);
    const LIMIT = 30_000;
    body = fence(
      pretty.text.length > LIMIT ? `${pretty.text.slice(0, LIMIT)}\n… (${formatBytes(res.size)} in all)` : pretty.text,
      pretty.lang,
    );
  }
  return detail({
    title: `${e.def.name}: ${status}`,
    markdown: [`## ${status}`, "", `\`${r.method} ${r.url}\``, "", body].join("\n"),
    stats: [
      { label: "Status", value: res.status, color: statusTint(res.status) },
      { label: "Time", value: formatMs(res.ms) },
      { label: "Size", value: formatBytes(res.size) },
    ],
    metadata: [
      meta.text("Request", e.def.name, { icon: Icons.arrowRight }),
      meta.link("URL", shortUrl(res.url), res.url),
      ...(res.contentType ? [meta.text("Content type", res.contentType, { icon: Icons.file })] : []),
      meta.separator(),
      ...res.headers.map(([k, v]) => meta.text(k, v)),
    ],
    status: `${status} · ${formatMs(res.ms)} · ${formatBytes(res.size)}`,
    actions: [
      ...(res.text ? [copy(res.text, "Copy Body")] : []),
      action("Send Again", async (ctx) => replace(await sendResolved(c, e, r, ctx)), {
        icon: Icons.refresh,
        shortcut: "<Ctrl>r",
      }),
      ...(res.text && /json/.test(res.contentType)
        ? [copy(prettyBody(res.contentType, res.text).text, "Copy Formatted JSON", { icon: Icons.braces })]
        : []),
      copy(toCurl(r), "Copy as curl", {
        concealed: hasSecret(r),
        icon: Icons.terminal,
        shortcut: "<Ctrl><Shift>c",
        section: "Copy",
      }),
      copy(res.headers.map(([k, v]) => `${k}: ${v}`).join("\n"), "Copy Response Headers", { section: "Copy" }),
      copy(res.url, "Copy URL", { icon: Icons.link, section: "Copy" }),
      open(e.file, "Open Request File", { icon: Icons.file, shortcut: "<Ctrl>o" }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Rows

function environmentMenu(c: Collection): Action[] {
  const names = Object.keys(c.environments);
  if (!names.length) return [];
  return [submenu("Switch Environment", async () => {
    const now = await currentEnvironment(c);
    return [
      ...names.map((n) =>
        action(n === now ? `${n} (current)` : n, async () => {
          await pickEnvironment(c, n);
          await toast(`Environment: ${n}`, { style: "success" });
          return refresh();
        }, { icon: n === now ? Icons.check : Icons.layers })
      ),
      action("No Environment", async () => {
        await pickEnvironment(c, undefined);
        return refresh();
      }, { icon: Icons.minus }),
    ];
  }, { icon: Icons.layers, shortcut: "<Ctrl>e", section: "Collection" })];
}

function collectionActions(c: Collection): Action[] {
  return [
    ...environmentMenu(c),
    action("Forget Typed Variables", async () => {
      await forgetTypedVariables(c);
      await toast("Forgotten", { message: "Missing variables will be asked again" });
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Forget the variable values you typed for ${c.name}?`,
      section: "Collection",
    }),
    open(c.path, c.format === "bruno" ? "Open Collection Folder" : "Open File", {
      icon: Icons.folder,
      section: "Collection",
    }),
    action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Collection" }),
  ];
}

/** A request row: preview with the resolved URL, headers and body; Enter sends it. */
export function requestItem(
  c: Collection,
  e: Entry,
  vars: Record<string, string>,
  env: string | undefined,
  section?: string,
): Item {
  const { request: r, missing } = resolveRequest(e.def, vars);
  const color = METHOD_COLORS[e.def.method] ?? "gray";
  const used = variablesOf(e.def);
  const notes = e.def.notes ?? [];
  const bodyType = header(r, "content-type");
  const markdown = [
    `### ${e.def.name}`,
    fence(`${r.method} ${r.url}`),
    ...(r.headers.length
      ? [
        "**Headers**",
        fence(r.headers.map(([k, v]) => `${k}: ${SECRET_HEADER.test(k) ? "••••••" : v}`).join("\n")),
      ]
      : []),
    ...(r.body
      ? ["**Body**", fence(prettyBody(bodyType, r.body).text.slice(0, 4000), /json/.test(bodyType) ? "json" : "")]
      : []),
    ...(missing.length
      ? [`> Unknown variables: ${missing.map((m) => `\`${m}\``).join(", ")}. Enter asks for them.`]
      : []),
    ...notes.map((n) => `> ${n}`),
  ].join("\n\n");
  return {
    id: `${e.file}#${e.def.seq}:${e.def.name}`,
    title: e.def.name,
    subtitle: `${shortUrl(r.url)}`,
    icon: { source: Icons.arrowRight, tint: color },
    section,
    keywords: [e.def.method, e.def.url, c.name, fileLabel(c, e)],
    accessories: [
      ...(missing.length
        ? [{ icon: { source: Icons.alert, tint: "orange" as const }, tooltip: "Unknown variables" }]
        : []),
      { tag: e.def.method, color },
    ],
    detail: {
      markdown,
      metadata: [
        meta.text("Collection", c.name, { icon: FORMAT_ICONS[c.format] }),
        meta.text("Format", FORMAT_NAMES[c.format]),
        ...(env ? [meta.text("Environment", env, { icon: Icons.layers, color: "purple" })] : []),
        meta.text("File", fileLabel(c, e), { icon: Icons.file }),
        ...(used.length
          ? [
            meta.tags(
              "Variables",
              used.slice(0, 10).map((u) => ({ text: u, color: missing.includes(u) ? "orange" : "gray" })),
            ),
          ]
          : []),
      ],
    },
    actions: [
      action(missing.length ? "Set Variables and Send…" : "Send Request", (ctx) => run(c, e, ctx), {
        icon: Icons.arrowRight,
      }),
      copy(toCurl(r), "Copy as curl", {
        concealed: hasSecret(r),
        icon: Icons.terminal,
        shortcut: "<Ctrl><Shift>c",
        section: "Copy",
      }),
      copy(r.url, "Copy URL", { icon: Icons.link, section: "Copy" }),
      ...(r.body ? [copy(r.body, "Copy Body", { icon: Icons.braces, section: "Copy" })] : []),
      open(e.file, "Open Request File", { icon: Icons.file, shortcut: "<Ctrl>o" }),
      ...collectionActions(c),
    ],
  };
}

/** The requests of one collection. */
export function collectionView(c: Collection): ListSpec {
  return list({
    title: c.name,
    placeholder: `Filter requests of ${c.name}…`,
    empty: { title: "No requests", description: "This file has no request the extension can read", icon: Icons.globe },
    status: (items) => `${items.length} request${items.length === 1 ? "" : "s"}`,
    async items() {
      const { env, vars } = await variables(c);
      return c.requests.map((e) => requestItem(c, e, vars, env));
    },
  });
}

export async function collectionItem(c: Collection): Promise<Item> {
  const env = await currentEnvironment(c);
  const envs = Object.keys(c.environments);
  const methods = new Map<string, number>();
  for (const e of c.requests) methods.set(e.def.method, (methods.get(e.def.method) ?? 0) + 1);
  return {
    id: c.path,
    title: c.name,
    subtitle: where(c),
    icon: c.error ? { source: Icons.alert, tint: "red" } : { source: FORMAT_ICONS[c.format], tint: "blue" },
    keywords: [FORMAT_NAMES[c.format], ...envs],
    accessories: [
      ...(env ? [{ tag: env, color: "purple" as const, tooltip: "Environment" }] : []),
      { text: FORMAT_NAMES[c.format] },
      { text: `${c.requests.length} request${c.requests.length === 1 ? "" : "s"}` },
    ],
    detail: {
      stats: [
        { label: "Requests", value: c.requests.length },
        { label: "Environments", value: envs.length },
      ],
      markdown: c.error
        ? `**${c.error}**`
        : c.requests.slice(0, 30).map((e) => `- \`${e.def.method}\` ${e.def.name}`).join("\n"),
      metadata: [
        meta.text("Format", FORMAT_NAMES[c.format], { icon: FORMAT_ICONS[c.format] }),
        meta.text(c.format === "bruno" ? "Folder" : "File", where(c), { icon: Icons.folder }),
        ...(envs.length
          ? [meta.tags("Environments", envs.map((n) => ({ text: n, color: n === env ? "purple" : "gray" })))]
          : []),
        ...(methods.size
          ? [
            meta.tags(
              "Methods",
              [...methods].map(([m, n]) => ({ text: `${m} ${n}`, color: METHOD_COLORS[m] ?? "gray" })),
            ),
          ]
          : []),
      ],
    },
    actions: [
      action("Show Requests", () => collectionView(c), { icon: Icons.chevronRight }),
      ...collectionActions(c),
      copy(c.path, "Copy Path", { section: "Copy" }),
    ],
  };
}

export function deniedItem(root: string): Item {
  return {
    id: `denied:${root}`,
    title: `${tilde(root, HOME)} can't be read`,
    subtitle: "Only the usual code folders of your home can be scanned",
    section: "Folders",
    icon: { source: Icons.lock, tint: "orange" },
    detail: {
      markdown:
        "This extension may only read **~/Projects, ~/projects, ~/code, ~/Code, ~/src, ~/dev, ~/Developer, ~/git, ~/repos, ~/workspace, ~/work** and ~/Work.\n\nMove the collection there, or remove this folder from the preferences.",
    },
  };
}

export const EMPTY = {
  title: "No request files found",
  description:
    "Bruno collections, .http, .rest and .hurl files are looked for in your code folders: set them in Settings → Extensions → API Collections",
  icon: Icons.globe,
};

export interface Prefs {
  folders?: string;
  depth?: number;
}

export const depthOf = (prefs: Prefs) => Math.max(1, Math.min(8, Math.round(Number(prefs.depth) || 4)));
