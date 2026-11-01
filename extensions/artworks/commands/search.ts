import { Icons, type Item, list } from "@backslash/api";
import { searchAic, searchMet } from "../api.ts";
import { type Artwork, interleave, sourceOf } from "../lib.ts";
import { artworkItem } from "../views.ts";

let status = "";

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);

export default list({
  placeholder: "Search artworks: van gogh, water lilies, samurai armor…",
  filter: {
    options: [
      { value: "all", title: "Both Museums" },
      { value: "met", title: "The Met" },
      { value: "aic", title: "Art Institute" },
      { value: "public", title: "Public Domain" },
    ],
  },
  empty: {
    title: "Search two great museums",
    description: "The Metropolitan Museum of Art and the Art Institute of Chicago: an artist, a title, a subject",
    icon: Icons.palette,
  },
  status: () => status,
  async search(query, ctx) {
    if (!query.trim()) {
      status = "The Met · Art Institute of Chicago";
      return [];
    }
    const source = sourceOf(ctx.filter);
    const publicOnly = source === "public";
    const wantMet = source !== "aic";
    const wantAic = source !== "met";
    const empty = { artworks: [] as Artwork[], total: 0 };
    const errors: string[] = [];
    const keep = (e: unknown) => {
      if (ctx.signal.aborted) throw e;
      errors.push((e as Error).message);
      return empty;
    };
    const [met, aic] = await Promise.all([
      wantMet ? searchMet(query, ctx.signal, publicOnly ? 20 : 12).catch(keep) : empty,
      wantAic ? searchAic(query, ctx.signal, 12, publicOnly).catch(keep) : empty,
    ]);
    // The Met's search has no public-domain filter: it is applied here.
    const metShown = publicOnly ? met.artworks.filter((a) => a.publicDomain).slice(0, 12) : met.artworks;
    const items: Item[] = interleave(metShown, aic.artworks).map((a) => artworkItem(a));
    if (errors.length && !items.length) throw new Error(errors.join(" · "));
    for (const e of errors) {
      items.push({
        id: `error:${e}`,
        title: e,
        subtitle: "Results from the other museum are shown",
        icon: { source: Icons.alert, tint: "orange" },
      });
    }
    status = [
      wantMet ? `The Met: ${fmt(met.total)}` : "",
      wantAic ? `Art Institute: ${fmt(aic.total)}` : "",
    ].filter(Boolean).join(" · ") + (items.length ? ` · showing ${metShown.length + aic.artworks.length}` : "");
    return items;
  },
});
