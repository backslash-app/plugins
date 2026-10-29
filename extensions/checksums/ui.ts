// Rows for files, sums files and signatures, the views that compute and
// verify, and forms.

import {
  type Action,
  action,
  clipboard,
  copy,
  detail,
  type DetailSpec,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  type Metadata,
  open,
  pop,
  refresh,
  toast,
} from "@backslash/api";
import {
  type Algo,
  ALGOS,
  algoTitle,
  basename,
  type CopiedHash,
  copiedHash,
  dirname,
  formatBytes,
  groupedFingerprint,
  groupedHash,
  plural,
  sameHash,
  shortHash,
  type Signature,
  sigVerdict,
  type SumEntry,
  sumsLine,
  TRUST_TITLES,
} from "./lib.ts";
import { expandHome, type FileEntry, fileEntry, hashOf, knownHash, receiveKey, type Sums, tilde } from "./system.ts";

/** What is known about a file: its hashes, and how they compare. */
export interface FileState {
  f: FileEntry;
  section: string;
  /** The line about it in a sums file next to it. */
  sums?: { sums: Sums; entry: SumEntry };
  /** A detached signature next to it. */
  sig?: string;
  signatures?: Signature[];
  sigError?: string;
  error?: string;
}

// The list stays live: a form that opens a file wakes it up.
const changes = new EventTarget();
export const changed = () => changes.dispatchEvent(new Event("change"));
export function nextChange(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      changes.removeEventListener("change", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    changes.addEventListener("change", done);
    signal.addEventListener("abort", done);
  });
}

/** Files opened by path, kept for the session. */
export const opened: FileEntry[] = [];

const failure = (e: unknown) => toast((e as Error).message, { style: "failure" });

// ---------------------------------------------------------------------------
// Comparing

export interface Match {
  algo: Algo;
  ok: boolean;
}

/** Compares a file with a hash, trying each algorithm the hash's length allows. */
export async function compare(f: FileEntry, h: CopiedHash, signal?: AbortSignal): Promise<Match> {
  let last: Match | undefined;
  for (const algo of h.algos) {
    const hash = await hashOf(f, algo, signal);
    last = { algo, ok: sameHash(hash, h.hash) };
    if (last.ok) return last;
  }
  return last!;
}

/** The comparison if every hash it needs is computed already. */
export function knownMatch(f: FileEntry, h: CopiedHash): Match | undefined {
  let last: Match | undefined;
  for (const algo of h.algos) {
    const hash = knownHash(f, algo);
    if (!hash) return undefined;
    last = { algo, ok: sameHash(hash, h.hash) };
    if (last.ok) return last;
  }
  return last;
}

