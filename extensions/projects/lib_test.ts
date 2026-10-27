import { assertEquals } from "@std/assert";
import { gitStatus, jetbrainsProduct, jetbrainsRecents, merge, remotePage, vscodeRecents, zedPaths } from "./lib.ts";

Deno.test("vscode recents", () => {
  const json = JSON.stringify({
    entries: [
      { folderUri: "file:///home/me/my%20app" },
      { fileUri: "file:///home/me/notes.md" },
      { folderUri: "vscode-remote://ssh-remote+box/srv" },
      { workspace: { configPath: "file:///home/me/ws.code-workspace" } },
    ],
  });
  assertEquals(vscodeRecents(json, "VS Code", "code").map((r) => r.path), [
    "/home/me/my app",
    "/home/me/ws.code-workspace",
  ]);
});

Deno.test("jetbrains recents", () => {
  const xml = `<application><component name="RecentProjectsManager"><option name="additionalInfo"><map>
    <entry key="$USER_HOME$/code/api"><value><RecentProjectMetaInfo><option name="projectOpenTimestamp" value="1700000000000" /></RecentProjectMetaInfo></value></entry>
    <entry key="/srv/tool"><value><RecentProjectMetaInfo /></value></entry>
  </map></option></component></application>`;
  const r = jetbrainsRecents(xml, "/home/me", "PyCharm", "pycharm");
  assertEquals(r.map((x) => [x.path, x.opened]), [["/home/me/code/api", 1700000000000], ["/srv/tool", 0]]);
  assertEquals(jetbrainsProduct("PyCharm2025.2"), ["PyCharm", "pycharm"]);
  assertEquals(jetbrainsProduct("Toolbox"), undefined);
});

Deno.test("zed paths and merging", () => {
  assertEquals(zedPaths('["/home/me/a","/home/me/b/"]'), ["/home/me/a", "/home/me/b"]);
  const m = merge([
    { path: "/a", opened: 1, editor: "Zed", command: "zed" },
    { path: "/a", opened: 5, editor: "VS Code", command: "code" },
  ]);
  assertEquals(m.map((r) => r.editor), ["VS Code"]);
});

Deno.test("remotes and status", () => {
  assertEquals(remotePage("git@github.com:me/app.git"), "https://github.com/me/app");
  assertEquals(remotePage("https://token@gitlab.com/me/app.git"), "https://gitlab.com/me/app");
  assertEquals(gitStatus("## main...origin/main [ahead 2]\n M a.ts\n?? b.ts\n"), {
    branch: "main",
    changes: 2,
    ahead: 2,
  });
});
