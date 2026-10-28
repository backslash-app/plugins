import { assertEquals } from "@std/assert";
import {
  dedupe,
  formatPlaytime,
  formatSize,
  heroicGame,
  heroicInstalled,
  heroicLibrary,
  heroicPlaytimes,
  isTool,
  libraryFolders,
  lutrisGame,
  parseAppManifest,
  parseDuration,
  parseLooseDate,
  parseLutrisJson,
  parseSize,
  parseVdf,
  playtimes,
  sortGames,
  steamGame,
  tier,
  vdfGet,
} from "./lib.ts";
import { gameItem } from "./items.ts";

const LIBRARY_FOLDERS = `"libraryfolders"
{
	"0"
	{
		"path"		"/home/ada/.local/share/Steam"
		"label"		""
		"contentid"		"1234567890"
		"totalsize"		"0"
		"apps"
		{
			"228980"		"191985384"
			"570"		"40177422336"
		}
	}
	"1"
	{
		"path"		"/mnt/games/SteamLibrary"
		"label"		"Games"
		"apps"
		{
			"1091500"		"70000000000"
		}
	}
}
`;

const OLD_LIBRARY_FOLDERS = `"LibraryFolders"
{
	"TimeNextStatsReport"		"1600000000"
	"ContentStatsID"		"-123"
	"1"		"/media/ada/Big/SteamLibrary"
}`;

const MANIFEST = `"AppState"
{
	"appid"		"570"
	"Universe"		"1"
	"name"		"Dota 2"
	"StateFlags"		"4"
	"installdir"		"dota 2 beta"
	"LastUpdated"		"1761500000"
	"LastPlayed"		"1761600000"
	"SizeOnDisk"		"40177422336"
	"buildid"		"20123456"
	"UserConfig"
	{
		"language"		"english"
	}
	"InstalledDepots"
	{
		"373301"
		{
			"manifest"		"123"
			"size"		"456"
		}
	}
}`;

const LOCALCONFIG = `"UserLocalConfigStore"
{
	"Software"
	{
		"Valve"
		{
			"Steam"
			{
				"apps"
				{
					"570"
					{
						"LastPlayed"		"1761700000"
						"Playtime"		"6012"
						"cloud" { "last_sync_state" "synchronized" }
					}
					"440"
					{
						"Playtime2wks"		"0"
					}
				}
			}
		}
	}
}`;

Deno.test("VDF: nesting, escapes, comments, conditions, bare tokens", () => {
  const v = parseVdf(`// a comment
"Root"
{
  "quoted"  "say \\"hi\\" \\\\ there"
  bare  value
  "cond"  "1"  [$WIN32]
  "empty" ""
  "child" { "a" "1" }
  "child" { "b" "2" }
}`);
  assertEquals(vdfGet(v, "root", "QUOTED"), 'say "hi" \\ there');
  assertEquals(vdfGet(v, "Root", "bare"), "value");
  assertEquals(vdfGet(v, "Root", "cond"), "1");
  assertEquals(vdfGet(v, "Root", "empty"), "");
  // Later duplicates win.
  assertEquals(vdfGet(v, "Root", "child"), { b: "2" });
  assertEquals(vdfGet(v, "Root", "missing", "deeper"), undefined);
  assertEquals(parseVdf(""), {});
  assertEquals(parseVdf('"unterminated" {'), { unterminated: {} });
});

Deno.test("Steam library folders, both formats", () => {
  assertEquals(libraryFolders(LIBRARY_FOLDERS), [
    { path: "/home/ada/.local/share/Steam", apps: { "228980": 191985384, "570": 40177422336 } },
    { path: "/mnt/games/SteamLibrary", apps: { "1091500": 70000000000 } },
  ]);
  assertEquals(libraryFolders(OLD_LIBRARY_FOLDERS), [{ path: "/media/ada/Big/SteamLibrary", apps: {} }]);
  assertEquals(libraryFolders("garbage"), []);
});

