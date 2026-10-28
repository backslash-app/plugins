import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  hostOf,
  keepassWrongPassword,
  opSignedOut,
  parseBwFolders,
  parseBwItems,
  parseBwStatus,
  parseKeepassList,
  parseKeepassShow,
  parseOpItems,
  parsePassShow,
  parsePassTree,
  passEntries,
  safeError,
  sortEntries,
} from "./lib.ts";

Deno.test("pass entries from the store's files", () => {
  const entries = passEntries([
    { path: "github.com/ada.gpg", modified: 1 },
    { path: "email/fastmail.com.gpg" },
    { path: "wifi.gpg" },
    { path: ".git/config" },
    { path: ".extensions/otp.bash" },
    { path: "notes.txt" },
  ]);
  assertEquals(entries.map((e) => [e.ref, e.title, e.folder, e.username, e.url]), [
    ["email/fastmail.com", "fastmail.com", "email", undefined, "fastmail.com"],
    ["github.com/ada", "ada", "github.com", "ada", "github.com"],
    ["wifi", "wifi", undefined, undefined, undefined],
  ]);
});

Deno.test("pass ls tree", () => {
  const tree = "Password Store\n├── email\n│   └── fastmail.com\n├── github.com\n│   ├── ada\n│   └── bot\n└── wifi\n";
  assertEquals(parsePassTree(tree), ["email/fastmail.com", "github.com/ada", "github.com/bot", "wifi"]);
  const nbsp = "Password Store\n└── a\n    └── b\n";
  assertEquals(parsePassTree(nbsp), ["a/b"]);
  assertEquals(parsePassTree("Password Store\n"), []);
});

Deno.test("pass show content", () => {
  const c = parsePassShow("hunter2\nLogin: ada\nURL: https://x.com\notpauth://totp/x?secret=A\n");
  assertEquals(c, { password: "hunter2", username: "ada", url: "https://x.com", otp: true });
  const fallback = parsePassShow("pw", { backend: "pass", ref: "github.com/ada", title: "ada", username: "ada" });
  assertEquals([fallback.username, fallback.otp], ["ada", false]);
});

Deno.test("Bitwarden status, items and folders: secrets dropped", () => {
  assertEquals(parseBwStatus('{"status":"locked","userEmail":"a@b.c"}'), { status: "locked", email: "a@b.c" });
  assertEquals(parseBwStatus("garbage").status, "unknown");
  const folders = parseBwFolders('[{"id":"f1","name":"Work"},{"id":null,"name":"No Folder"}]');
  assertEquals(folders, { f1: "Work" });
  const items = parseBwItems(
    JSON.stringify([
      {
        id: "1",
        name: "GitHub",
        type: 1,
        folderId: "f1",
        favorite: true,
        revisionDate: "2026-10-01T00:00:00Z",
        login: { username: "ada", password: "SECRET", totp: "otpauth://x", uris: [{ uri: "https://github.com" }] },
      },
      { id: "2", name: "Note", type: 2 },
    ]),
    folders,
  );
  assertEquals(items.length, 1);
  assertEquals([items[0].title, items[0].username, items[0].folder, items[0].totp, items[0].url], [
    "GitHub",
    "ada",
    "Work",
    true,
    "https://github.com",
  ]);
  assert(!JSON.stringify(items).includes("SECRET"));
});

Deno.test("1Password items", () => {
  const items = parseOpItems(JSON.stringify([
    {
      id: "abc",
      title: "Gmail",
      category: "LOGIN",
      additional_information: "ada@gmail.com",
      vault: { id: "v1", name: "Personal" },
      urls: [{ href: "https://accounts.google.com" }, { href: "https://mail.google.com", primary: true }],
    },
    {
      id: "def",
      title: "API",
      category: "API_CREDENTIAL",
      additional_information: "token",
      vault: { id: "v1", name: "P" },
    },
    { id: "ghi", title: "Scan", category: "DOCUMENT" },
  ]));
  assertEquals(items.map((i) => [i.ref, i.username, i.url, i.category]), [
    ["op://v1/abc", "ada@gmail.com", "https://mail.google.com", "Login"],
    ["op://v1/def", undefined, undefined, "Api credential"],
  ]);
  assert(opSignedOut("[ERROR] 2026/10/28 You are not currently signed in."));
  assert(!opSignedOut("[ERROR] item not found"));
});

Deno.test("KeePassXC list and show", () => {
  const entries = parseKeepassList("Internet/\nInternet/GitHub\n  [empty]\nEmail\nRecycle Bin/\nRecycle Bin/Old\n");
  assertEquals(entries.map((e) => [e.ref, e.title, e.folder]), [
    ["Internet/GitHub", "GitHub", "Internet"],
    ["Email", "Email", undefined],
  ]);
  assertEquals(parseKeepassShow("Title: GitHub\nUserName: ada\nURL: https://github.com\nNotes: \n"), {
    Title: "GitHub",
    UserName: "ada",
    URL: "https://github.com",
    Notes: "",
  });
  assert(keepassWrongPassword("Error while reading the database: Invalid credentials were provided"));
});

