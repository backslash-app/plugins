import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  ago,
  bytes,
  cleanEta,
  clientKind,
  cookieFrom,
  duration,
  fromDeluge,
  fromQbit,
  fromTransmission,
  guessKind,
  HOSTS,
  isAllowedHost,
  magnetOf,
  matchesView,
  normalizeUrl,
  parseAddInput,
  percent,
  qbitState,
  sessionIdFrom,
  sortTorrents,
  summary,
} from "./lib.ts";

// `torrent-get` arguments.torrents, Transmission 4.0.
const TRANSMISSION = [
  {
    id: 3,
    hashString: "c9e15763f722f23e98a29decdfae341b98d53056",
    name: "debian-12.7.0-amd64-netinst.iso",
    percentDone: 0.4213,
    rateDownload: 4_200_000,
    rateUpload: 120_000,
    eta: 95,
    uploadRatio: 0.05,
    status: 4,
    error: 0,
    errorString: "",
    sizeWhenDone: 661_651_456,
    downloadedEver: 278_754_000,
    uploadedEver: 13_000_000,
    downloadDir: "/home/me/Downloads",
    magnetLink: "magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056&dn=debian",
    bandwidthPriority: 1,
    queuePosition: 0,
    addedDate: 1730000000,
    peersConnected: 42,
    peersSendingToUs: 30,
    metadataPercentComplete: 1,
    labels: ["linux"],
    trackerStats: [{ host: "https://bttracker.debian.org:443" }],
  },
  {
    id: 1,
    hashString: "aa",
    name: "ubuntu-24.04.1-desktop-amd64.iso",
    percentDone: 1,
    rateDownload: 0,
    rateUpload: 0,
    eta: -1,
    uploadRatio: 2.31,
    status: 6,
    error: 0,
    sizeWhenDone: 6_114_656_256,
    downloadDir: "/home/me/Downloads",
    addedDate: 1720000000,
  },
  { id: 2, hashString: "bb", name: "archive.tar", percentDone: 0.2, status: 0, error: 0, eta: -2, uploadRatio: -1 },
  { id: 4, hashString: "cc", name: "broken", percentDone: 0.1, status: 4, error: 3, errorString: "No data found!" },
];

// `GET /api/v2/torrents/info`, qBittorrent 5.0.
const QBIT = [
  {
    hash: "8c4adbf9ebe66f1d804fb6a4fb9b74966c3ab609",
    name: "Big Buck Bunny",
    progress: 0.6,
    dlspeed: 1_500_000,
    upspeed: 40_000,
    eta: 8640000,
    ratio: 0.1,
    state: "downloading",
    size: 276_445_467,
    downloaded: 165_000_000,
    uploaded: 16_000_000,
    save_path: "/downloads/",
    magnet_uri: "magnet:?xt=urn:btih:8c4adbf9ebe66f1d804fb6a4fb9b74966c3ab609&dn=Big+Buck+Bunny",
    priority: 1,
    added_on: 1730001000,
    num_seeds: 12,
    num_leechs: 3,
    tracker: "udp://tracker.opentrackr.org:1337/announce",
    category: "movies",
    tags: "cc, blender",
  },
  { hash: "dd", name: "Sintel", progress: 1, state: "stoppedUP", ratio: 1.5, priority: -1, eta: 8640000 },
  { hash: "ee", name: "Tears of Steel", progress: 0.3, state: "stalledDL", priority: 2 },
];

// `web.update_ui` result.torrents, Deluge 2.1.
const DELUGE = {
  "4d753474429d817b80ff9e0c441ca660ec5d2450": {
    name: "openSUSE-Tumbleweed-DVD-x86_64-Current.iso",
    progress: 12.5,
    download_payload_rate: 800_000,
    upload_payload_rate: 0,
    eta: 3700,
    ratio: 0,
    state: "Downloading",
    total_wanted: 4_500_000_000,
    total_done: 562_500_000,
    save_path: "/var/lib/deluge/Downloads",
    queue: 0,
    time_added: 1730002000.53,
    num_seeds: 9,
    num_peers: 2,
    tracker_host: "opensuse.org",
    message: "OK",
    label: "linux",
  },
  ff: { name: "old.iso", progress: 100, state: "Paused", queue: -1, ratio: 3.2 },
};

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(isAllowedHost("localhost"));
  assert(isAllowedHost("nas.local"));
  assert(isAllowedHost("192.168.1.20"));
  assert(isAllowedHost("100.101.102.103"));
  assert(!isAllowedHost("seedbox.example.com"));
  assert(!isAllowedHost("8.8.8.8"));
});

Deno.test("addresses and client names", () => {
  assertEquals(normalizeUrl("localhost:9091/transmission/web/"), "http://localhost:9091");
  assertEquals(normalizeUrl("https://nas.local/qbit/"), "https://nas.local/qbit");
  assertEquals(normalizeUrl(""), "");
  assertEquals(clientKind("qBittorrent"), "qbittorrent");
  assertEquals(clientKind("Transmission"), "transmission");
  assertEquals(clientKind("deluge"), "deluge");
  assertEquals(clientKind("auto"), undefined);
  assertEquals(guessKind("http://nas.local:8112"), "deluge");
  assertEquals(guessKind("http://nas.local/transmission/web"), "transmission");
  assertEquals(guessKind("http://nas.local:1234"), undefined);
});