function compareForm(f: FileEntry, prefill = ""): FormSpec {
  return form({
    title: `Compare ${f.name}`,
    submitTitle: "Compare",
    fields: [field.text("hash", "Expected hash", {
      required: true,
      value: prefill,
      placeholder: "Paste the SHA-256, SHA-512, SHA-1, MD5 or BLAKE2 hash",
    })],
    async submit(values) {
      const h = copiedHash(String(values.hash ?? ""));
      if (!h) {
        await toast("That isn't a hash", { style: "failure", message: "32 to 128 hexadecimal characters" });
        return;
      }
      await toast(`Computing ${h.algos.map(algoTitle).join(" or ")}…`);
      try {
        const m = await compare(f, h);
        await toast(m.ok ? `${algoTitle(m.algo)} matches` : `Doesn't match: the file is different`, {
          style: m.ok ? "success" : "failure",
        });
        changed();
        return m.ok ? pop() : undefined;
      } catch (e) {
        await failure(e);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Views

/** Every algorithm, streamed as each is computed. */
export function hashesView(f: FileEntry): DetailSpec {
  const done: Partial<Record<Algo, string>> = {};
  const render = (pending?: Algo) =>
    [
      `# ${f.name}`,
      "",
      ...ALGOS.flatMap(({ algo, title, weak }) => [
        `**${title}**${weak ? " (not safe against tampering)" : ""}`,
        "",
        done[algo] ? "```\n" + done[algo] + "\n```" : algo === pending ? "_Computing…_" : "_Waiting…_",
        "",
      ]),
    ].join("\n");
  return detail({
    title: f.name,
    async *markdown({ signal }) {
      for (const { algo } of ALGOS) {
        yield render(algo);
        try {
          done[algo] = await hashOf(f, algo, signal);
        } catch (e) {
          if (signal.aborted) return;
          done[algo] = `(${(e as Error).message})`;
        }
      }
      yield render();
    },
    metadata: [
      meta.text("Size", formatBytes(f.size), { icon: Icons.drive }),
      meta.text("Folder", tilde(dirname(f.path)), { icon: Icons.folder }),
    ],
    actions: ALGOS.map(({ algo, title }, n) =>
      action(`Copy ${title}`, async () => {
        try {
          await clipboard.write(await hashOf(f, algo));
          await toast(`${title} copied`, { style: "success" });
        } catch (e) {
          await failure(e);
        }
      }, { icon: Icons.copy, ...(n === 0 ? {} : { section: "Copy" }) })
    ),
  });
}

/** Checks every file listed in a sums file, one after the other. */
export function verifyAllView(sums: Sums): ListSpec {
  const dir = dirname(sums.path);
  let summary = "";
  return list({
    title: basename(sums.path),
    placeholder: `Files listed in ${basename(sums.path)}…`,
    status: () => summary,
    async *items({ signal }) {
      const rows = sums.entries.map((e) => ({
        e,
        state: "waiting" as "waiting" | "ok" | "bad" | "missing" | "error",
        note: "",
      }));
      const counts = () => {
        const n = (s: string) => rows.filter((r) => r.state === s).length;
        summary = [
          `${n("ok")} OK`,
          n("bad") ? `${n("bad")} FAILED` : "",
          n("missing") ? `${n("missing")} missing` : "",
          n("waiting") ? `${n("waiting")} to check` : "",
        ].filter(Boolean).join(" · ");
      };
      const build = (): Item[] =>
        rows.map(({ e, state, note }) => ({
          id: e.name,
          title: e.name,
          subtitle: state === "waiting" ? "Waiting…" : note || shortHash(e.hash),
          icon: {
            source: state === "ok"
              ? Icons.done
              : state === "bad"
              ? Icons.canceled
              : state === "waiting"
              ? Icons.inProgress
              : Icons.alert,
            tint: state === "ok" ? "green" : state === "bad" ? "red" : state === "waiting" ? "blue" : "gray",
          },
          section: state === "bad"
            ? "Failed"
            : state === "ok"
            ? "OK"
            : state === "waiting"
            ? "Checking"
            : "Not Checked",
          accessories: [{
            tag: { ok: "OK", bad: "FAILED", missing: "missing", error: "error", waiting: "…" }[state],
            color: state === "ok" ? "green" : state === "bad" ? "red" : "gray",
          }],
          detail: {
            markdown: `**Expected ${algoTitle(e.algo ?? "sha256")}**\n\n\`\`\`\n${groupedHash(e.hash)}\n\`\`\``,
            metadata: [meta.text("Folder", tilde(dir), { icon: Icons.folder })],
          },
          actions: [
            open(`${dir}/${e.name}`, "Open File", { icon: Icons.external }),
            copy(e.hash, "Copy Expected Hash"),
          ],
        }));
      counts();
      yield build();
      for (const row of rows) {
        if (signal.aborted) return;
        const f = await fileEntry(`${dir}/${row.e.name}`);
        if (!f) {
          row.state = "missing";
          row.note = "Not in this folder";
        } else {
          try {
            const hash = await hashOf(f, row.e.algo ?? "sha256", signal);
            row.state = sameHash(hash, row.e.hash) ? "ok" : "bad";
            row.note = row.state === "ok" ? `${algoTitle(row.e.algo ?? "sha256")} matches` : `Got ${shortHash(hash)}`;
          } catch (e) {
            if (signal.aborted) return;
            row.state = "error";
            row.note = (e as Error).message;
          }
        }
        counts();
        yield build();
      }
      if (!rows.some((r) => r.state === "bad")) {
        await toast(rows.every((r) => r.state === "ok") ? "Every file matches" : summary, {
          style: rows.every((r) => r.state === "ok") ? "success" : "info",
        });
      } else await toast(`${rows.filter((r) => r.state === "bad").length} files don't match`, { style: "failure" });
    },
  });
}

// ---------------------------------------------------------------------------
// Signature lines

export function signatureMetadata(sigs: Signature[] | undefined, error?: string): Metadata[] {
  if (error) return [meta.tags("Signature", [{ text: error, color: "gray" }])];
  if (!sigs) return [];
  return sigs.flatMap((s) => {
    const v = sigVerdict(s);
    return [
      meta.tags("Signature", [{ text: v.text, color: v.color }]),
      ...(s.signer ? [meta.person("Signed by", s.signer)] : []),
      ...(s.fingerprint ? [meta.text("Key", groupedFingerprint(s.fingerprint), { icon: Icons.key })] : []),
      ...(!s.fingerprint && s.keyId ? [meta.text("Key ID", s.keyId, { icon: Icons.key })] : []),
      ...(s.trust ? [meta.text("Trust", TRUST_TITLES[s.trust], { icon: Icons.shield })] : []),
      ...(s.created
        ? [meta.text("Signed", s.created.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }), {
          icon: Icons.calendar,
        })]
        : []),
    ];
  });
}

function keyActions(sigs: Signature[] | undefined): Action[] {
  const missing = sigs?.find((s) => s.status === "no-key");
  if (!missing) return [];
  const id = missing.fingerprint ?? missing.keyId!;
  return [
    action("Fetch the Key from keys.openpgp.org", async () => {
      await toast("Fetching the key…");
      try {
        const who = await receiveKey(id);
        await toast(`Imported ${who}`, { style: "success", message: "Check that it is the publisher's key" });
        return refresh();
      } catch (e) {
        await toast("Couldn't fetch the key", { style: "failure", message: (e as Error).message });
      }
    }, { icon: Icons.download, section: "Signature" }),
    open(`https://keys.openpgp.org/search?q=${encodeURIComponent(id)}`, "Look Up the Key", {
      icon: Icons.globe,
      section: "Signature",
    }),
  ];
}

const sigIcon = (sigs?: Signature[]) => {
  const v = sigs?.[0] ? sigVerdict(sigs[0]) : undefined;
  return v?.color === "green" ? Icons.shield : v?.color === "red" ? Icons.alert : Icons.key;
};

// ---------------------------------------------------------------------------
// Rows

export function fileItem(s: FileState, clip?: CopiedHash): Item {
  const f = s.f;
  const sha = knownHash(f, "sha256");
  const m = clip ? knownMatch(f, clip) : undefined;
  const sumsAlgo = s.sums?.entry.algo ?? "sha256";
  const sumsHash = s.sums ? knownHash(f, sumsAlgo) : undefined;
  const sumsOk = s.sums && sumsHash ? sameHash(sumsHash, s.sums.entry.hash) : undefined;
  const sigV = s.signatures?.[0] ? sigVerdict(s.signatures[0]) : undefined;
  const bad = m?.ok === false || sumsOk === false || sigV?.color === "red";
  const good = !bad && (m?.ok || sumsOk || sigV?.color === "green");
  const lines: Metadata[] = [
    ...(clip
      ? [meta.tags("Clipboard", [
        m
          ? { text: m.ok ? `${algoTitle(m.algo)} matches` : "Doesn't match", color: m.ok ? "green" : "red" }
          : { text: "Comparing…", color: "gray" },
      ])]
      : []),
    ...(s.sums
      ? [meta.tags(basename(s.sums.sums.path), [
        sumsOk === undefined
          ? { text: "Checking…", color: "gray" }
          : { text: sumsOk ? `${algoTitle(sumsAlgo)} matches` : "DOESN'T MATCH", color: sumsOk ? "green" : "red" },
        ...(s.sums.sums.clearsigned ? ["signed"] : []),
      ])]
      : []),
    ...signatureMetadata(s.signatures, s.sigError),
    meta.separator(),
    meta.text("Size", formatBytes(f.size), { icon: Icons.drive }),
    meta.text("Folder", tilde(dirname(f.path)), { icon: Icons.folder }),
  ];
  const hashText = sha ? `**SHA-256**\n\n\`\`\`\n${sha}\n\`\`\`` : s.error ? `**${s.error}**` : "_Computing SHA-256…_";
  const actions: Action[] = [
    ...(sha ? [copy(sha, "Copy SHA-256")] : [action("Compute SHA-256", () => refresh(), { icon: Icons.hash })]),
    action("All Hashes…", () => hashesView(f), { icon: Icons.hash, shortcut: "<Ctrl>h" }),
    ...(sha
      ? [copy(sumsLine(sha, f.name), "Copy as sha256sum Line", { section: "Copy", shortcut: "<Ctrl><Shift>c" })]
      : []),
    action("Compare with a Hash…", () => compareForm(f, clip?.hash), {
      icon: Icons.search,
      shortcut: "<Ctrl>e",
      section: "Verify",
    }),
    ...(s.sums
      ? [
        action(`Check All of ${basename(s.sums.sums.path)}`, () => verifyAllView(s.sums!.sums), {
          icon: Icons.layers,
          section: "Verify",
        }),
      ]
      : []),
    ...(s.sig
      ? [action("Verify the Signature Again", () => refresh(), { icon: Icons.shield, section: "Verify" })]
      : []),
    ...keyActions(s.signatures),
    copy(f.path, "Copy Path", { section: "File" }),
    open(dirname(f.path), "Open Folder", { icon: Icons.folder, section: "File", shortcut: "<Ctrl>o" }),
  ];
  return {
    id: `${s.section}:${f.path}`,
    title: f.name,
    subtitle: sha ? shortHash(sha) : tilde(dirname(f.path)),
    icon: { source: bad ? Icons.alert : good ? Icons.done : Icons.file, tint: bad ? "red" : good ? "green" : "gray" },
    section: s.section,
    keywords: sha ? [sha] : [],
    accessories: [
      ...(m
        ? [{ tag: m.ok ? "matches clipboard" : "different", color: m.ok ? "green" as const : "red" as const }]
        : []),
      ...(sumsOk !== undefined
        ? [{
          tag: sumsOk ? `OK in ${basename(s.sums!.sums.path)}` : "checksum FAILED",
          color: sumsOk ? "green" as const : "red" as const,
        }]
        : []),
      ...(sigV ? [{ icon: { source: sigIcon(s.signatures), tint: sigV.color }, tooltip: sigV.text }] : []),
      { text: formatBytes(f.size) },
    ],
    detail: { markdown: hashText, metadata: lines },
    actions,
  };
}

/** A recent download that wasn't copied: hashed only on demand or to find a copied hash. */
export function recentItem(f: FileEntry, clip?: CopiedHash): Item {
  const m = clip ? knownMatch(f, clip) : undefined;
  const sha = knownHash(f, "sha256");
  return {
    id: `recent:${f.path}`,
    title: f.name,
    subtitle: tilde(dirname(f.path)),
    icon: { source: m?.ok ? Icons.done : Icons.download, tint: m?.ok ? "green" : "gray" },
    section: "Recent Downloads",
    accessories: [
      ...(m
        ? [{ tag: m.ok ? "matches clipboard" : "different", color: m.ok ? "green" as const : "gray" as const }]
        : []),
      { text: formatBytes(f.size) },
    ],
    detail: {
      markdown: sha ? `**SHA-256**\n\n\`\`\`\n${sha}\n\`\`\`` : "Press **Enter** to compute its hashes.",
      metadata: [
        ...(m
          ? [
            meta.tags("Clipboard", [{
              text: m.ok ? `${algoTitle(m.algo)} matches` : "Doesn't match",
              color: m.ok ? "green" : "red",
            }]),
          ]
          : []),
        meta.text("Size", formatBytes(f.size), { icon: Icons.drive }),
      ],
    },
    actions: [
      action("All Hashes…", () => hashesView(f), { icon: Icons.hash }),
      action("Compare with a Hash…", () => compareForm(f, clip?.hash), { icon: Icons.search, shortcut: "<Ctrl>e" }),
      open(dirname(f.path), "Open Folder", { icon: Icons.folder, shortcut: "<Ctrl>o" }),
    ],
  };
}

export function sumsItem(
  sums: Sums,
  section: string,
  signature?: { sigs?: Signature[]; error?: string; path?: string },
): Item {
  const v = signature?.sigs?.[0] ? sigVerdict(signature.sigs[0]) : undefined;
  const algos = [...new Set(sums.entries.map((e) => algoTitle(e.algo ?? "sha256")))];
  return {
    id: `${section}:${sums.path}`,
    title: basename(sums.path),
    subtitle: `${plural(sums.entries.length, "file")} · ${algos.join(", ")}`,
    icon: { source: Icons.hash, tint: v?.color === "red" ? "red" : "blue" },
    section,
    accessories: [
      ...(v ? [{ icon: { source: sigIcon(signature?.sigs), tint: v.color }, tooltip: v.text }] : []),
      ...(sums.clearsigned && !v ? [{ tag: "signed" }] : []),
    ],
    detail: {
      markdown: sums.entries.slice(0, 100).map((e) => `- \`${shortHash(e.hash, 6)}\` ${e.name}`).join("\n") +
        (sums.entries.length > 100 ? `\n- … and ${sums.entries.length - 100} more` : ""),
      metadata: [
        ...signatureMetadata(signature?.sigs, signature?.error),
        ...(signature?.path ? [meta.text("Signature file", basename(signature.path), { icon: Icons.file })] : []),
        meta.text("Folder", tilde(dirname(sums.path)), { icon: Icons.folder }),
      ],
    },
    actions: [
      action("Check Every File", () => verifyAllView(sums), { icon: Icons.layers }),
      ...keyActions(signature?.sigs),
      open(sums.path, "Open", { icon: Icons.external, section: "File" }),
      open(dirname(sums.path), "Open Folder", { icon: Icons.folder, section: "File", shortcut: "<Ctrl>o" }),
    ],
  };
}

export function signatureItem(
  sig: string,
  target: string | undefined,
  section: string,
  sigs?: Signature[],
  error?: string,
): Item {
  const v = sigs?.[0] ? sigVerdict(sigs[0]) : undefined;
  return {
    id: `${section}:${sig}`,
    title: basename(sig),
    subtitle: target ? (v?.text ?? `Signature of ${basename(target)}`) : "The signed file isn't next to it",
    icon: { source: sigIcon(sigs), tint: v?.color ?? "gray" },
    section,
    accessories: v
      ? [{ tag: v.color === "green" ? "valid" : v.color === "red" ? "INVALID" : "unverified", color: v.color }]
      : [],
    detail: {
      markdown: target
        ? `Detached signature of **${basename(target)}**.`
        : `No **${
          basename(sig).replace(/\.(sig|asc|sign)$/i, "")
        }** next to it: copy or download the signed file into the same folder.`,
      metadata: [
        ...signatureMetadata(sigs, error),
        meta.text("Folder", tilde(dirname(sig)), { icon: Icons.folder }),
      ],
    },
    actions: [
      action("Verify Again", () => refresh(), { icon: Icons.shield }),
      ...keyActions(sigs),
      ...(target ? [open(target, "Open the Signed File", { icon: Icons.external, section: "File" })] : []),
      open(dirname(sig), "Open Folder", { icon: Icons.folder, section: "File", shortcut: "<Ctrl>o" }),
    ],
  };
}

export function clipboardHashItem(h: CopiedHash, matches: string[]): Item {
  return {
    id: "clipboard-hash",
    title: matches.length
      ? `Copied hash matches ${matches.join(", ")}`
      : `Copied ${h.algos.map(algoTitle).join(" or ")} hash`,
    subtitle: matches.length
      ? shortHash(h.hash)
      : `${shortHash(h.hash)} · compared with your copied files and downloads`,
    icon: { source: matches.length ? Icons.done : Icons.paste, tint: matches.length ? "green" : "blue" },
    section: "Clipboard",
    detail: {
      markdown: `**${h.algos.map(algoTitle).join(" or ")}**${h.name ? ` of ${h.name}` : ""}\n\n\`\`\`\n${
        groupedHash(h.hash)
      }\n\`\`\``,
    },
    actions: [copy(h.hash, "Copy Hash")],
  };
}

export function pathForm(): FormSpec {
  return form({
    title: "Open File",
    submitTitle: "Open",
    fields: [field.text("path", "Path", { required: true, placeholder: "~/Downloads/linux.iso" })],
    async submit(values) {
      const path = expandHome(String(values.path ?? ""));
      const f = await fileEntry(path).catch(() => undefined);
      if (!f) {
        await toast(`Can't read ${tilde(path)}`, { style: "failure", message: "Files must be in your home folder" });
        return;
      }
      opened.unshift(f);
      changed();
      return pop();
    },
  });
}

export function clipboardHint(): Item {
  return {
    id: "clipboard-hint",
    title: "Copy files in your file manager",
    subtitle: "Or copy a hash from a download page",
    icon: { source: Icons.paste, tint: "gray" },
    section: "Clipboard",
    detail: {
      markdown: [
        "Select files in **Files**, **Dolphin**, **Thunar** or **Nemo** and press **Ctrl+C**, then open Checksums again: their SHA-256 is computed, and checked against a **SHA256SUMS** file and a **.sig** or **.asc** signature next to them.",
        "",
        "Or copy the hash shown on a download page: your recent downloads are compared with it.",
      ].join("\n"),
    },
    actions: [action("Open File by Path", () => pathForm(), { icon: Icons.text })],
  };
}
