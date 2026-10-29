import { action, type Context, Icons, type Item, list, type ListSpec, open } from "@backslash/api";
import { home, instant, optionsOf, savedPlaces, search } from "../api.ts";
import { modeOf, type Place, searchable, withSavedFirst } from "../lib.ts";
import { modeName, placeItem, type Where } from "../ui.ts";

async function where(ctx: Context): Promise<{ w: Where; problem?: string }> {
  const saved = await savedPlaces();
  const mode = modeOf(ctx.preferences.mode);
  try {
    const h = await home(String(ctx.preferences.home ?? ""), optionsOf(ctx.preferences), ctx.signal);
    return { w: { home: h, mode, saved } };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return { w: { mode, saved }, problem: (e as Error).message };
  }
}

function hintItem(problem?: string): Item {
  return {
    id: "hint",
    title: problem ?? "Set your home address",
    subtitle: problem ? "Settings → Extensions → Maps" : "For directions and distances",
    icon: { source: problem ? Icons.alert : Icons.home, tint: problem ? "orange" : "gray" },
    section: "Home",
    detail: {
      markdown: "Directions start from the **Home address** in **Settings → Extensions → Maps**: an address, " +
        "or coordinates such as `48.8566, 2.3522`.",
    },
    actions: [open("https://www.openstreetmap.org", "Open OpenStreetMap", { icon: Icons.globe })],
  };
}

/** The results of a submitted search: the only place a request to Nominatim is made. */
function resultsView(query: string): ListSpec {
  return list({
    title: `“${query}”`,
    placeholder: "Filter the results…",
    empty: {
      title: `Nothing found for “${query}”`,
      description: "Try another spelling or add the city",
      icon: Icons.pin,
    },
    status: (items) => `${items.length} result${items.length === 1 ? "" : "s"} · © OpenStreetMap contributors`,
    async items(ctx) {
      const [{ w }, places] = await Promise.all([where(ctx), search(query, optionsOf(ctx.preferences), ctx.signal)]);
      return withSavedFirst(places, w.saved).map((p) => placeItem(p, w));
    },
  });
}

function searchItem(query: string, cachedCount?: number): Item {
  return {
    id: "search",
    title: `Search “${query}”`,
    subtitle: cachedCount === undefined ? "Press Enter to search OpenStreetMap" : "Search again",
    icon: { source: Icons.search, tint: "blue" },
    section: "Search",
    detail: {
      markdown: "OpenStreetMap's search doesn't allow searching as you type: press **Enter** to look this up.",
    },
    actions: [action("Search OpenStreetMap", () => resultsView(query), { icon: Icons.search })],
  };
}

const matches = (p: Place, query: string) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = [p.name, p.displayName, ...Object.values(p.address)].join(" ").toLowerCase();
  return words.every((w) => text.includes(w));
};

let status = "";

export default list({
  placeholder: "Type a place or an address, then Enter…",
  empty: {
    title: "Type a place, an address or coordinates",
    description: "Press Enter to search OpenStreetMap; save places to find them here",
    icon: Icons.pin,
  },
  status: () => status,
  // Runs as the user types, but never asks Nominatim: saved places, typed coordinates and
  // answers already cached show at once; anything else waits for Enter on the search row.
  async search(query, ctx) {
    const { w, problem } = await where(ctx);
    const q = query.trim();
    if (!q) {
      status = w.home ? `Home: ${w.home.name} · directions ${modeName(w.mode)}` : "OpenStreetMap";
      return [
        ...(w.home ? [placeItem(w.home, w, { section: "Home", home: true })] : [hintItem(problem)]),
        ...w.saved.map((p) => placeItem(p, w, { section: "Saved Places" })),
      ];
    }
    const saved = w.saved.filter((p) => matches(p, q)).map((p) => placeItem(p, w, { section: "Saved Places" }));
    const known = await instant(q, optionsOf(ctx.preferences));
    const isCoordinates = !!known?.length && known[0].category === "position";
    const results = (known ?? []).filter((p) => !w.saved.some((s) => s.id === p.id))
      .map((p) => placeItem(p, w, { section: isCoordinates ? "Position" : "Earlier Results" }));
    status = searchable(q) ? "Enter searches OpenStreetMap" : "Type at least 3 letters";
    const row = searchable(q) && !isCoordinates ? [searchItem(q, known?.length)] : [];
    // The search row comes first unless a cached answer already holds what the user wants.
    return known?.length ? [...results, ...saved, ...row] : [...row, ...saved, ...results];
  },
});
