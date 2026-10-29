import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import { type Account, accounts, SetupError } from "./api.ts";
import {
  envAccessories,
  environmentStates,
  type Flag,
  flagMetadata,
  flagsmithAppUrl,
  fromFlagsmith,
  fromGrowthBook,
  fromLaunchDarkly,
  fromUnleash,
  growthbookAppUrl,
  ldTogglePatch,
  looksLikeProduction,
  normalizeUrl,
  parseList,
  results,
  sortFlags,
  stateSummary,
  toggleConfirm,
  toggleTitle,
} from "./lib.ts";

Deno.test("production-looking environments", () => {
  const prod = ["production", "Prod", "prod-eu", "eu_prd", "Live", "us-production-2"];
  const other = ["development", "staging", "test", "product-demo", "preview", "delivery"];
  assertEquals(prod.map((n) => looksLikeProduction(n)), prod.map(() => true));
  assertEquals(other.map((n) => looksLikeProduction(n)), other.map(() => false));
  assertEquals(looksLikeProduction("customer-a", "production"), true);
  assertEquals(looksLikeProduction("customer-a", "development"), false);
});

Deno.test("helpers", () => {
  assertEquals(normalizeUrl("unleash.example.com/"), "https://unleash.example.com");
  assertEquals(normalizeUrl("http://localhost:4242/unleash/"), "http://localhost:4242/unleash");
  assertThrows(() => normalizeUrl(""));
  assertEquals(parseList("web, mobile  api"), ["web", "mobile", "api"]);
  assertEquals(results([1, 2]), [1, 2]);
  assertEquals(results({ results: [3] }), [3]);
  assertEquals(results(undefined), []);
  assertEquals(flagsmithAppUrl("https://api.flagsmith.com/api/v1"), "https://app.flagsmith.com");
  assertEquals(flagsmithAppUrl("https://flags.example.com/api/v1"), "https://flags.example.com");
  assertEquals(growthbookAppUrl("https://api.growthbook.io"), "https://app.growthbook.io");
  assertEquals(ldTogglePatch("production", false), [{
    op: "replace",
    path: "/environments/production/on",
    value: false,
  }]);
});

Deno.test("accounts from preferences", () => {
  assertEquals(accounts({}), []);
  const all = accounts({
    growthbookKey: "secret_x",
    launchdarklyToken: "api-123",
    launchdarklyProject: "web, mobile",
    unleashUrl: "unleash.example.com/api",
    unleashToken: "user:abc",
    flagsmithKey: "ser.xyz",
  });
  assertEquals(all.map((a) => a.provider), ["launchdarkly", "unleash", "flagsmith", "growthbook"]);
  const [ld, un, fs, gb] = all as Account[];
  assertEquals([ld.base, ld.headers.Authorization, ld.projects], ["https://app.launchdarkly.com/api/v2", "api-123", [
    "web",
    "mobile",
  ]]);
  assertEquals([un.base, un.projects], ["https://unleash.example.com", ["default"]]);
  assertInstanceOf(fs, SetupError);
  assertEquals((fs as unknown as SetupError).message, "Add the Flagsmith project ID in Settings");
  assertEquals([gb.base, gb.headers.Authorization], ["https://api.growthbook.io", "Bearer secret_x"]);
  const fs2 = accounts({ flagsmithKey: "k", flagsmithProject: "12", flagsmithUrl: "flags.example.com" })[0] as Account;
  assertEquals([fs2.base, fs2.headers.Authorization], ["https://flags.example.com/api/v1", "Api-Key k"]);
});

Deno.test("LaunchDarkly flags", () => {
  const f = fromLaunchDarkly("web", {
    key: "new-checkout",
    name: "New checkout",
    kind: "boolean",
    tags: ["payments"],
    creationDate: Date.parse("2026-01-01T00:00:00Z"),
    _maintainer: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
    environments: {
      production: { on: false, _environmentName: "Production", lastModified: Date.parse("2026-10-01T00:00:00Z") },
      test: { on: true, _environmentName: "Test" },
    },
  }, [{ key: "test", name: "Test" }, { key: "production", name: "Production", critical: true }]);
  assertEquals(f.environments.map((e) => [e.key, e.on, e.production]), [["test", true, false], [
    "production",
    false,
    true,
  ]]);
  assertEquals([f.url, f.owner, f.updated], [
    "https://app.launchdarkly.com/projects/web/flags/new-checkout",
    "Ada Lovelace",
    "2026-10-01T00:00:00.000Z",
  ]);
  assertEquals(stateSummary(f).text, "On in 1 of 2");
});

