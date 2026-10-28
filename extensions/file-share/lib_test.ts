import { assert, assertEquals, assertNotEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { parse } from "@std/toml";
import {
  allowedInstance,
  base58,
  crocArgs,
  crocCode,
  crocProgress,
  crocWebUrl,
  dataUrl,
  decryptPaste,
  deleteUrl,
  encryptPaste,
  expiresIn,
  expiry,
  fromBase64,
  isExpired,
  normalizeInstance,
  parseFileList,
  pasteUrl,
  PRIVATEBIN_HOSTS,
  receiveCommand,
  retentionDays,
  size,
  textTitle,
  toBase64,
  unbase58,
} from "./lib.ts";

Deno.test("copied files", () => {
  const gnome = "copy\nfile:///home/ada/Documents/Rapport%20final.pdf\nfile:///home/ada/Pictures/cat.png";
  assertEquals(parseFileList(gnome), ["/home/ada/Documents/Rapport final.pdf", "/home/ada/Pictures/cat.png"]);
  assertEquals(parseFileList("# comment\r\nfile://otherhost/x\r\n~/notes.txt", "/home/ada"), ["/home/ada/notes.txt"]);
  assertEquals(parseFileList("just some text"), []);
  assertEquals(size(999), "999 B");
  assertEquals(size(1536), "1.5 KB");
  assertEquals(size(25_400_000), "25 MB");
  assertEquals(textTitle("  First line\nsecond"), "First line");
  assertEquals(textTitle("x".repeat(80), 10), "xxxxxxxxx…");
});

Deno.test("0x0.st retention and expiry", () => {
  assertEquals(retentionDays(0), 365);
  assertEquals(retentionDays(512 * 1024 * 1024), 30);
  assertEquals(Math.round(retentionDays(256 * 1024 * 1024)), 72); // 30 + 335 / 8
  assertEquals(expiry("1week").hours, 168);
  assertEquals(expiry("1 hour").privatebin, "1hour");
  assertEquals(expiry("nonsense").title, "1 day");
  const now = Date.parse("2026-10-28T12:00:00Z");
  assertEquals(expiresIn(now + 30 * 60_000, now), "in 30 min");
  assertEquals(expiresIn(now + 5 * 3600_000, now), "in 5 h");
  assertEquals(expiresIn(now + 7 * 86_400_000, now), "in 7 d");
  assertEquals(expiresIn(now - 1, now), "expired");
  assertEquals(expiresIn(undefined, now), "never");
  assert(isExpired({ expires: now - 1 } as never, now));
  assert(!isExpired({} as never, now));
});

Deno.test("base58 as PrivateBin uses it", () => {
  // Vectors of the Bitcoin alphabet.
  assertEquals(base58(new TextEncoder().encode("Hello World!")), "2NEpo7TZRRrLZSi2U");
  assertEquals(base58(new Uint8Array([0, 0, 0x28, 0x7f, 0xb4, 0xcd])), "11233QC4");
  assertEquals(base58(new Uint8Array([])), "");
  const key = new Uint8Array(32).map((_, i) => (i * 37 + 11) & 0xff);
  assertEquals(unbase58(base58(key), 32), key);
  // A key starting with zero bytes survives the round trip.
  const zeros = new Uint8Array(32);
  zeros[31] = 7;
  assertEquals(unbase58(base58(zeros), 32), zeros);
  assertEquals(toBase64(fromBase64("AAECAwQ=")), "AAECAwQ=");
});

const fixed = (seed: number) => (n: number) => new Uint8Array(n).map((_, i) => (seed + i * 13) & 0xff);

Deno.test("PrivateBin v2 paste: format", async () => {
  const { body, key } = await encryptPaste({ paste: "Bonjour, ceci est privé ✓" }, {
    expire: "1day",
    random: fixed(3),
  });
  assertEquals(body.v, 2);
  assertEquals(body.meta, { expire: "1day" });
  assertEquals(key.length, 32);
  const [spec, formatter, discussion, burn] = body.adata;
  assertEquals(fromBase64(spec[0]).length, 16); // IV
  assertEquals(fromBase64(spec[1]).length, 8); // salt
  assertEquals(spec.slice(2), [100000, 256, 128, "aes", "gcm", "zlib"]);
  assertEquals([formatter, discussion, burn], ["plaintext", 0, 0]);
  // Ciphertext and its 16-byte GCM tag, base64.
  assert(fromBase64(body.ct).length > 16);
});

Deno.test("PrivateBin v2 paste: round trip, password, tampering", async () => {
  const text = "Le code du portail est 4521 — à ne pas partager.";
  const { body, key } = await encryptPaste({ paste: text }, { expire: "1week", burn: true, password: "s3cret" });
  assertEquals(body.adata[3], 1);
  assertEquals((await decryptPaste(body, key, "s3cret")).paste, text);
  await assertRejects(() => decryptPaste(body, key, "wrong"));
  await assertRejects(() => decryptPaste(body, key));
  // The adata is authenticated: changing the expiry options or flags breaks the tag.
  const tampered = { ...body, adata: [body.adata[0], body.adata[1], 1, 1] as typeof body.adata };
  await assertRejects(() => decryptPaste(tampered, key, "s3cret"));
  const plain = await encryptPaste({ paste: text }, { expire: "1day", compress: false });
  assertEquals(plain.body.adata[0][7], "none");
  assertEquals((await decryptPaste(plain.body, plain.key)).paste, text);
});

Deno.test("PrivateBin v2 paste: attachment", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const attachment = dataUrl(png, "image/png");
  assertEquals(attachment, "data:image/png;base64,iVBORw0KGgoAAAAN");
  const { body, key } = await encryptPaste({ paste: "", attachment, attachment_name: "cat.png" }, { expire: "1hour" });
  const back = await decryptPaste(body, key);
  assertEquals(back.attachment, attachment);
  assertEquals(back.attachment_name, "cat.png");
  // Two pastes of the same text never look alike.
  const a = await encryptPaste({ paste: "same" }, { expire: "1day" });
  const b = await encryptPaste({ paste: "same" }, { expire: "1day" });
  assertNotEquals(a.body.ct, b.body.ct);
});

