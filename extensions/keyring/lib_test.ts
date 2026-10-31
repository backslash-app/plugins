import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  age,
  attributeArgs,
  attributeTable,
  collectionOf,
  explain,
  lookupIsUnique,
  parseBusctl,
  parseGdbus,
  parseGVariant,
  parseSearch,
  pathName,
  schemaInfo,
  type SecretItem,
  summary,
  titleOf,
  toCollection,
  toItem,
  unwrapVariants,
} from "./lib.ts";

const LOGIN = "/org/freedesktop/secrets/collection/login";

// busctl --user --json=short call org.freedesktop.secrets /org/freedesktop/secrets \
//   org.freedesktop.DBus.Properties Get ss org.freedesktop.Secret.Service Collections
const BUSCTL_COLLECTIONS =
  `{"type":"v","data":[{"type":"ao","data":["/org/freedesktop/secrets/collection/login","/org/freedesktop/secrets/collection/session"]}]}`;

// … GetAll s org.freedesktop.Secret.Item
const BUSCTL_ITEM =
  `{"type":"a{sv}","data":[{"Locked":{"type":"b","data":false},"Attributes":{"type":"a{ss}","data":{"xdg:schema":"org.gnome.keyring.NetworkPassword","user":"ada","server":"github.com","protocol":"https"}},"Label":{"type":"s","data":"GitHub"},"Created":{"type":"t","data":1700000000},"Modified":{"type":"t","data":1710000000}}]}`;

const BUSCTL_UNLOCK = `{"type":"aoo","data":[[],"/org/freedesktop/secrets/prompt/u1"]}`;

// gdbus call --session --dest org.freedesktop.secrets --object-path … --method org.freedesktop.DBus.Properties.GetAll org.freedesktop.Secret.Collection
const GDBUS_COLLECTION =
  `({'Items': <[objectpath '/org/freedesktop/secrets/collection/login/1', '/org/freedesktop/secrets/collection/login/2']>, 'Label': <'Login'>, 'Locked': <false>, 'Created': <uint64 1650000000>, 'Modified': <uint64 1720000000>},)`;

const GDBUS_ITEM =
  `({'Locked': <true>, 'Attributes': <{'xdg:schema': 'org.gnome.keyring.Note', 'note': 'it\\'s "quoted"'}>, 'Label': <'Wi\\u00e9 note'>, 'Created': <uint64 1690000000>, 'Modified': <uint64 0>},)`;

Deno.test("busctl JSON: variants and out arguments", () => {
  assertEquals(parseBusctl(BUSCTL_COLLECTIONS), [[`${LOGIN}`, "/org/freedesktop/secrets/collection/session"]]);
  const [props] = parseBusctl(BUSCTL_ITEM);
  const item = toItem(`${LOGIN}/3`, unwrapVariants(props));
  assertEquals(item, {
    path: `${LOGIN}/3`,
    collection: LOGIN,
    label: "GitHub",
    attributes: {
      "xdg:schema": "org.gnome.keyring.NetworkPassword",
      user: "ada",
      server: "github.com",
      protocol: "https",
    },
    locked: false,
    created: 1700000000,
    modified: 1710000000,
  });
  assertEquals(parseBusctl(BUSCTL_UNLOCK), [[], "/org/freedesktop/secrets/prompt/u1"]);
  assertEquals(parseBusctl(`{"type":"o","data":["/"]}`), ["/"]);
  assertEquals(parseBusctl(""), []);
});

Deno.test("gdbus GVariant text", () => {
  const [props] = parseGdbus(GDBUS_COLLECTION);
  const c = toCollection(LOGIN, props as Record<string, unknown>, LOGIN);
  assertEquals(c.label, "Login");
  assertEquals(c.items.length, 2);
  assertEquals(c.created, 1650000000);
  assertEquals(c.isDefault, true);

  const item = toItem(`${LOGIN}/2`, parseGdbus(GDBUS_ITEM)[0] as Record<string, unknown>);
  assertEquals(item.label, "Wié note");
  assertEquals(item.attributes.note, `it's "quoted"`);
  assertEquals(item.locked, true);
  assertEquals(item.modified, undefined);

  assertEquals(parseGVariant("(@ao [], objectpath '/')"), [[], "/"]);
  assertEquals(parseGVariant("({'a': <@a{ss} {}>, 'n': <int32 -3>, 'b': <byte 0x41>},)"), [{ a: {}, n: -3, b: 65 }]);
  assertEquals(parseGVariant("('/org/freedesktop/secrets/aliases/default',)"), [
    "/org/freedesktop/secrets/aliases/default",
  ]);
  assertEquals(parseGVariant(`("double \\"quoted\\"",)`), [`double "quoted"`]);
  assertThrows(() => parseGVariant("({'a': <'x'"), Error, "Unexpected gdbus output");
});

Deno.test("collections: label falls back to the path, the empty session is a collection like another", () => {
  const c = toCollection("/org/freedesktop/secrets/collection/_32021_20Passwords", { Locked: true });
  assertEquals(c.label, "2021 Passwords");
  assertEquals(c.locked, true);
  assertEquals(c.items, []);
  assertEquals(pathName("/org/freedesktop/secrets/collection/kdewallet"), "kdewallet");
  assertEquals(collectionOf(`${LOGIN}/12`), LOGIN);
});