Deno.test("app manifests and play times", () => {
  const app = parseAppManifest(MANIFEST)!;
  assertEquals(app, {
    appid: "570",
    name: "Dota 2",
    installdir: "dota 2 beta",
    sizeOnDisk: 40177422336,
    lastPlayed: 1761600000000,
    lastUpdated: 1761500000000,
    buildId: "20123456",
    stateFlags: 4,
  });
  assertEquals(parseAppManifest('"AppState" { "appid" "1" }'), undefined);
  const played = playtimes(LOCALCONFIG);
  assertEquals(played.get("570"), { lastPlayed: 1761700000000, minutes: 6012 });
  assertEquals(played.has("440"), false);
  const game = steamGame(app, "/home/ada/.local/share/Steam", played.get("570"));
  assertEquals(game.launch, "steam://rungameid/570");
  assertEquals(game.lastPlayed, 1761700000000);
  assertEquals(game.installDir, "/home/ada/.local/share/Steam/steamapps/common/dota 2 beta");
  assertEquals(
    [isTool({ appid: "1493710", name: "Proton Experimental" }), isTool({ appid: "9", name: "Proton 9.0" })],
    [
      true,
      true,
    ],
  );
  assertEquals(isTool({ appid: "1628350", name: "x" }), true);
  assertEquals(isTool(app), false);
});

Deno.test("Lutris", () => {
  const out =
    `2026-10-28 10:00:00,000: Startup info\n[{"id": 3, "slug": "gog-witcher-3", "name": "The Witcher 3", "runner": "wine", ` +
    `"platform": "Windows", "year": 2015, "directory": "/home/ada/Games/witcher3", "playtime": "12:30:00", ` +
    `"lastplayed": "10/27/26 14:03:00"}, {"id": 4, "slug": "", "name": "broken"}]`;
  const games = parseLutrisJson(out);
  assertEquals(games.length, 1);
  const g = lutrisGame(games[0]);
  assertEquals([g.id, g.launch, g.runner, g.platform, g.year], [
    "lutris:gog-witcher-3",
    "lutris:rungame/gog-witcher-3",
    "wine",
    "Windows",
    2015,
  ]);
  assertEquals(g.playtimeMinutes, 750);
  assertEquals(g.lastPlayed, new Date(2026, 9, 27, 14, 3).getTime());
  assertEquals(parseLutrisJson("no json here"), []);
  assertEquals([parseDuration("1 day, 2:00:00"), parseDuration(2.5), parseDuration("3 hours 5 minutes")], [
    1560,
    150,
    185,
  ]);
  assertEquals([parseDuration(null), parseDuration("0:00:00")], [undefined, undefined]);
  assertEquals(parseLooseDate("27/10/2026 08:00"), new Date(2026, 9, 27, 8).getTime());
  assertEquals(parseLooseDate(1761600000), 1761600000000);
  assertEquals(parseLooseDate("2026-10-27T10:00:00.000Z"), Date.UTC(2026, 9, 27, 10));
});

