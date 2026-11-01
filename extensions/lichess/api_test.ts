// The API layer against a fake fetch: no network.

import { assert, assertEquals, assertRejects } from "@std/assert";
import { games, LoginRequired } from "./api.ts";
import { recentGames } from "./items.ts";
import { loginRequired, TOKEN_URL } from "./lib.ts";

const dir = new URL(".", import.meta.url).pathname;
const ndjson = Deno.readTextFileSync(`${dir}fixtures/games.ndjson`);
const userJson = Deno.readTextFileSync(`${dir}fixtures/user.json`);

interface Seen {
  url: string;
  auth: string | null;
}

/** Runs `fn` with fetch answering from `route`, and returns the requests made. */
async function withFetch(
  route: (url: string, auth: string | null) => Response,
  fn: () => Promise<void>,
): Promise<Seen[]> {
  const seen: Seen[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("Authorization");
    seen.push({ url, auth });
    return Promise.resolve(route(url, auth));
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = real;
  }
  return seen;
}

// What Lichess answers today: game exports need a signed-in request.
const lichess = (url: string, auth: string | null) => {
  if (url.includes("/api/games/user/")) {
    return auth
      ? new Response(ndjson, { headers: { "Content-Type": "application/x-ndjson" } })
      : new Response('{"error":"Not found"}', { status: 404 });
  }
  if (url.includes("/api/user/nobody")) return new Response('{"error":"Not found"}', { status: 404 });
  if (url.includes("/api/user/")) return new Response(userJson);
  return new Response("{}", { status: 500 });
};

Deno.test("login required: explicit message, or 401 without a token", () => {
  assert(loginRequired(403, '{"error":"Login required"}', false));
  assert(loginRequired(401, "", false));
  assert(!loginRequired(401, "", true));
  assert(!loginRequired(404, '{"error":"Not found"}', false));
  assertEquals(TOKEN_URL, "https://lichess.org/account/oauth/token/create?description=Backslash");
});

Deno.test("games: the token is sent, and the NDJSON read", async () => {
  const seen = await withFetch(lichess, async () => {
    const list = await games("thibault", 20, "lip_secret");
    assertEquals(list.map((g) => g.id), ["g1", "g2", "g3", "g4"]);
  });
  assertEquals(seen[0].auth, "Bearer lip_secret");
  assert(seen[0].url.startsWith("https://lichess.org/api/games/user/thibault?max=20&opening=true&accuracy=true"));
});

Deno.test("games: without a token, Lichess's 404 or 'Login required' means a token is needed", async () => {
  await withFetch(lichess, async () => {
    await assertRejects(() => games("thibault", 20), LoginRequired);
  });
  await withFetch(() => new Response('{"error":"Login required"}', { status: 403 }), async () => {
    await assertRejects(() => games("thibault", 20), LoginRequired);
  });
  await withFetch(() => new Response('{"error":"Login required"}', { status: 401 }), async () => {
    await assertRejects(() => games("thibault", 20), LoginRequired);
  });
});

Deno.test("recent games: a token row for a real player, nothing for an unknown one", async () => {
  await withFetch(lichess, async () => {
    const known = await recentGames("thibault", { count: 20 });
    assertEquals(known.games, []);
    assertEquals(known.items.map((i) => i.id), ["token-needed"]);
    assert(!known.unknown);
    const action = known.items[0].actions?.[0] as { target?: string };
    assertEquals(action.target, TOKEN_URL);

    const unknown = await recentGames("nobody", { count: 20 });
    assertEquals(unknown, { games: [], items: [], unknown: true });

    const signed = await recentGames("thibault", { count: 20, token: "lip_secret" });
    assertEquals(signed.games.map((g) => g.result), ["win", "loss", "draw", "ongoing"]);
    assertEquals(signed.items[0].id, "game:g1");
  });
});