Deno.test("PrivateBin links and instances", () => {
  const key = new TextEncoder().encode("Hello World!");
  assertEquals(
    pasteUrl("https://privatebin.net/", "f468483c313401e8", key),
    "https://privatebin.net/?f468483c313401e8#2NEpo7TZRRrLZSi2U",
  );
  assertEquals(pasteUrl("https://privatebin.net/", "f4", key, true), "https://privatebin.net/?f4#-2NEpo7TZRRrLZSi2U");
  assertEquals(deleteUrl("https://privatebin.net/", "f4", "abc"), "https://privatebin.net/?pasteid=f4&deletetoken=abc");
  assertEquals(normalizeInstance(""), "https://privatebin.net/");
  assertEquals(normalizeInstance("bin.disroot.org"), "https://bin.disroot.org/");
  assertEquals(normalizeInstance("http://nas.local:8080/paste?x#y"), "http://nas.local:8080/paste/");
  assert(allowedInstance("https://privatebin.net/"));
  assert(allowedInstance("http://nas.local:8080/"));
  assert(allowedInstance("http://192.168.1.20/"));
  assert(allowedInstance("http://100.101.102.103/"));
  assert(allowedInstance("https://paste.tail1234.ts.net/"));
  assert(!allowedInstance("https://paste.example.com/"));
  assert(!allowedInstance("http://8.8.8.8/"));
});

Deno.test("croc output", () => {
  const v9 =
    "Sending 'report.pdf' (1.2 MB)\nCode is: 8123-alpha-bravo-charlie\nOn the other computer run\n\ncroc 8123-alpha-bravo-charlie\n";
  assertEquals(crocCode(v9), "8123-alpha-bravo-charlie");
  const v10 =
    "\x1b[1mSending 'report.pdf' (1.2 MB)\x1b[0m\r\nOn the other computer run:\n\n  (For Windows)\n    croc 4711-ocean-violet-nebula\n  (For Linux/macOS)\n    CROC_SECRET=\"4711-ocean-violet-nebula\" croc\n";
  assertEquals(crocCode(v10), "4711-ocean-violet-nebula");
  assertEquals(crocCode("CROC_SECRET=**** croc send file.txt"), undefined);
  assertEquals(crocCode("Sending 'a.txt'"), undefined);
  assertEquals(
    crocWebUrl("Or open https://croc.schollz.com/receive#4711-x (browser)."),
    "https://croc.schollz.com/receive#4711-x",
  );
  assertEquals(crocProgress(v9).state, "waiting");
  assertEquals(crocProgress(v9 + "\nSending (->192.0.2.4:9009)\nreport.pdf  42% |████      |").state, "sending");
  assertEquals(crocProgress(v9 + "\nreport.pdf 42% |\rreport.pdf 100% |██████████| (1.2/1.2 MB)").state, "done");
  assertEquals(crocProgress(v9 + "\nError: room not ready").state, "failed");
  assertEquals(receiveCommand("8123-alpha-bravo-charlie"), "CROC_SECRET=8123-alpha-bravo-charlie croc");
  const args = crocArgs("backslash-croc-1", "/home/ada/.cache/x.log", { files: ["/home/ada/a.pdf"] });
  assertEquals(args.slice(-3), ["croc", "send", "/home/ada/a.pdf"]);
  assert(args.includes("--property=StandardOutput=append:/home/ada/.cache/x.log"));
  assertEquals(crocArgs("u", "/l", { text: "hi" }).slice(-4), ["croc", "send", "--text", "hi"]);
});

Deno.test("manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    extension: { description: string };
    permissions: { net: string[]; run: string[] };
    commands: { name: string; description: string }[];
  };
  assertEquals(manifest.permissions.net, ["0x0.st", ...PRIVATEBIN_HOSTS]);
  assertEquals(manifest.permissions.run, ["wl-paste", "xclip", "croc", "systemd-run", "systemctl"]);
  // Users must know 0x0.st links are public before they share.
  assertStringIncludes(manifest.extension.description, "public 0x0.st");
  assertStringIncludes(manifest.commands.find((c) => c.name === "share")!.description, "public");
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
