import { action, Icons, type Item, list } from "@backslash/api";
import { type Algo, copiedHash, isSumsFile, SIGNATURE, type Signature, signedFile } from "../lib.ts";
import {
  clipboardContent,
  existsFile,
  type FileEntry,
  fileEntry,
  hashOf,
  kindOf,
  readSums,
  recentDownloads,
  signatureFor,
  type Sums,
  sumsFor,
  verifySignature,
} from "../system.ts";
import {
  clipboardHashItem,
  clipboardHint,
  compare,
  fileItem,
  type FileState,
  knownMatch,
  nextChange,
  opened,
  pathForm,
  recentItem,
  signatureItem,
  sumsItem,
} from "../ui.ts";

interface SigState {
  sig: string;
  target?: string;
  section: string;
  sigs?: Signature[];
  error?: string;
}

interface SumsState {
  sums: Sums;
  section: string;
  signature?: { path?: string; sigs?: Signature[]; error?: string };
}

let counts = { files: 0, verified: 0 };

const message = (e: unknown) => String((e as Error).message ?? e);

export default list({
  placeholder: "Copied files, sums files and signatures…",
  empty: { title: "Nothing to check", description: "Copy files in your file manager", icon: Icons.hash },
  actions: [action("Open File by Path", () => pathForm(), { icon: Icons.text, shortcut: "<Ctrl>p" })],
  status: () =>
    counts.files
      ? `${counts.files} file${counts.files === 1 ? "" : "s"}${counts.verified ? ` · ${counts.verified} verified` : ""}`
      : "Nothing copied",
  // Rows first; hashes, sums and signatures fill in one file at a time.
  async *items({ signal }) {
    const [{ paths, text }, recent] = await Promise.all([clipboardContent(), recentDownloads()]);
    const clip = copiedHash(text);
    const files: FileState[] = [];
    const sigs: SigState[] = [];
    const sumsFiles: SumsState[] = [];
    const seen = new Set<string>();

    const classify = async (f: FileEntry, section: string) => {
      if (seen.has(f.path)) return;
      seen.add(f.path);
      if (isSumsFile(f.name)) {
        const sums = await readSums(f.path);
        if (sums?.entries.length) {
          sumsFiles.push({ sums, section });
          return;
        }
      }
      if (SIGNATURE.test(f.name) && ["signature", "binary"].includes(await kindOf(f.path))) {
        const target = signedFile(f.path);
        sigs.push({ sig: f.path, target: target && (await existsFile(target)) ? target : undefined, section });
        return;
      }
      files.push({ f, section });
    };
    const copied = (await Promise.all(paths.map(fileEntry))).filter((f): f is FileEntry => !!f);
    for (const f of copied) await classify(f, "Clipboard");
    const others = recent.filter((f) => !seen.has(f.path));

    const build = (): Item[] => {
      const matches = clip
        ? [...files.map((s) => s.f), ...others].filter((f) => knownMatch(f, clip)?.ok).map((f) => f.name)
        : [];
      counts = {
        files: files.length + sigs.length + sumsFiles.length,
        verified: files.filter((s) => s.signatures?.some((x) => x.status === "good")).length,
      };
      return [
        ...(clip ? [clipboardHashItem(clip, matches)] : []),
        ...files.map((s) => fileItem(s, clip)),
        ...sumsFiles.map((s) => sumsItem(s.sums, s.section, s.signature)),
        ...sigs.map((s) => signatureItem(s.sig, s.target, s.section, s.sigs, s.error)),
        ...(paths.length || clip || opened.length ? [] : [clipboardHint()]),
        ...others.map((f) => recentItem(f, clip)),
      ];
    };

    yield build();
    const done = new Set<object>();
    while (!signal.aborted) {
      for (const f of opened) await classify(f, "Opened");
      // Each copied file: its SHA-256, the sums file next to it, its signature, the copied hash.
      for (const s of files.filter((s) => !done.has(s))) {
        done.add(s);
        try {
          await hashOf(s.f, "sha256", signal);
          s.sums = await sumsFor(s.f);
          if (s.sums) await hashOf(s.f, (s.sums.entry.algo ?? "sha256") as Algo, signal);
          if (clip) await compare(s.f, clip, signal);
        } catch (e) {
          if (signal.aborted) return;
          s.error = message(e);
        }
        s.sig = await signatureFor(s.f.path);
        if (s.sig) {
          try {
            s.signatures = await verifySignature(s.sig, s.f.path, signal);
          } catch (e) {
            if (signal.aborted) return;
            s.sigError = message(e);
          }
        }
        yield build();
      }
      for (const s of sigs.filter((s) => !done.has(s))) {
        done.add(s);
        if (!s.target) continue;
        try {
          s.sigs = await verifySignature(s.sig, s.target, signal);
        } catch (e) {
          if (signal.aborted) return;
          s.error = message(e);
        }
        yield build();
      }
      for (const s of sumsFiles.filter((s) => !done.has(s))) {
        done.add(s);
        // A clearsigned SHA256SUMS carries its signature; else SHA256SUMS.asc / .sig / .gpg next to it.
        const path = s.sums.clearsigned ? undefined : await signatureFor(s.sums.path);
        if (!s.sums.clearsigned && !path) continue;
        try {
          s.signature = {
            path,
            sigs: await verifySignature(path ?? s.sums.path, path ? s.sums.path : undefined, signal),
          };
        } catch (e) {
          if (signal.aborted) return;
          s.signature = { path, error: message(e) };
        }
        yield build();
      }
      // A copied hash: which recent download is it?
      if (clip) {
        for (const f of others.filter((f) => !done.has(f))) {
          done.add(f);
          try {
            if ((await compare(f, clip, signal)).ok) break;
          } catch {
            if (signal.aborted) return;
          }
        }
      }
      yield build();
      await nextChange(signal);
    }
  },
});
