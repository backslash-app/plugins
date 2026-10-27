import { assertEquals } from "@std/assert";
import {
  ago,
  chromeBookmarks,
  chromeTime,
  chromeTimeString,
  domain,
  firefoxTabs,
  imageExtension,
  lz4Block,
  mozLz4,
} from "./lib.ts";

Deno.test("times", () => {
  assertEquals(chromeTime(13_350_000_000_000), 1_705_526_400_000);
  assertEquals(chromeTimeString("13350000000000000"), 1_705_526_400_000);
  assertEquals(ago(Date.now() - 5 * 60_000), "5 min ago");
});

Deno.test("domain", () => {
  assertEquals(domain("https://www.github.com/x"), "github.com");
  assertEquals(domain("not a url"), "not a url");
});

Deno.test("chrome bookmarks are flattened", () => {
  const json = {
    roots: {
      bookmark_bar: {
        children: [
          { type: "url", name: "Deno", url: "https://deno.com", date_added: "13350000000000000" },
          { type: "folder", children: [{ type: "url", name: "Rust", url: "https://rust-lang.org" }] },
        ],
      },
      other: { children: [] },
    },
  };
  assertEquals(chromeBookmarks(json).map((b) => b.title), ["Deno", "Rust"]);
});

Deno.test("lz4 block with an overlapping match", () => {
  // "abcabcabcabcX": literals "abc", match offset 3 length 9, then literal "X".
  const block = new Uint8Array([0x35, 0x61, 0x62, 0x63, 0x03, 0x00, 0x10, 0x58]);
  assertEquals(new TextDecoder().decode(lz4Block(block, 13)), "abcabcabcabcX");
});

Deno.test("mozlz4 session file to tabs", () => {
  const json = JSON.stringify({
    windows: [{
      tabs: [
        { index: 2, lastAccessed: 5, entries: [{ url: "https://a.org" }, { url: "https://b.org", title: "B" }] },
        { index: 1, lastAccessed: 9, pinned: true, entries: [{ url: "https://c.org", title: "C" }] },
        { index: 1, entries: [{ url: "about:newtab" }] },
      ],
    }],
  });
  // A literal-only LZ4 block: token 0xF0 + length bytes, then the text.
  const text = new TextEncoder().encode(json);
  const extra = text.length - 15;
  const lengthBytes: number[] = [];
  let rest = extra;
  while (rest >= 255) {
    lengthBytes.push(255);
    rest -= 255;
  }
  lengthBytes.push(rest);
  const header = new Uint8Array(12);
  header.set(new TextEncoder().encode("mozLz40\0"));
  new DataView(header.buffer).setUint32(8, text.length, true);
  const file = new Uint8Array([...header, 0xf0, ...lengthBytes, ...text]);
  const tabs = firefoxTabs(JSON.parse(mozLz4(file)));
  assertEquals(tabs.map((t) => t.title), ["C", "B"]);
  assertEquals(tabs[0].pinned, true);
});

Deno.test("image types", () => {
  assertEquals(imageExtension(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), "png");
  assertEquals(imageExtension(new TextEncoder().encode("<svg xmlns=...")), "svg");
  assertEquals(imageExtension(new Uint8Array([1, 2, 3])), undefined);
});
