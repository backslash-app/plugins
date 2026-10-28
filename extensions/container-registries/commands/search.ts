import {
  type Action,
  action,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  type Metadata,
  open,
} from "@backslash/api";
import { NotFound, repoDetails, search, tagDetails, tags } from "../api.ts";
import {
  compact,
  filterTags,
  formatBytes,
  type ImageConfig,
  type ImageRef,
  type ImageSummary,
  parseImageRef,
  platformLabel,
  pullCommands,
  REGISTRIES,
  type RegistryId,
  relativeDate,
  shortDigest,
  shortName,
  type Tag,
  trimReadme,
  webUrl,
} from "../lib.ts";

const dateText = (iso: string | undefined) =>
  iso ? new Date(iso).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }) : "";

function errorItem(e: unknown, what: string, page: string): Item {
  const missing = e instanceof NotFound;
  return {
    id: "error",
    title: missing ? `${what} not found` : `Can't reach ${what}`,
    subtitle: missing ? "Check the name; private images need a sign-in this extension doesn't do" : String(
      e instanceof Error ? e.message : e,
    ),
    icon: { source: missing ? Icons.search : Icons.wifiOff, tint: missing ? "gray" : "red" },
    actions: [open(page, "Open in Browser")],
  };
}

// ---------------------------------------------------------------------------
// Tags

function tagActions(registry: RegistryId, repository: string, t: Tag, withDetails: boolean): Action[] {
  const pulls = pullCommands(registry, repository, t.name, t.digest);
  const docker = pulls.filter((p) => p.title.startsWith("docker"));
  const podman = pulls.filter((p) => p.title.startsWith("podman"));
  return [
    copy(docker[0].command, "Copy docker pull", { icon: Icons.terminal }),
    ...(docker[1] ? [copy(docker[1].command, "Copy docker pull by Digest", { icon: Icons.terminal })] : []),
    ...(withDetails
      ? [action("Show Details", () => tagDetail(registry, repository, t), { icon: Icons.info, shortcut: "<Ctrl>d" })]
      : []),
    ...podman.map((p, i) =>
      copy(p.command, i ? "Copy podman pull by Digest" : "Copy podman pull", {
        icon: Icons.terminal,
        section: "Podman",
        ...(i === 0 ? { shortcut: "<Ctrl><Shift>p" } : {}),
      })
    ),
    open(webUrl(registry, repository, t.name), `Open on ${REGISTRIES[registry].title}`, {
      shortcut: "<Ctrl>o",
      section: "Links",
    }),
    copy(t.name, "Copy Tag", { section: "Copy" }),
    ...(t.digest ? [copy(t.digest, "Copy Digest", { section: "Copy", shortcut: "<Ctrl><Shift>d" })] : []),
    copy(`${shortName(registry, repository)}:${t.name}`, "Copy Image Reference", { section: "Copy" }),
  ];
}