const SEARCH = `[/org/freedesktop/secrets/collection/login/3]
label = GitHub
secret = hunter2
created = 2024-03-02 10:11:12
modified = 2024-03-02 10:11:12
schema = org.gnome.keyring.NetworkPassword
attribute.protocol = https
attribute.server = github.com
attribute.user = ada
[/org/freedesktop/secrets/collection/login/7]
label = SSH key passphrase
secret = line one
line two = not an attribute
created = 2024-05-01 08:00:00
modified = 2024-05-01 08:00:00
attribute.unique = ssh-store:/home/ada/.ssh/id_ed25519
[/org/freedesktop/secrets/collection/login/9]
label = Empty
secret =
created = 2024-05-01 08:00:00
`;

Deno.test("secret-tool search output, multi-line and empty secrets", () => {
  const found = parseSearch(SEARCH);
  assertEquals(found.length, 3);
  assertEquals(found[0], {
    path: `${LOGIN}/3`,
    label: "GitHub",
    secret: "hunter2",
    attributes: {
      "xdg:schema": "org.gnome.keyring.NetworkPassword",
      protocol: "https",
      server: "github.com",
      user: "ada",
    },
  });
  assertEquals(found[1].secret, "line one\nline two = not an attribute");
  assertEquals(found[1].attributes.unique, "ssh-store:/home/ada/.ssh/id_ed25519");
  assertEquals(found[2].secret, "");
  assertEquals(parseSearch(""), []);
});

const item = (path: string, attributes: Record<string, string>, label = ""): SecretItem => ({
  path,
  collection: collectionOf(path),
  label,
  attributes,
  locked: false,
});

Deno.test("lookup only when the attributes find this item alone", () => {
  const a = item(`${LOGIN}/1`, { service: "github", user: "ada" });
  const b = item(`${LOGIN}/2`, { service: "github", user: "ada", scope: "repo" });
  const c = item(`${LOGIN}/3`, { service: "gitlab" });
  // b has all of a's attributes: lookup with a's could return b.
  assert(!lookupIsUnique(a, [a, b, c]));
  assert(lookupIsUnique(b, [a, b, c]));
  assert(lookupIsUnique(c, [a, b, c]));
  assert(!lookupIsUnique(item(`${LOGIN}/4`, {}), [a]));
  assertEquals(attributeArgs({ service: "github", user: "ada" }), ["service", "github", "user", "ada"]);
});

Deno.test("what an item is for", () => {
  const gh = item(`${LOGIN}/1`, {
    "xdg:schema": "org.gnome.keyring.NetworkPassword",
    user: "ada",
    server: "github.com",
  });
  assertEquals(schemaInfo(gh).name, "Network password");
  assertEquals(summary(gh), "ada @ github.com");
  const chrome = item(
    `${LOGIN}/2`,
    { "xdg:schema": "chrome_libsecret_os_crypt_password_v2", application: "chrome" },
    "Chrome Safe Storage",
  );
  assertEquals(schemaInfo(chrome), { name: "Browser Safe Storage", app: true });
  const chromium = item(`${LOGIN}/5`, { application: "chromium" }, "Chromium Safe Storage");
  assertEquals(schemaInfo(chromium).app, true);
  const nm = item(`${LOGIN}/3`, {
    "xdg:schema": "org.freedesktop.NetworkManager.connection",
    "connection-uuid": "9b2…",
    "setting-name": "802-11-wireless-security",
    "setting-key": "psk",
  });
  assertEquals(schemaInfo(nm).name, "Network connection");
  const custom = item(`${LOGIN}/4`, { "xdg:schema": "com.example.MyApp.ApiToken", account: "work" });
  assertEquals(schemaInfo(custom).name, "Api Token");
  assertEquals(summary(custom), "work");
  assertEquals(summary(item(`${LOGIN}/6`, { a: "1", b: "2", c: "3" })), "a=1 · b=2");
  assertEquals(titleOf(item(`${LOGIN}/7`, { server: "nas.local" })), "nas.local");
  assertEquals(titleOf(item(`${LOGIN}/8`, {})), "8");
});

Deno.test("attribute table escapes pipes and puts the schema first", () => {
  const md = attributeTable({ user: "a|b", "xdg:schema": "org.gnome.keyring.Note" });
  assertEquals(md.split("\n")[2], "| `xdg:schema` | org.gnome.keyring.Note |");
  assert(md.includes("a\\|b"));
  assert(attributeTable({}).includes("No attributes"));
});

Deno.test("ages and errors", () => {
  const now = Date.parse("2026-10-31T12:00:00Z");
  assertEquals(age(now / 1000 - 3600, now), "today");
  assertEquals(age(now / 1000 - 3 * 86400, now), "3d");
  assertEquals(age(now / 1000 - 800 * 86400, now), "2y");
  assertEquals(
    explain(
      "busctl exited with 1: Call failed: The name org.freedesktop.secrets was not provided by any .service files",
    ),
    "No keyring is running: start GNOME Keyring, KWallet or KeePassXC (with Secret Service integration)",
  );
  assertEquals(
    explain(
      "gdbus exited with 1: Error: GDBus.Error:org.freedesktop.Secret.Error.IsLocked: Cannot delete a locked item",
    ),
    "This keyring is locked: unlock it first",
  );
  assertEquals(explain("secret-tool exited with 1: weird"), "weird");
});