Deno.test("Unleash features", () => {
  const f = fromUnleash("https://unleash.example.com", "default", {
    name: "dark-mode",
    type: "release",
    project: "default",
    stale: true,
    tags: [{ type: "simple", value: "ui" }, { type: "team", value: "web" }],
    environments: [
      { name: "production", enabled: true, sortOrder: 2 },
      { name: "development", enabled: true, sortOrder: 1 },
    ],
  }, [{ name: "development", type: "development", sortOrder: 1 }, {
    name: "production",
    type: "production",
    sortOrder: 2,
  }]);
  assertEquals(f.environments.map((e) => e.name), ["development", "production"]);
  assertEquals(f.tags, ["ui", "team:web"]);
  assertEquals(f.url, "https://unleash.example.com/projects/default/features/dark-mode");
  assertEquals(stateSummary(f), { text: "On everywhere", color: "green", icon: "bs-flag" });
});

Deno.test("Flagsmith features", () => {
  const states = environmentStates([
    { id: 10, feature: 1, enabled: true },
    { id: 11, feature: 1, enabled: false, identity: 99 },
    { id: 12, feature: 1, enabled: false, feature_segment: 5 },
    { id: 13, feature: 2, enabled: false },
  ]);
  assertEquals(states.get(1)?.id, 10);
  const prod = { id: 1, name: "Production", api_key: "prodKey" };
  const dev = { id: 2, name: "Development", api_key: "devKey" };
  const f = fromFlagsmith(
    "https://api.flagsmith.com/api/v1",
    "42",
    { id: 1, name: "beta_banner", type: "STANDARD", tags: [7], owners: [{ email: "ada@example.com" }] },
    [{ env: dev, states: new Map() }, { env: prod, states }],
    new Map([[7, "marketing"]]),
  );
  assertEquals(f.environments, [{ key: "prodKey", name: "Production", on: true, production: true, ref: 10 }]);
  assertEquals([f.tags, f.owner, f.url], [
    ["marketing"],
    "ada@example.com",
    "https://app.flagsmith.com/project/42/environment/devKey/features?feature=1",
  ]);
});

Deno.test("GrowthBook features, sorting and presentation", () => {
  const f = fromGrowthBook("https://api.growthbook.io", {
    id: "search-v2",
    description: "New search",
    valueType: "boolean",
    owner: "Ada",
    environments: { production: { enabled: false }, dev: { enabled: true } },
  }, [{ id: "dev" }, { id: "production" }]);
  assertEquals(f.environments.map((e) => [e.key, e.on, e.production]), [["dev", true, false], [
    "production",
    false,
    true,
  ]]);
  assertEquals(f.url, "https://app.growthbook.io/features/search-v2");
  assertEquals(envAccessories(f).map((a) => [a.text, a.tooltip]), [["dev", "On in dev"], [
    "production",
    "Off in production (production)",
  ]]);
  assertEquals(toggleConfirm(f, f.environments[1]), "Turn on “search-v2” in production?");
  assertEquals(toggleConfirm(f, f.environments[0]), undefined);
  assertEquals(toggleTitle(f.environments[0]), "Turn Off in dev");
  assertEquals(flagMetadata(f)[1].value, "Off");
  const archived: Flag = { ...f, key: "a", name: "a", archived: true };
  const ld: Flag = { ...f, provider: "launchdarkly", name: "zeta" };
  assertEquals(sortFlags([archived, f, ld]).map((x) => x.name), ["zeta", "search-v2", "a"]);
  assertEquals(stateSummary({ ...f, environments: [] }).text, "No environment");
});
