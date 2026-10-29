import { action, Icons, list, refresh, submenu, toast, updateCommandMetadata } from "@backslash/api";
import { countStatus, gql, guarded, token } from "../api.ts";
import {
  isOpenPatch,
  type ListedPatchset,
  LISTS_QUERY,
  type MailingList,
  type Page,
  PATCH_CHOICES,
  PATCH_STYLES,
  patchItem,
  type Patchset,
  PATCHSET_MUTATION,
  sortPatches,
} from "../lib.ts";

function statusMenu(t: string, p: ListedPatchset) {
  return submenu(
    "Set Status",
    PATCH_CHOICES.filter((s) => s !== p.status).map((s) =>
      action(PATCH_STYLES[s].label, async () => {
        await gql(t, "lists", PATCHSET_MUTATION, { id: p.id, status: s });
        await toast(`${p.subject} → ${PATCH_STYLES[s].label}`, { style: "success" });
        return refresh();
      }, { icon: PATCH_STYLES[s].icon, destructive: s === "REJECTED" })
    ),
    { icon: Icons.inProgress, shortcut: "<Ctrl>s" },
  );
}

export default list({
  placeholder: "Filter patchsets by subject, list, submitter…",
  filter: {
    options: [
      { value: "open", title: "Open" },
      { value: "all", title: "All" },
    ],
  },
  empty: {
    title: "No patchsets",
    description: "Patches sent with git send-email to your lists.sr.ht lists show up here.",
    icon: Icons.mail,
  },
  status: (items) => countStatus(items, "patchset"),
  items: ({ preferences, signal, filter }) =>
    guarded(async () => {
      const t = token(preferences);
      const data = await gql<{ me: { lists: Page<MailingList & { patches: Page<Patchset> }> } }>(
        t,
        "lists",
        LISTS_QUERY,
        {},
        signal,
      );
      const all: ListedPatchset[] = data.me.lists.results.flatMap((l) => {
        const { patches, ...list } = l;
        return patches.results.map((p) => ({ ...p, list }));
      });
      const open = all.filter(isOpenPatch);
      const proposed = open.filter((p) => p.status === "PROPOSED").length;
      updateCommandMetadata({ subtitle: proposed ? `${proposed} proposed` : null }).catch(() => {});
      return sortPatches(filter === "all" ? all : open).map((p) => patchItem(p, [statusMenu(t, p)]));
    }),
});
