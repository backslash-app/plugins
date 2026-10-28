// CardDAV discovery and download, .vcf files of a folder, and the cache in storage.

import { storage } from "@backslash/api";
import {
  cardsOf,
  type Contact,
  dedupe,
  expandHome,
  hrefIn,
  isAddressBook,
  isAllowedHost,
  multigetXml,
  normalizeServer,
  parseMultistatus,
  parseVcf,
  resolveHref,
  sortContacts,
  XML_BOOKS,
  XML_ETAGS,
  XML_HOME,
  XML_PRINCIPAL,
  XML_QUERY,
} from "./lib.ts";

export class SetupError extends Error {}

export const HOME = (() => {
  try {
    return Deno.env.get("HOME");
  } catch {
    return undefined;
  }
})();

/** Folders a vCard folder may be in, as declared in `[permissions] read`. */
export const FOLDERS = ["~/Contacts", "~/.contacts", "~/.local/share/contacts", "~/.local/share/vdirsyncer"];
export const PHOTO_DIR = "~/.cache/backslash/contacts";

export type Account = { server: string; user: string; password: string };

export function accountOf(prefs: Record<string, unknown>): Account | undefined {
  const server = normalizeServer(prefs.server);
  if (!server) return undefined;
  const user = String(prefs.username ?? "").trim();
  const password = String(prefs.password ?? "");
  if (!user || !password) throw new SetupError("Add the user name and app password of your CardDAV account");
  const host = new URL(server).hostname;
  if (!isAllowedHost(host)) {
    throw new SetupError(
      `${host} is outside the hosts this extension may reach: a known provider, or a server on your network or Tailscale`,
    );
  }
  return { server, user, password };
}

/** HTTP Basic credentials, UTF-8 encoded. */
export function basicAuth(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

async function dav(
  a: Account,
  method: string,
  url: string,
  body: string,
  depth: "0" | "1",
  signal?: AbortSignal,
): Promise<{ status: number; text: string; url: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      signal,
      headers: {
        Authorization: basicAuth(a.user, a.password),
        "Content-Type": "application/xml; charset=utf-8",
        Depth: depth,
      },
      body,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    if ((e as Error).name === "NotCapable") {
      throw new SetupError(`The address book is at a host this extension may not reach: ${new URL(url).host}`);
    }
    throw new Error(`The CardDAV server is unreachable: ${(e as Error).message}`);
  }
  const text = await res.text();
  if (res.status === 401) {
    throw new SetupError("The CardDAV server refused the user name or password: use an app password if you have 2FA");
  }
  return { status: res.status, text, url: res.url || url };
}

/** The address books of the account: the URL itself if it is one, else found from the principal. */
export async function addressBooks(a: Account, signal?: AbortSignal): Promise<{ url: string; name: string }[]> {
  const first = await dav(a, "PROPFIND", a.server, XML_PRINCIPAL, "0", signal);
  let principal: string | undefined;
  if (first.status === 207) {
    const [r] = parseMultistatus(first.text);
    if (r && isAddressBook(r)) return [{ url: first.url, name: "Contacts" }];
    const href = hrefIn(r?.props["current-user-principal"]);
    if (href) principal = resolveHref(href, first.url);
  }
  if (!principal) {
    // RFC 6764: /.well-known/carddav redirects to the service.
    const wk = await dav(
      a,
      "PROPFIND",
      new URL("/.well-known/carddav", a.server).toString(),
      XML_PRINCIPAL,
      "0",
      signal,
    );
    const [r] = wk.status === 207 ? parseMultistatus(wk.text) : [];
    const href = hrefIn(r?.props["current-user-principal"]);
    if (!href) {
      throw new Error(
        `No CardDAV account found at ${a.server} (answer ${first.status}): use the address of your address books`,
      );
    }
    principal = resolveHref(href, wk.url);
  }
  const home = await dav(a, "PROPFIND", principal, XML_HOME, "0", signal);
  const homeHref = home.status === 207
    ? hrefIn(parseMultistatus(home.text)[0]?.props["addressbook-home-set"])
    : undefined;
  if (!homeHref) throw new Error("The CardDAV server didn't say where the address books are (addressbook-home-set)");
  const homeUrl = resolveHref(homeHref, home.url);
  const list = await dav(a, "PROPFIND", homeUrl, XML_BOOKS, "1", signal);
  if (list.status !== 207) throw new Error(`The CardDAV server answered ${list.status} listing the address books`);
  const books = parseMultistatus(list.text).filter(isAddressBook).map((r) => ({
    url: resolveHref(r.href, list.url),
    name: r.props.displayname?.text.trim() || decodeURIComponent(r.href.replace(/\/$/, "").split("/").pop() ?? ""),
  }));
  if (!books.length) throw new Error("This CardDAV account has no address book");
  return books;
}

