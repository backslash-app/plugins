import { type Context, Icons, type Item, list, updateCommandMetadata } from "@backslash/api";
import { neonProjects, psDatabases, psOrgs, tursoDatabases, tursoGroups, tursoLocations, tursoOrgs } from "../api.ts";
import {
  configured,
  type Credentials,
  credentials,
  type Prefs,
  type Provider,
  PROVIDER_NAMES,
  PROVIDERS,
} from "../lib.ts";
import { errorItem, neonProjectItem, psDatabaseItem, setupItem, tursoDatabaseItem, tursoGroupItem } from "../views.ts";

async function neon(c: Credentials, signal: AbortSignal): Promise<Item[]> {
  return (await neonProjects(c, signal)).map((e) => neonProjectItem(c, e));
}

async function turso(c: Credentials, signal: AbortSignal): Promise<Item[]> {
  const [orgs, locations] = await Promise.all([tursoOrgs(c, signal), tursoLocations(c, signal)]);
  const per = await Promise.all(orgs.map(async (o) => {
    const [dbs, groups] = await Promise.all([tursoDatabases(c, o.slug, signal), tursoGroups(c, o.slug, signal)]);
    return [
      ...dbs.sort((a, b) => a.Name.localeCompare(b.Name)).map((d) =>
        tursoDatabaseItem(c, o.slug, d, groups, locations, orgs.length)
      ),
      ...groups.map((g) =>
        tursoGroupItem(o.slug, g, dbs.filter((d) => d.group === g.name).length, locations, orgs.length)
      ),
    ];
  }));
  return per.flat();
}

async function planetscale(c: Credentials, signal: AbortSignal): Promise<Item[]> {
  const orgs = await psOrgs(c, signal);
  const per = await Promise.all(
    orgs.map(async (org) =>
      (await psDatabases(c, org, signal)).sort((a, b) => a.name.localeCompare(b.name)).map((d) =>
        psDatabaseItem(c, org, d, orgs.length)
      )
    ),
  );
  return per.flat();
}

const LOADERS: Record<Provider, (c: Credentials, signal: AbortSignal) => Promise<Item[]>> = {
  neon,
  turso,
  planetscale,
};

let summary = "";

// Projects and databases of every provider with a token; each shows up as soon as it answers.
export default (ctx: Context) => {
  const shown = configured(credentials(ctx.preferences as Prefs));
  return list({
    placeholder: "Filter databases by name, region, group…",
    filter: shown.length > 1
      ? {
        options: [{ value: "all", title: "All" }, ...shown.map((p) => ({ value: p, title: PROVIDER_NAMES[p] }))],
        default: "all",
      }
      : undefined,
    empty: {
      title: "No databases",
      description: "None of your connected providers has a database",
      icon: Icons.database,
    },
    status: () => summary,
    async *items({ preferences, filter, signal }) {
      summary = "";
      const creds = credentials(preferences as Prefs);
      const all = configured(creds);
      if (!all.length) {
        yield [setupItem()];
        return;
      }
      const picked = all.filter((p) => p === filter);
      const providers = picked.length ? picked : all;
      const results = new Map<Provider, Item[]>();
      const render = () => PROVIDERS.flatMap((p) => results.get(p) ?? []);
      const count = () =>
        [...results.values()].flat().filter((i) => !i.id?.startsWith("error:") && !i.id?.startsWith("turso-group:"))
          .length;
      const pending = new Map(providers.map((p) => [
        p,
        LOADERS[p](creds, signal).then(
          (items) => void results.set(p, items),
          (err) => {
            if (signal.aborted) throw err;
            results.set(p, [errorItem(p, err)]);
          },
        ).then(() => p),
      ]));
      while (pending.size) {
        pending.delete(await Promise.race(pending.values()));
        summary = `${count()} database${count() === 1 ? "" : "s"}${pending.size ? " · loading…" : ""}`;
        yield render();
      }
      if (providers === all) {
        await updateCommandMetadata({ subtitle: count() ? `${count()} databases` : null }).catch(() => {});
      }
    },
  });
};