function tagMetadata(registry: RegistryId, repository: string, t: Tag, config?: ImageConfig): Metadata[] {
  const sized = t.platforms.filter((p) => p.size);
  const source = config?.labels["org.opencontainers.image.source"];
  const version = config?.labels["org.opencontainers.image.version"];
  return [
    ...(t.digest ? [meta.text("Digest", shortDigest(t.digest), { icon: Icons.hash })] : []),
    meta.tags("Type", [{
      text: t.multiArch ? "Multi-arch index" : "Single image",
      color: t.multiArch ? "blue" : "gray",
    }]),
    ...(t.platforms.length
      ? [meta.tags("Platforms", t.platforms.map((p) => ({ text: platformLabel(p), color: "teal" as const })))]
      : []),
    ...(sized.length > 1 ? sized.map((p) => meta.text(platformLabel(p), formatBytes(p.size))) : []),
    ...(t.pushed ? [meta.text("Pushed", dateText(t.pushed), { icon: Icons.upload })] : []),
    ...(t.pulled ? [meta.text("Last pulled", relativeDate(t.pulled), { icon: Icons.download })] : []),
    ...(config?.created && config.created !== t.pushed ? [meta.text("Built", dateText(config.created))] : []),
    ...(version ? [meta.text("Version label", version, { icon: Icons.tag })] : []),
    meta.separator(),
    meta.link(
      REGISTRIES[registry].title,
      `${shortName(registry, repository)}:${t.name}`,
      webUrl(registry, repository, t.name),
    ),
    ...(source ? [meta.link("Source", source.replace(/^https:\/\//, ""), source)] : []),
  ];
}

function tagItem(registry: RegistryId, repository: string, t: Tag): Item {
  const pulls = pullCommands(registry, repository, t.name, t.digest);
  const archs = t.platforms.length;
  const pushed = relativeDate(t.pushed);
  return {
    id: `tag:${t.name}`,
    title: t.name,
    subtitle: pushed ? `pushed ${pushed}` : t.partial ? "Ctrl+D for details" : undefined,
    icon: { source: Icons.tag, tint: t.name === "latest" || t.name === "stable" ? "green" : REGISTRIES[registry].tint },
    accessories: [
      ...(archs > 1 ? [{ text: `${archs} platforms`, tooltip: t.platforms.map(platformLabel).join(", ") }] : []),
      ...(archs === 1 ? [{ text: platformLabel(t.platforms[0]) }] : []),
      ...(t.size ? [{ text: formatBytes(t.size), tooltip: "Compressed size" }] : []),
      ...(t.digest ? [{ tag: shortDigest(t.digest).slice(0, 7), color: "gray" as const, tooltip: t.digest }] : []),
    ],
    detail: {
      stats: [
        ...(t.size ? [{ label: "Size", value: formatBytes(t.size) }] : []),
        ...(archs ? [{ label: "Platforms", value: archs }] : []),
        ...(pushed ? [{ label: "Pushed", value: pushed }] : []),
      ],
      markdown: [
        "```",
        ...pulls.map((p) => p.command),
        "```",
        ...(t.partial ? ["", "_Press Ctrl+D to load its platforms, size and dates._"] : []),
      ].join("\n"),
      metadata: tagMetadata(registry, repository, t),
    },
    actions: tagActions(registry, repository, t, registry !== "docker"),
  };
}

async function tagDetail(registry: RegistryId, repository: string, t: Tag): Promise<DetailSpec> {
  const { tag, config } = await tagDetails(registry, repository, t);
  const pulls = pullCommands(registry, repository, tag.name, tag.digest);
  const labels = Object.entries(config?.labels ?? {});
  return detail({
    title: `${shortName(registry, repository)}:${tag.name}`,
    stats: [
      ...(tag.size ? [{ label: "Size", value: formatBytes(tag.size) }] : []),
      ...(tag.platforms.length ? [{ label: "Platforms", value: tag.platforms.length }] : []),
      ...(tag.pushed ? [{ label: "Pushed", value: relativeDate(tag.pushed) }] : []),
    ],
    markdown: [
      "```",
      ...pulls.map((p) => p.command),
      "```",
      ...(labels.length ? ["", "**Labels**", "", ...labels.slice(0, 20).map(([k, v]) => `- \`${k}\`: ${v}`)] : []),
    ].join("\n"),
    metadata: tagMetadata(registry, repository, tag, config),
    actions: tagActions(registry, repository, tag, false),
  });
}

/** Tags already loaded, by registry/repository, so typing `:1.2` filters without a new request. */
const tagCache = new Map<string, Tag[]>();

async function loadTags(registry: RegistryId, repository: string, signal: AbortSignal, filter?: string) {
  // Docker Hub and Quay filter on their side (they can have thousands of tags); GHCR is listed whole.
  const server = registry === "ghcr" ? undefined : filter || undefined;
  const key = `${registry}/${repository}:${server ?? ""}`;
  if (!tagCache.has(key)) tagCache.set(key, await tags(registry, repository, signal, server));
  return tagCache.get(key)!;
}

function tagsList(image: ImageSummary): ListSpec {
  const { registry, repository } = image;
  let count = 0;
  return list({
    title: shortName(registry, repository),
    placeholder: `Filter the tags of ${shortName(registry, repository)}…`,
    empty: { title: "No tags", description: "This image has no tag.", icon: Icons.tag },
    status: (items) =>
      `${items.length === count ? count : `${items.length} of ${count}`} tags${
        registry === "ghcr" ? "" : " · the 100 most recent"
      } · ${REGISTRIES[registry].title}`,
    actions: [
      action("Show Overview", () => overview(image), { icon: Icons.info }),
      open(webUrl(registry, repository), `Open on ${REGISTRIES[registry].title}`),
    ],
    async items({ signal }) {
      try {
        const found = await loadTags(registry, repository, signal);
        count = found.length;
        return found.map((t) => tagItem(registry, repository, t));
      } catch (e) {
        if (signal.aborted) throw e;
        return [errorItem(e, shortName(registry, repository), webUrl(registry, repository))];
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Images

async function overview(image: ImageSummary): Promise<DetailSpec> {
  const { registry, repository } = image;
  const d = await repoDetails(registry, repository).catch(() =>
    ({ categories: [] as string[] }) as Awaited<
      ReturnType<typeof repoDetails>
    >
  );
  const readme = d.readme ? trimReadme(d.readme, 120) : d.description ?? image.description ?? "_No description._";
  return detail({
    title: shortName(registry, repository),
    stats: [
      ...((d.pulls ?? image.pulls) !== undefined ? [{ label: "Pulls", value: compact(d.pulls ?? image.pulls) }] : []),
      ...((d.stars ?? image.stars) !== undefined ? [{ label: "Stars", value: compact(d.stars ?? image.stars) }] : []),
      ...(d.updated ? [{ label: "Updated", value: relativeDate(d.updated) }] : []),
    ],
    markdown: readme,
    metadata: [
      meta.text("Registry", REGISTRIES[registry].title, { icon: Icons.server }),
      ...(image.official ? [meta.tags("Badge", [{ text: "Docker Official Image", color: "blue" }])] : []),
      ...(d.categories.length ? [meta.tags("Categories", d.categories)] : []),
      ...(d.created ? [meta.text("Created", dateText(d.created), { icon: Icons.calendar })] : []),
      meta.separator(),
      meta.link("Page", webUrl(registry, repository).replace(/^https:\/\//, ""), webUrl(registry, repository)),
    ],
    actions: [
      action("Show Tags", () => tagsList(image), { icon: Icons.tag }),
      copy(`docker pull ${shortName(registry, repository)}`, "Copy docker pull", { icon: Icons.terminal }),
      open(webUrl(registry, repository), `Open on ${REGISTRIES[registry].title}`),
    ],
  });
}

function imageItem(image: ImageSummary): Item {
  const { registry, repository } = image;
  const name = shortName(registry, repository);
  const pulls = pullCommands(registry, repository, "latest");
  return {
    id: `${registry}:${repository}`,
    title: name,
    subtitle: image.description,
    icon: {
      source: image.official ? Icons.check : Icons.box,
      tint: image.official ? "blue" : REGISTRIES[registry].tint,
    },
    section: image.official ? "Official Images" : undefined,
    accessories: [
      ...(image.official ? [{ tag: "Official", color: "blue" as const }] : []),
      ...(image.stars !== undefined ? [{ icon: Icons.star, text: compact(image.stars), tooltip: "Stars" }] : []),
      ...(image.pulls !== undefined ? [{ icon: Icons.download, text: compact(image.pulls), tooltip: "Pulls" }] : []),
    ],
    detail: {
      stats: [
        ...(image.pulls !== undefined ? [{ label: "Pulls", value: compact(image.pulls) }] : []),
        ...(image.stars !== undefined ? [{ label: "Stars", value: compact(image.stars) }] : []),
        ...(image.updated ? [{ label: "Updated", value: relativeDate(image.updated) }] : []),
      ],
      markdown: [image.description ?? "", "", "```", ...pulls.map((p) => p.command), "```"].join("\n").trim(),
      metadata: [
        meta.text("Registry", REGISTRIES[registry].title, { icon: Icons.server }),
        ...(image.official ? [meta.tags("Badge", [{ text: "Docker Official Image", color: "blue" }])] : []),
        meta.link("Page", webUrl(registry, repository).replace(/^https:\/\//, ""), webUrl(registry, repository)),
      ],
    },
    actions: [
      action("Show Tags", () => tagsList(image), { icon: Icons.tag }),
      copy(pulls[0].command, "Copy docker pull", { icon: Icons.terminal }),
      action("Show Overview", () => overview(image), { icon: Icons.info, shortcut: "<Ctrl>d" }),
      copy(pulls[1].command, "Copy podman pull", { icon: Icons.terminal, section: "Podman" }),
      open(webUrl(registry, repository), `Open on ${REGISTRIES[registry].title}`, {
        shortcut: "<Ctrl>o",
        section: "Links",
      }),
      copy(name, "Copy Image Name", { section: "Copy" }),
    ],
  };
}

const HINTS: { query: string; text: string; registry: RegistryId; repository: string }[] = [
  {
    query: "nginx",
    text: "Search Docker Hub (official images first)",
    registry: "docker",
    repository: "library/nginx",
  },
  { query: "postgres:17", text: "Tags of an image, filtered", registry: "docker", repository: "library/postgres" },
  {
    query: "ghcr.io/home-assistant/home-assistant",
    text: "Tags on the GitHub Container Registry",
    registry: "ghcr",
    repository: "home-assistant/home-assistant",
  },
  {
    query: "quay.io/prometheus/node-exporter",
    text: "Tags on Quay.io",
    registry: "quay",
    repository: "prometheus/node-exporter",
  },
];

let status = "";

export default list({
  placeholder: "Search images, or type an image: nginx:1.27, ghcr.io/owner/image, quay.io/ns/name…",
  filter: {
    options: [{ value: "docker", title: "Docker Hub" }, { value: "quay", title: "Quay.io" }],
  },
  empty: { title: "No image found", description: "Check the spelling, or try the other registry.", icon: Icons.box },
  status: () => status,
  async search(query, { signal, filter }) {
    const q = query.trim();
    if (!q) {
      status = "Docker Hub, GHCR and Quay.io";
      return HINTS.map((h) => ({
        id: `hint:${h.query}`,
        title: h.query,
        subtitle: h.text,
        icon: { source: Icons.search, tint: REGISTRIES[h.registry].tint },
        section: "Type",
        actions: [open(webUrl(h.registry, h.repository), `Open on ${REGISTRIES[h.registry].title}`)],
      }));
    }
    const ref: ImageRef | undefined = parseImageRef(q);
    if (ref) {
      const { registry, repository } = ref;
      const name = shortName(registry, repository);
      try {
        const found = filterTags(await loadTags(registry, repository, signal, ref.tag), ref.tag);
        status = `${found.length} tag${found.length === 1 ? "" : "s"} of ${name} · ${REGISTRIES[registry].title}`;
        const image: ImageSummary = { registry, repository };
        return [
          ...found.slice(0, 200).map((t) => ({ ...tagItem(registry, repository, t), section: `Tags of ${name}` })),
          {
            id: "overview",
            title: `About ${name}`,
            subtitle: "Description, stats and all tags",
            icon: { source: Icons.info, tint: "gray" as const },
            section: "Image",
            actions: [
              action("Show Overview", () => overview(image), { icon: Icons.info }),
              action("Show Tags", () => tagsList(image), { icon: Icons.tag }),
              open(webUrl(registry, repository), `Open on ${REGISTRIES[registry].title}`),
            ],
          },
        ];
      } catch (e) {
        if (signal.aborted) throw e;
        status = `${name}: ${e instanceof NotFound ? "not found" : "unreachable"}`;
        return [errorItem(e, name, webUrl(registry, repository))];
      }
    }
    const registry = (filter as RegistryId) === "quay" ? "quay" : "docker";
    try {
      const found = await search(registry, q, signal);
      status = `${found.length} image${found.length === 1 ? "" : "s"} on ${
        REGISTRIES[registry].title
      } · type name:tag for tags`;
      return found.map(imageItem);
    } catch (e) {
      if (signal.aborted) throw e;
      status = `${REGISTRIES[registry].title} is unreachable`;
      return [
        errorItem(
          e,
          REGISTRIES[registry].title,
          registry === "quay"
            ? `https://quay.io/search?q=${encodeURIComponent(q)}`
            : `https://hub.docker.com/search?q=${encodeURIComponent(q)}`,
        ),
      ];
    }
  },
});