/** Every card of an address book: addressbook-query, else the list of cards and multiget. */
export async function booksCards(a: Account, book: { url: string; name: string }, signal?: AbortSignal) {
  const q = await dav(a, "REPORT", book.url, XML_QUERY, "1", signal);
  if (q.status === 207) {
    const cards = cardsOf(q.text, book.name);
    if (cards.length || !/<[\w:]*href/i.test(q.text)) return cards;
  }
  // Some servers (Google) don't answer addressbook-query with the data: list the cards and fetch them.
  const list = await dav(a, "PROPFIND", book.url, XML_ETAGS, "1", signal);
  if (list.status !== 207) throw new Error(`The CardDAV server answered ${list.status} for ${book.name}`);
  const hrefs = parseMultistatus(list.text)
    .filter((r) => !isAddressBook(r) && !book.url.endsWith(r.href))
    .map((r) => r.href);
  const out: Contact[] = [];
  for (let i = 0; i < hrefs.length; i += 200) {
    const r = await dav(a, "REPORT", book.url, multigetXml(hrefs.slice(i, i + 200)), "1", signal);
    if (r.status !== 207) throw new Error(`The CardDAV server answered ${r.status} reading ${book.name}`);
    out.push(...cardsOf(r.text, book.name));
  }
  return out;
}

async function* vcfFiles(dir: string, depth = 0): AsyncGenerator<string> {
  for await (const e of Deno.readDir(dir)) {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory && depth < 3 && !e.name.startsWith(".")) yield* vcfFiles(path, depth + 1);
    else if (e.isFile && /\.(vcf|vcard)$/i.test(e.name)) yield path;
  }
}

/** Cards of the .vcf files in the folder of the preferences (and its subfolders, as vdirsyncer makes). */
export async function folderCards(folder: string): Promise<Contact[]> {
  const dir = expandHome(folder, HOME).replace(/\/+$/, "");
  const allowed = FOLDERS.map((f) => expandHome(f, HOME));
  if (!allowed.some((f) => dir === f || dir.startsWith(`${f}/`))) {
    throw new SetupError(
      `The vCard folder must be one of ${FOLDERS.join(", ")} (or inside one): move or link it there`,
    );
  }
  const out: Contact[] = [];
  try {
    for await (const path of vcfFiles(dir)) {
      const text = await Deno.readTextFile(path).catch(() => "");
      out.push(...parseVcf(text, path.slice(dir.length + 1).replace(/\.(vcf|vcard)$/i, ""), path));
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new SetupError(`The vCard folder ${folder} doesn't exist`);
    throw e;
  }
  return out;
}

/** Writes embedded pictures to the cache folder, so rows can show them. */
async function savePhotos(contacts: Contact[]): Promise<Record<string, string>> {
  const dir = expandHome(PHOTO_DIR, HOME);
  const photos: Record<string, string> = {};
  if (!HOME) return photos;
  try {
    await Deno.mkdir(dir, { recursive: true });
  } catch {
    return photos;
  }
  for (const c of contacts) {
    if (!c.photoData) continue;
    const ext = c.photoData.type.includes("png") ? "png" : c.photoData.type.includes("gif") ? "gif" : "jpg";
    const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(c.id + c.photoData.base64.length));
    const name = [...new Uint8Array(digest)].slice(0, 10).map((b) => b.toString(16).padStart(2, "0")).join("");
    const path = `${dir}/${name}.${ext}`;
    try {
      await Deno.stat(path);
    } catch {
      try {
        const bin = atob(c.photoData.base64.replace(/\s+/g, ""));
        await Deno.writeFile(path, Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
      } catch {
        continue;
      }
    }
    photos[c.id] = path;
  }
  return photos;
}

export type Cache = {
  at: number;
  contacts: Contact[];
  books: string[];
  photos: Record<string, string>;
  errors: string[];
};

/** Downloads everything again. */
export async function load(prefs: Record<string, unknown>, signal?: AbortSignal): Promise<Cache> {
  const account = accountOf(prefs);
  const folder = String(prefs.folder ?? "").trim();
  if (!account && !folder) {
    throw new SetupError("Add a CardDAV account or a folder of vCard files");
  }
  const errors: string[] = [];
  const books: string[] = [];
  const [remote, local] = await Promise.all([
    account
      ? addressBooks(account, signal).then(async (list) => {
        books.push(...list.map((b) => b.name));
        const all = await Promise.all(list.map((b) => booksCards(account, b, signal)));
        return all.flat();
      })
      : Promise.resolve([] as Contact[]),
    folder
      ? folderCards(folder).catch((e) => {
        if (!account) throw e;
        errors.push((e as Error).message);
        return [] as Contact[];
      })
      : Promise.resolve([] as Contact[]),
  ]);
  if (folder && local.length) books.push("vCard files");
  const contacts = sortContacts(dedupe([...remote, ...local]));
  const photos = await savePhotos(contacts);
  // Pictures live in files; the cache keeps the text only.
  const cache: Cache = {
    at: Date.now(),
    contacts: contacts.map(({ photoData: _photo, ...c }) => c),
    books,
    photos,
    errors,
  };
  await storage.set("cache", cache).catch(() => {});
  await storage.set("cacheKey", cacheKey(prefs)).catch(() => {});
  return cache;
}

/** Changes when the account or folder changes, so another account's cache isn't shown. */
export function cacheKey(prefs: Record<string, unknown>): string {
  return `${normalizeServer(prefs.server)}|${String(prefs.username ?? "").trim()}|${String(prefs.folder ?? "").trim()}`;
}

export async function cached(prefs: Record<string, unknown>): Promise<Cache | undefined> {
  const [cache, key] = await Promise.all([
    storage.get<Cache>("cache").catch(() => undefined),
    storage.get<string>("cacheKey").catch(() => undefined),
  ]);
  return cache && key === cacheKey(prefs) ? cache : undefined;
}