Deno.test("Heroic: Epic, GOG and Amazon libraries", () => {
  const epic = heroicLibrary({
    library: [
      {
        app_name: "Fortnite",
        title: "Fortnite",
        is_installed: true,
        art_square: "https://cdn1.epicgames.com/offer/fn/square.jpg",
        install: { install_path: "/home/ada/Games/Heroic/Fortnite", install_size: "31.2 GiB", platform: "Windows" },
      },
      { app_name: "Other", title: "Not installed", is_installed: false },
      { title: "no app name" },
    ],
  });
  assertEquals(epic.length, 2);
  const gog = heroicLibrary({ games: [{ app_name: "1207658924", title: "Unreal Tournament", is_installed: false }] });
  const installed = heroicInstalled({
    installed: [{ appName: "1207658924", install_path: "/games/ut", install_size: "620 MiB", platform: "linux" }],
  });
  assertEquals(installed.get("1207658924"), { path: "/games/ut", size: 650117120, platform: "linux" });
  const legendary = heroicInstalled({
    Fortnite: { app_name: "Fortnite", install_path: "/x", install_size: 33500000000 },
  });
  assertEquals(legendary.get("Fortnite")?.size, 33500000000);
  const played = heroicPlaytimes({
    Fortnite: { firstPlayed: "2026-01-01T00:00:00.000Z", lastPlayed: "2026-10-20T20:00:00.000Z", totalPlayed: 95 },
  });
  const g = heroicGame(epic[0], "legendary", undefined, played.get("Fortnite"));
  assertEquals(g.launch, "heroic://launch?appName=Fortnite&runner=legendary");
  assertEquals([g.runner, g.platform, g.sizeBytes, g.playtimeMinutes], ["Epic Games", "Windows", 33500744909, 95]);
  assertEquals(g.lastPlayed, Date.UTC(2026, 9, 20, 20));
  assertEquals(heroicGame(gog[0], "gog", installed.get("1207658924")).installDir, "/games/ut");
});

Deno.test("sizes, durations, ordering", () => {
  assertEquals([formatSize(40177422336), formatSize(650117120), formatSize(512), formatSize(0)], [
    "37.4 GB",
    "620 MB",
    "512 B",
    undefined,
  ]);
  assertEquals([parseSize("12,5 GB"), parseSize("100"), parseSize("abc")], [13421772800, 100, undefined]);
  assertEquals([formatPlaytime(45), formatPlaytime(90), formatPlaytime(6012), formatPlaytime(0)], [
    "45 min",
    "1.5 h",
    "100 h",
    undefined,
  ]);
  const a = { id: "a", source: "steam" as const, title: "Alpha", launch: "", lastPlayed: 1 };
  const b = { id: "b", source: "steam" as const, title: "Beta", launch: "", lastPlayed: 5 };
  const c = { id: "c", source: "lutris" as const, title: "Charlie", launch: "" };
  assertEquals(sortGames([c, a, b]).map((g) => g.id), ["b", "a", "c"]);
  const dup = { id: "l", source: "lutris" as const, title: "alpha!", launch: "", runner: "steam" };
  assertEquals(dedupe([dup, a]).map((g) => g.id), ["a"]);
});

Deno.test("ProtonDB tiers and the game item", () => {
  assertEquals(tier("platinum"), { label: "Platinum", color: "teal" });
  assertEquals(tier("borked")?.color, "red");
  assertEquals(tier("unknownish")?.label, "Unknownish");
  assertEquals(tier(undefined), undefined);
  const app = parseAppManifest(MANIFEST)!;
  const game = { ...steamGame(app, "/s", { minutes: 6012 }), cover: "/s/appcache/librarycache/570_header.jpg" };
  const item = gameItem(
    game,
    { tier: "gold", trendingTier: "platinum", confidence: "strong", total: 1200 },
    1761700000000,
  );
  assertEquals(item.icon, { source: "bs-gamepad", tint: "blue" });
  assertEquals(item.accessories?.[0], { tag: "Gold", color: "yellow", tooltip: "ProtonDB rating" });
  assertEquals(item.detail?.image, "/s/appcache/librarycache/570_header.jpg");
  assertEquals(item.detail?.stats?.map((s) => s.label), ["Size", "Played", "Last played", "ProtonDB"]);
  assertEquals(item.detail?.stats?.[3].color, "yellow");
  const proton = item.detail?.metadata?.find((m) => m.label === "ProtonDB");
  assertEquals(proton?.tags, [{ text: "Gold", color: "yellow" }, { text: "trending Platinum", color: "teal" }]);
  const titles = item.actions?.map((a) => a.title);
  assertEquals(titles?.slice(0, 4), ["Play", "Show in Steam Library", "Open Store Page", "Open on ProtonDB"]);
  assertEquals(item.actions?.find((a) => a.title === "Uninstall")?.destructive, true);
});