Deno.test("Transmission torrents", () => {
  const [dl, seed, paused, broken] = TRANSMISSION.map(fromTransmission);
  assertEquals(dl.state, "downloading");
  assertEquals(dl.id, "3");
  assertEquals(dl.eta, 95);
  assertEquals(dl.tracker, "bttracker.debian.org");
  assertEquals(dl.added, 1730000000000);
  assertEquals(dl.priority, 1);
  assertEquals(seed.state, "seeding");
  assertEquals(seed.eta, undefined);
  assertEquals(paused.state, "paused");
  assertEquals(paused.ratio, 0);
  assertEquals(broken.state, "error");
  assertEquals(broken.error, "No data found!");
  assertEquals(fromTransmission({ id: 9, status: 0, percentDone: 1 }).state, "completed");
  assertEquals(fromTransmission({ id: 9, status: 4, metadataPercentComplete: 0.2 }).state, "metadata");
  assertEquals(fromTransmission({ id: 9, status: 4, rateDownload: 0, peersSendingToUs: 0 }).state, "stalled");
});

Deno.test("qBittorrent torrents", () => {
  const [dl, done, stalled] = QBIT.map(fromQbit);
  assertEquals(dl.state, "downloading");
  assertEquals(dl.eta, undefined);
  assertEquals(dl.tracker, "tracker.opentrackr.org");
  assertEquals(dl.labels, ["cc", "blender"]);
  assertEquals(dl.queue, 1);
  assertEquals(done.state, "completed");
  assertEquals(done.queue, undefined);
  assertEquals(stalled.state, "stalled");
  assertEquals(qbitState("pausedDL"), "paused");
  assertEquals(qbitState("stoppedDL"), "paused");
  assertEquals(qbitState("forcedUP"), "seeding");
  assertEquals(qbitState("missingFiles"), "error");
  assertEquals(qbitState("metaDL"), "metadata");
});

Deno.test("Deluge torrents", () => {
  const [dl, old] = Object.entries(DELUGE).map(([h, t]) => fromDeluge(h, t));
  assertEquals(dl.progress, 0.125);
  assertEquals(dl.state, "downloading");
  assertEquals(dl.queue, 1);
  assertEquals(dl.added, 1730002000530);
  assertEquals(dl.labels, ["linux"]);
  assertEquals(old.state, "completed");
  assertEquals(old.queue, undefined);
});

Deno.test("sorting, views and summary", () => {
  const all = [...TRANSMISSION.map(fromTransmission)];
  assertEquals(sortTorrents(all).map((t) => t.id), ["4", "3", "1", "2"]);
  assertEquals(all.filter((t) => matchesView(t, "downloading")).map((t) => t.id), ["3", "4"]);
  assertEquals(all.filter((t) => matchesView(t, "seeding")).map((t) => t.id), ["1"]);
  assertEquals(all.filter((t) => matchesView(t, "paused")).map((t) => t.id), ["2"]);
  assertEquals(summary(all), "1 with errors · 1 downloading · ↓ 4.2 MB/s · ↑ 120 KB/s");
  assertEquals(summary([fromTransmission(TRANSMISSION[1])]), "1 seeding");
  assertEquals(summary([]), "No torrents");
});

Deno.test("formatting", () => {
  assertEquals(bytes(0), "0 B");
  assertEquals(bytes(661_651_456), "662 MB");
  assertEquals(bytes(6_114_656_256), "6.1 GB");
  assertEquals(duration(95), "1m");
  assertEquals(duration(3700), "1h 1m");
  assertEquals(duration(90000), "1d 1h");
  assertEquals(duration(undefined), "∞");
  assertEquals(percent(0.4213), "42%");
  assertEquals(percent(0.054), "5.4%");
  assertEquals(percent(0.9995), "99.9%");
  assertEquals(percent(1), "100%");
  assertEquals(cleanEta(8640000), undefined);
  assertEquals(cleanEta(-2), undefined);
  assertEquals(ago(Date.now() - 3 * 86400_000), "3 days ago");
});

Deno.test("magnet links and URLs", () => {
  assertEquals(
    parseAddInput("magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056&dn=debian+12&tr=udp%3A%2F%2Fx"),
    {
      link: "magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056&dn=debian+12&tr=udp%3A%2F%2Fx",
      kind: "magnet",
      name: "debian 12",
    },
  );
  assertEquals(
    parseAddInput("C9E15763F722F23E98A29DECDFAE341B98D53056")?.link,
    "magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056",
  );
  assertEquals(parseAddInput("  https://cdimage.debian.org/x/debian-12.iso.torrent \n"), {
    link: "https://cdimage.debian.org/x/debian-12.iso.torrent",
    kind: "url",
    name: "debian-12.iso.torrent",
  });
  assertEquals(parseAddInput("magnet:?dn=nothing"), undefined);
  assertEquals(parseAddInput("hello world"), undefined);
  assertEquals(parseAddInput(""), undefined);
  assertEquals(magnetOf({ hash: "ab", name: "a b" }), "magnet:?xt=urn:btih:ab&dn=a%20b");
});

Deno.test("sessions and cookies", () => {
  assertEquals(sessionIdFrom(409, new Headers({ "X-Transmission-Session-Id": "abc123" })), "abc123");
  assertEquals(sessionIdFrom(200, new Headers({ "X-Transmission-Session-Id": "abc123" })), undefined);
  assertEquals(
    cookieFrom("SID=hBc7TxF76ERhvIw0jQQ4LZ7Z1jQUV0tQ; HttpOnly; path=/; SameSite=Strict"),
    "SID=hBc7TxF76ERhvIw0jQQ4LZ7Z1jQUV0tQ",
  );
  assertEquals(cookieFrom("QBT_SID_8080=xyz; HttpOnly; path=/"), "QBT_SID_8080=xyz");
  assertEquals(
    cookieFrom("_session_id=5f0c1; Expires=Tue, 29 Oct 2026 10:00:00 GMT; Path=/json"),
    "_session_id=5f0c1",
  );
  assertEquals(cookieFrom("theme=dark; Path=/"), undefined);
  assertEquals(cookieFrom(null), undefined);
});
