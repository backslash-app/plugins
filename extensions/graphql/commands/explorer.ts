import { action, type Context, Icons, type Item, list, meta, refresh, toast } from "@backslash/api";
import { allEndpoints, deleteEndpoint, live, savedEndpoints, saveEndpoint } from "../api.ts";
import { EXAMPLE_ENDPOINT, hostOf, maskHeader } from "../lib.ts";
import { endpointActions, endpointForm } from "../views.ts";

export default (ctx: Context) =>
  list({
    placeholder: "Pick an endpoint to browse its schema…",
    empty: {
      title: "No GraphQL endpoint yet",
      description: "Ctrl+K → Add Endpoint, or fill an endpoint slot in Settings (with a token kept in the keyring)",
      icon: Icons.braces,
    },
    status: (items) => `${items.filter((i) => !i.id?.startsWith("hint:")).length} endpoints`,
    actions: [
      action("Add Endpoint…", () => endpointForm(), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
    ],
    items: ({ signal }) => live(() => endpointItems(ctx.preferences), signal),
  });

async function endpointItems(preferences: Record<string, unknown>): Promise<Item[]> {
  const endpoints = await allEndpoints(preferences);
  const items: Item[] = endpoints.map((e) => {
    const headers = Object.entries(e.headers);
    const saved = e.source === "saved";
    return {
      id: e.id,
      title: e.name,
      subtitle: e.url,
      icon: { source: Icons.braces, tint: saved ? "pink" : "purple" },
      section: saved ? "Saved" : "Settings",
      keywords: [hostOf(e.url)],
      accessories: [
        ...(headers.some(([k]) => /authorization|token|key/i.test(k))
          ? [{ icon: { source: Icons.lock, tint: "green" as const }, tooltip: "Sends credentials" }]
          : []),
        { tag: saved ? "saved" : `slot ${e.id.split(":")[1]}` },
      ],
      detail: {
        markdown: [
          `## ${e.name}`,
          "",
          "Enter browses the schema (queries, mutations, types with their arguments); Ctrl+Enter runs a query.",
        ].join("\n"),
        metadata: [
          meta.text("URL", e.url, { icon: Icons.globe }),
          ...headers.map(([k, v]) => meta.text(k, maskHeader(k, v), { icon: Icons.key })),
          meta.text("Stored", saved ? "In the extension (no secrets)" : "Settings (token in the keyring)"),
        ],
      },
      actions: endpointActions(
        e,
        endpoints,
        saved
          ? [
            action("Edit Endpoint…", async () => {
              const s = (await savedEndpoints()).find((x) => x.id === e.id);
              if (!s) throw new Error("This endpoint was removed");
              return endpointForm(s);
            }, { icon: Icons.settings, section: "Endpoint", shortcut: "<Ctrl>e" }),
            action("Delete Endpoint", async () => {
              await deleteEndpoint(e.id);
              await toast(`${e.name} deleted`);
              return refresh();
            }, {
              icon: Icons.trash,
              section: "Endpoint",
              destructive: true,
              confirm: `Delete ${e.name}?`,
              shortcut: "<Ctrl>BackSpace",
            }),
          ]
          : [],
      ),
    };
  });
  if (!endpoints.some((e) => e.url === EXAMPLE_ENDPOINT.url)) {
    items.push({
      id: "hint:example",
      title: "Add a Public Example",
      subtitle: `${EXAMPLE_ENDPOINT.name}: ${EXAMPLE_ENDPOINT.url}`,
      icon: { source: Icons.plus, tint: "gray" },
      section: endpoints.length ? "Add" : "Get Started",
      actions: [
        action("Add Example Endpoint", async () => {
          await saveEndpoint(EXAMPLE_ENDPOINT);
          return refresh();
        }, { icon: Icons.plus }),
        action("Add Endpoint…", () => endpointForm(), { icon: Icons.plus }),
      ],
    });
  }
  items.push({
    id: "hint:add",
    title: "Add Endpoint…",
    subtitle: "Name, URL and non-secret headers; tokens go in Settings",
    icon: { source: Icons.plus, tint: "gray" },
    section: endpoints.length ? "Add" : "Get Started",
    actions: [action("Add Endpoint…", () => endpointForm(), { icon: Icons.plus })],
  });
  return items;
}
