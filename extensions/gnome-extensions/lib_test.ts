import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  compact,
  compareShell,
  descriptionMarkdown,
  EGO,
  infoUrl,
  installArgs,
  isGnomeDesktop,
  look,
  parseBool,
  parseDetails,
  parseInstallResult,
  parseQuery,
  parseShellVersion,
  parseUuids,
  queryUrl,
  shellError,
  sortExtensions,
} from "./lib.ts";

const HOME = "/home/ada";

// GNOME 45+: "Enabled: Yes" and ACTIVE/INACTIVE states; a description on two lines.
const DETAILS = `appindicatorsupport@rgcjonas.gmail.com
  Name: AppIndicator and KStatusNotifierItem Support
  Description: Adds AppIndicator, KStatusNotifierItem and legacy Tray icons support to the Shell
  Path: /usr/share/gnome-shell/extensions/appindicatorsupport@rgcjonas.gmail.com
  URL: https://github.com/ubuntu/gnome-shell-extension-appindicator
  Version: 58
  Enabled: Yes
  State: ACTIVE

dash-to-dock@micxgx.gmail.com
  Name: Dash to Dock
  Description: A dock for the Gnome Shell.
This extension moves the dash out of the overview.
  Path: /home/ada/.local/share/gnome-shell/extensions/dash-to-dock@micxgx.gmail.com
  URL: https://micheleg.github.io/dash-to-dock/
  Version: 89.0 (89)
  Enabled: No
  State: INACTIVE

blur-my-shell@aunetx
  Name: Blur my Shell
  Description: Adds a blur look to different parts of the GNOME Shell
  Path: /home/ada/.local/share/gnome-shell/extensions/blur-my-shell@aunetx
  Version: 47
  Enabled: Yes
  State: OUT OF DATE
`;

// GNOME 3.36 to 44: no "Enabled" line, ENABLED/DISABLED states.
const OLD = `ding@rastersoft.com
  Name: Desktop Icons NG (DING)
  Description: Adds icons to the desktop.
  Path: /usr/share/gnome-shell/extensions/ding@rastersoft.com
  URL: https://gitlab.com/rastersoft/desktop-icons-ng
  Original author: rastersoft@gmail.com
  Version: 46
  State: ENABLED

user-theme@gnome-shell-extensions.gcampax.github.com
  Name: User Themes
  Description: Load shell themes from user directory.
  Path: /usr/share/gnome-shell/extensions/user-theme@gnome-shell-extensions.gcampax.github.com
  URL: https://gitlab.gnome.org/GNOME/gnome-shell-extensions
  Version: 49
  State: ERROR
`;

const QUERY = `{
  "extensions": [
    {"uuid": "dash-to-dock@micxgx.gmail.com", "name": "Dash to Dock", "creator": "michele_g",
     "creator_url": "/accounts/profile/michele_g", "pk": 307,
     "description": "A dock for the Gnome Shell.\\nThis extension moves the dash out of the overview.",
     "link": "/extension/307/dash-to-dock/", "icon": "/extension-data/icons/icon_307.png",
     "screenshot": "/extension-data/screenshots/screenshot_307.png", "downloads": 9876543,
     "url": "https://micheleg.github.io/dash-to-dock/",
     "shell_version_map": {"45": {"pk": 40000, "version": 88}, "46": {"pk": 41000, "version": 89, "version_name": "89"},
       "3.38": {"pk": 20000, "version": 71}}},
    {"uuid": "caffeine@patapon.info", "name": "Caffeine", "creator": "eon", "pk": 517,
     "description": "Disable the screensaver and auto suspend", "link": "/extension/517/caffeine/",
     "icon": "/static/images/plugin.png", "screenshot": null,
     "shell_version_map": {"46": {"pk": 42000, "version": 53}}}
  ],
  "total": 2,
  "numpages": 1
}`;

