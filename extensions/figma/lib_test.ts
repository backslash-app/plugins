import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  ago,
  apiError,
  type DesignFile,
  figmaDesktopUrl,
  figmaFiles,
  figmaProjects,
  figmaUrl,
  HOSTS,
  isAllowedHost,
  normalizePenpot,
  parseTeams,
  penpotFiles,
  penpotProjects,
  penpotUrl,
  pick,
  pool,
  remember,
  shortAge,
  slug,
  sortFiles,
} from "./lib.ts";

Deno.test("manifest hosts match HOSTS", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(isAllowedHost("design.penpot.app"));
  assert(isAllowedHost("penpot.home.arpa"));
  assert(isAllowedHost("10.1.2.3"));
  assert(!isAllowedHost("penpot.example.com"));
});

Deno.test("teams from ids and links", () => {
  assertEquals(parseTeams("123, 456 123"), ["123", "456"]);
  assertEquals(
    parseTeams(
      "https://www.figma.com/files/team/1098765432101234567/Design-Team, https://www.figma.com/files/9876/team/42/Marketing",
    ),
    ["1098765432101234567", "42"],
  );
  assertEquals(parseTeams("not a team"), []);
  assertEquals(parseTeams(undefined), []);
});

Deno.test("penpot addresses", () => {
  assertEquals(normalizePenpot(""), "https://design.penpot.app");
  assertEquals(normalizePenpot("design.penpot.app/#/dashboard/recent"), "https://design.penpot.app");
  assertEquals(normalizePenpot("penpot.local:9001"), "http://penpot.local:9001");
  assertEquals(normalizePenpot("192.168.1.5:9001/api/rpc"), "http://192.168.1.5:9001");
  assertEquals(normalizePenpot("https://nas.lan/penpot/"), "https://nas.lan/penpot");
});

Deno.test("figma projects and files", () => {
  const [p] = figmaProjects("42", { name: "Design Team", projects: [{ id: 7, name: "App" }] });
  assertEquals(p, { tool: "figma", id: "7", name: "App", team: "Design Team", teamId: "42" });
  const files = figmaFiles(p, {
    files: [
      {
        key: "AbC123",
        name: "Onboarding (v2)",
        thumbnail_url: "https://s3-alpha.figma.com/thumbnails/x",
        last_modified: "2026-10-28T09:00:00Z",
      },
      { key: "Def456", name: "Old", thumbnail_url: null, last_modified: "bad" },
    ],
  });
  assertEquals(files[0].modified, Date.parse("2026-10-28T09:00:00Z"));
  assertEquals(files[0].thumbnail, "https://s3-alpha.figma.com/thumbnails/x");
  assertEquals(files[1].thumbnail, undefined);
  assertEquals(files[1].modified, 0);
  assertEquals(figmaUrl(files[0]), "https://www.figma.com/file/AbC123/Onboarding-v2");
  assertEquals(figmaDesktopUrl(files[0]), "figma://file/AbC123/Onboarding-v2");
  assertEquals(slug("Écran d'accueil ✨"), "Ecran-d-accueil");
  assertEquals(slug("✨"), "Untitled");
});

Deno.test("penpot: kebab-case (1.x) and camelCase (2.x) answers", () => {
  assertEquals(pick({ "team-id": "a" }, "team-id"), "a");
  assertEquals(pick({ teamId: "b" }, "team-id"), "b");
  const projects = penpotProjects([
    {
      id: "p1",
      name: "Drafts",
      "team-id": "t1",
      "team-name": "Default",
      "is-default": true,
      "is-default-team": true,
      "modified-at": "2026-10-01T00:00:00Z",
    },
    {
      id: "p2",
      name: "Website",
      teamId: "t2",
      teamName: "Studio",
      isDefault: false,
      modifiedAt: "2026-10-20T00:00:00Z",
      count: 3,
    },
  ]);
  assertEquals(projects.map((p) => [p.name, p.team, p.teamId, p.files]), [
    ["Drafts", "Your Penpot", "t1", undefined],
    ["Website", "Studio", "t2", 3],
  ]);
  const files = penpotFiles(projects[1], [
    { id: "f1", name: "Home", modifiedAt: "2026-10-27T10:00:00Z", isShared: true },
    { id: "f2", name: "Gone", "modified-at": "2026-10-27T10:00:00Z", "deleted-at": "2026-10-28T00:00:00Z" },
  ]);
  assertEquals(files.map((f) => [f.id, f.shared, f.project, f.teamId]), [["f1", true, "Website", "t2"]]);
  assertEquals(
    penpotUrl("https://design.penpot.app", files[0]),
    "https://design.penpot.app/#/workspace?team-id=t2&file-id=f1",
  );
});

Deno.test("sorting with recently opened files first", () => {
  const f = (id: string, modified: number): DesignFile => ({
    tool: "figma",
    id,
    name: id,
    modified,
    project: "P",
    projectId: "1",
    team: "T",
    teamId: "2",
  });
  const files = [f("a", 1), f("b", 3), f("c", 2)];
  assertEquals(sortFiles(files).map((x) => x.id), ["b", "c", "a"]);
  assertEquals(sortFiles(files, ["figma:a"]).map((x) => x.id), ["a", "b", "c"]);
  assertEquals(remember(["figma:a", "figma:b"], "figma:b"), ["figma:b", "figma:a"]);
  assertEquals(remember(["1", "2", "3"], "4", 3), ["4", "1", "2"]);
});

Deno.test("ages", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  assertEquals(ago(now - 20_000, now), "just now");
  assertEquals(ago(now - 5 * 60_000, now), "5 minutes ago");
  assertEquals(ago(now - 3600_000, now), "1 hour ago");
  assertEquals(ago(now - 30 * 3600_000, now), "yesterday");
  assertEquals(ago(now - 4 * 86400_000, now), "4 days ago");
  assertEquals(ago(0, now), "unknown");
  assertEquals(shortAge(now - 2 * 3600_000, now), "2h");
  assertEquals(shortAge(now - 3 * 86400_000, now), "3d");
});

Deno.test("errors", () => {
  assertEquals(
    apiError("figma", 403, { status: 403, err: "Invalid token" }),
    "Figma refused the token: generate a new one in Settings → Security",
  );
  assertEquals(
    apiError("figma", 403, { err: "Invalid scope(s): projects:read" }),
    "Figma: the token lacks a scope (Invalid scope(s): projects:read)",
  );
  assertEquals(apiError("figma", 404, {}), "Figma doesn't know this team: check the team IDs in Settings");
  assertEquals(
    apiError("penpot", 400, { type: "validation", code: "params-validation", hint: "bad project-id" }),
    "Penpot answered 400: bad project-id",
  );
  assertEquals(
    apiError("penpot", 401, undefined),
    "Penpot refused the access token: generate a new one in Your account → Access tokens",
  );
});

Deno.test("pool keeps the order and the limit", async () => {
  let running = 0, peak = 0;
  const out = await pool([30, 10, 20, 5, 1], 2, async (ms) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, ms));
    running--;
    return ms * 2;
  });
  assertEquals(out, [60, 20, 40, 10, 2]);
  assertEquals(peak, 2);
  assertEquals(await pool([], 3, () => Promise.resolve(1)), []);
});