Deno.test("helpers", () => {
  assertEquals(hostOf("https://www.github.com/login"), "github.com");
  assertEquals(hostOf("github.com"), "github.com");
  assertEquals(hostOf(undefined), undefined);
  assertEquals(safeError("bw", "Invalid session=abc123 given\nmore"), "bw: Invalid session=… given");
  const sorted = sortEntries([
    { backend: "pass", ref: "b", title: "beta" },
    { backend: "pass", ref: "a", title: "Alpha" },
    { backend: "bitwarden", ref: "z", title: "zulu", favorite: true },
  ]);
  assertEquals(sorted.map((e) => e.title), ["zulu", "Alpha", "beta"]);
});

// End to end against fake CLIs (testdata/bin) that behave like the real ones.
Deno.test("backends with fake CLIs", async () => {
  const bin = new URL("./testdata/bin", import.meta.url).pathname;
  Deno.env.set("PATH", `${bin}:${Deno.env.get("PATH")}`);
  const store = await Deno.makeTempDir();
  Deno.env.set("PASSWORD_STORE_DIR", store);
  Deno.env.delete("BW_SESSION");
  const b = await import("./backends.ts");
  const signal = new AbortController().signal;
  const prefs: Record<string, unknown> = { keepassDb: "/tmp/db.kdbx" };
  try {
    await Deno.mkdir(`${store}/github.com`);
    await Deno.writeTextFile(`${store}/github.com/ada.gpg`, "");
    assertEquals((await b.installedBackends()).sort(), ["1password", "bitwarden", "keepassxc", "pass"]);

    // pass: listed from the files, decrypted on demand.
    const pass = await b.load("pass", prefs, signal);
    assert(pass.state === "ready");
    assertEquals(pass.entries.map((e) => e.ref), ["github.com/ada"]);
    assertEquals(await b.reveal(pass.entries[0], "password", prefs), "s3cr3t-github.com/ada");
    assertEquals(await b.reveal(pass.entries[0], "username", prefs), "ada@example.com");
    assertEquals(await b.hasPassOtp(), true);
    assertEquals(await b.reveal(pass.entries[0], "totp", prefs), "123456");

    // Bitwarden: locked until unlocked with the master password.
    assertEquals((await b.load("bitwarden", prefs, signal)).state, "locked");
    await assertRejects(() => b.bwUnlock("wrong"), Error, "Invalid master password");
    await b.bwUnlock("hunter2");
    const bw = await b.load("bitwarden", prefs, signal);
    assert(bw.state === "ready");
    assertEquals(bw.entries.map((e) => [e.title, e.folder, e.totp]), [["GitHub", "Work", true]]);
    assertEquals(await b.reveal(bw.entries[0], "password", prefs), "pw-i1");
    assertEquals(await b.reveal(bw.entries[0], "totp", prefs), "654321");
    b.bwLock();
    assertEquals((await b.load("bitwarden", prefs, signal)).state, "locked");

    // 1Password: op read with the item's reference.
    const op = await b.load("1password", prefs, signal);
    assert(op.state === "ready");
    assertEquals(await b.reveal(op.entries[0], "password", prefs), "op-secret-for-op://v1/abc/password");
    assertEquals(await b.reveal(op.entries[0], "totp", prefs), "112233");

    // KeePassXC: the password goes on stdin and stays in memory.
    assertEquals((await b.load("keepassxc", {}, signal)).state, "unconfigured");
    assertEquals((await b.load("keepassxc", prefs, signal)).state, "locked");
    await assertRejects(() => b.keepassUnlock(prefs, "nope"), Error, "Wrong password");
    assertEquals(await b.keepassUnlock(prefs, "kdbx-pass"), 3);
    const kp = await b.load("keepassxc", prefs, signal);
    assert(kp.state === "ready");
    assertEquals(kp.entries.map((e) => e.ref), ["Internet/GitHub", "Internet/Forum", "Email"]);
    assertEquals(await b.reveal(kp.entries[0], "password", prefs), "kp-Internet/GitHub");
    assertEquals(await b.reveal(kp.entries[0], "username", prefs), "ada-Internet/GitHub");
    assertEquals(await b.reveal(kp.entries[0], "totp", prefs), "998877");
    b.keepassLock();
    await assertRejects(() => b.reveal(kp.entries[0], "password", prefs), Error, "Unlock");

    // Items carry no secret: every secret action is a callback.
    const { entryItem } = await import("./ui.ts");
    const item = entryItem(bw.entries[0], { prefs, several: true, passOtp: true });
    assertEquals(item.actions?.map((a) => a.title).slice(0, 5), [
      "Copy Password",
      "Paste Password",
      "Copy Username",
      "Paste Username",
      "Copy One-Time Code",
    ]);
    assert(!JSON.stringify(item).includes("pw-"));
  } finally {
    await Deno.remove(store, { recursive: true });
  }
});