Deno.test("details, GNOME 45 and later", () => {
  const list = parseDetails(DETAILS, HOME);
  assertEquals(list.length, 3);
  const [ai, dock, blur] = list;
  assertEquals(ai.name, "AppIndicator and KStatusNotifierItem Support");
  assertEquals(ai.enabled, true);
  assertEquals(ai.user, false);
  assertEquals(ai.version, "58");
  assertEquals(look(ai), "on");
  assertEquals(dock.description, "A dock for the Gnome Shell.\nThis extension moves the dash out of the overview.");
  assertEquals(dock.enabled, false);
  assertEquals(dock.user, true);
  assertEquals(dock.version, "89.0 (89)");
  assertEquals(look(dock), "off");
  assertEquals(look(blur), "outdated");
  assertEquals(blur.url, undefined);
  assertEquals(sortExtensions(list).map((e) => e.uuid), [
    "blur-my-shell@aunetx",
    "appindicatorsupport@rgcjonas.gmail.com",
    "dash-to-dock@micxgx.gmail.com",
  ]);
});

Deno.test("details, older Shells", () => {
  const [ding, theme] = parseDetails(OLD, HOME);
  assertEquals(ding.enabled, true);
  assertEquals(ding.author, "rastersoft@gmail.com");
  assertEquals(theme.enabled, false);
  assertEquals(look(theme), "error");
  assertEquals(parseDetails("", HOME), []);
});

Deno.test("small outputs", () => {
  assertEquals([...parseUuids("a@b\n\nc@d\n")], ["a@b", "c@d"]);
  assertEquals(parseShellVersion("GNOME Shell 46.2\n"), "46");
  assertEquals(parseShellVersion("GNOME Shell 3.38.4"), "3.38");
  assertEquals(parseShellVersion("bash: gnome-shell: not found"), undefined);
  assertEquals(parseBool("true\n"), true);
  assertEquals(parseBool("false"), false);
  assertEquals(parseInstallResult("('successful',)\n"), "successful");
  assertEquals(parseInstallResult("('cancelled',)"), "cancelled");
  assert(isGnomeDesktop("ubuntu:GNOME"));
  assert(isGnomeDesktop("GNOME"));
  assert(isGnomeDesktop("GNOME-Classic:GNOME"));
  assert(!isGnomeDesktop("KDE"));
  assert(!isGnomeDesktop(undefined));
  assertEquals(
    shellError("Failed to connect to GNOME Shell\n"),
    "GNOME Shell isn't answering: this works in a GNOME session",
  );
  assertEquals(compact(950), "950");
  assertEquals(compact(12345), "12k");
  assertEquals(compact(9876543), "9.9M");
  assertEquals(descriptionMarkdown("Use *this*\nnow"), "Use \\*this\\*  \nnow");
});

Deno.test("extensions.gnome.org", () => {
  const { extensions, total } = parseQuery(QUERY, "46");
  assertEquals(total, 2);
  const [dock, caffeine] = extensions;
  assertEquals(dock.link, `${EGO}/extension/307/dash-to-dock/`);
  assertEquals(dock.icon, `${EGO}/extension-data/icons/icon_307.png`);
  assertEquals(dock.screenshot, `${EGO}/extension-data/screenshots/screenshot_307.png`);
  assertEquals(dock.shells, ["3.38", "45", "46"]);
  assertEquals(dock.version, "89 (89)");
  assertEquals(caffeine.icon, undefined); // the default puzzle piece
  assertEquals(caffeine.screenshot, undefined);
  assertEquals(caffeine.version, "53");
  assertEquals(parseQuery(QUERY, "47").extensions[0].version, undefined);
  assertEquals(compareShell("3.38", "40") < 0, true);
  assertEquals(
    queryUrl("dash to dock", "46"),
    `${EGO}/extension-query/?search=dash+to+dock&shell_version=46&page=1`,
  );
  assertEquals(queryUrl("", undefined), `${EGO}/extension-query/?sort=popularity&page=1`);
  assertEquals(infoUrl("a@b.c"), `${EGO}/extension-info/?uuid=a%40b.c`);
  const args = installArgs("dash-to-dock@micxgx.gmail.com");
  assertEquals(args.at(-1), "'dash-to-dock@micxgx.gmail.com'");
  assertEquals(args.at(-2), "org.gnome.Shell.Extensions.InstallRemoteExtension");
});

Deno.test("manifest: net host and programs", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { run: string[]; net: string[] };
    commands: { name: string }[];
  };
  assertEquals(manifest.permissions.net, [new URL(EGO).host]);
  for (const p of ["gnome-extensions", "gnome-shell", "gsettings", "gdbus"]) {
    assert(manifest.permissions.run.includes(p), `${p} is not in run`);
  }
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
