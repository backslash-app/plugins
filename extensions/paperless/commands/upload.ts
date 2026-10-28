import {
  type Action,
  action,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  open,
  pop,
  refresh,
  toast,
} from "@backslash/api";
import { names, type Server, server, SetupError, setupItem, task, upload } from "../api.ts";
import { clipboardFiles, type LocalFile, localFile, recentFiles, saveUploads, type Upload, uploads } from "../files.ts";
import { ago, bytes, CONSUMABLE, stem, type TaskState, taskState, webUrl } from "../lib.ts";

const POLL_MS = 2_000;

const changes = new EventTarget();
const changed = () => changes.dispatchEvent(new Event("change"));
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      changes.removeEventListener("change", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    changes.addEventListener("change", done);
    signal.addEventListener("abort", done);
  });
}

const tilde = (p: string) => p.replace(/^\/home\/[^/]+/, "~");

async function send(s: Server, files: LocalFile[], o: Parameters<typeof upload>[2] = {}): Promise<void> {
  const list = await uploads();
  for (const f of files) {
    await toast(`Uploading ${f.name}…`);
    const taskId = await upload(s, f.path, o);
    list.unshift({ taskId, name: f.name, path: f.path, at: Date.now(), last: { state: "pending" } });
  }
  await saveUploads(list);
  await toast(
    files.length === 1 ? `Uploaded ${files[0].name}` : `Uploaded ${files.length} files`,
    { style: "success", message: "Paperless-ngx is processing it" },
  );
  changed();
}

async function detailsForm(s: Server, f: LocalFile) {
  const n = await names(s);
  const opts = (m: Record<string, string>) => [
    { value: "", title: "Automatic" },
    ...Object.entries(m).sort((a, b) => a[1].localeCompare(b[1])).map(([value, title]) => ({ value, title })),
  ];
  const tagNames = Object.fromEntries(Object.entries(n.tags).map(([id, t]) => [id, t.name]));
  return form({
    title: `Upload ${f.name}`,
    submitTitle: "Upload",
    fields: [
      field.text("title", "Title", { placeholder: stem(f.name) }),
      field.dropdown("correspondent", "Correspondent", opts(n.correspondents), { value: "" }),
      field.dropdown("type", "Document type", opts(n.types), { value: "" }),
      field.dropdown("tag", "Tag", opts(tagNames), { value: "" }),
    ],
    async submit(v) {
      await send(s, [f], {
        title: String(v.title ?? "").trim() || undefined,
        correspondent: v.correspondent ? Number(v.correspondent) : undefined,
        documentType: v.type ? Number(v.type) : undefined,
        tags: v.tag ? [Number(v.tag)] : undefined,
      });
      return pop();
    },
  });
}

function fileItem(s: Server, f: LocalFile, section: string, all: LocalFile[]): Item {
  const actions: Action[] = [
    action("Upload to Paperless-ngx", async () => {
      await send(s, [f]);
      return refresh();
    }, { icon: Icons.upload }),
    action("Upload with Details…", () => detailsForm(s, f), { icon: Icons.tag, shortcut: "<Ctrl>e" }),
  ];
  if (all.length > 1) {
    actions.push(
      action(`Upload All ${all.length} ${section === "Copied Files" ? "Copied" : "Recent"} Files`, async () => {
        await send(s, all);
        return refresh();
      }, { icon: Icons.layers, shortcut: "<Ctrl><Shift>u" }),
    );
  }
  actions.push(open(f.path, "Open File", { icon: Icons.file, shortcut: "<Ctrl>o", section: "File" }));
  return {
    id: `${section}:${f.path}`,
    title: f.name,
    subtitle: tilde(f.path.slice(0, f.path.lastIndexOf("/"))),
    icon: { source: /\.(png|jpe?g|tiff?|gif|webp|bmp|heic)$/i.test(f.name) ? Icons.image : Icons.file, tint: "blue" },
    section,
    accessories: [{ text: bytes(f.size) }, { text: ago(f.modified), icon: Icons.clock }],
    detail: {
      image: /\.(png|jpe?g|gif|webp)$/i.test(f.name) ? f.path : undefined,
      metadata: [
        meta.text("File", f.name, { icon: Icons.file }),
        meta.text("Folder", tilde(f.path.slice(0, f.path.lastIndexOf("/"))), { icon: Icons.folder }),
        meta.text("Size", bytes(f.size), { icon: Icons.archive }),
        meta.text("Modified", ago(f.modified), { icon: Icons.clock }),
      ],
    },
    actions,
  };
}

const LOOK: Record<TaskState["state"], { label: string; icon: string; tint: "gray" | "blue" | "green" | "red" }> = {
  pending: { label: "Queued", icon: Icons.clock, tint: "gray" },
  running: { label: "Processing", icon: Icons.inProgress, tint: "blue" },
  done: { label: "Added", icon: Icons.done, tint: "green" },
  failed: { label: "Failed", icon: Icons.alert, tint: "red" },
};

function uploadItem(s: Server, u: Upload): Item {
  const st = u.last ?? { state: "pending" as const };
  const look = LOOK[st.state];
  const actions: Action[] = [];
  if (st.documentId) {
    actions.push(open(webUrl(s.base, st.documentId), "Open in Paperless-ngx", { icon: Icons.external }));
  } else actions.push(open(`${s.base}/tasks`, "Open Tasks in Paperless-ngx", { icon: Icons.external }));
  actions.push(
    action("Clear from List", async () => {
      await saveUploads((await uploads()).filter((x) => x.taskId !== u.taskId));
      return refresh();
    }, { icon: Icons.cross, section: "List" }),
  );
  return {
    id: `upload:${u.taskId}`,
    title: u.name,
    subtitle: st.state === "failed"
      ? st.message
      : st.state === "done"
      ? st.message?.replace(/^Success\.\s*/, "")
      : undefined,
    icon: { source: look.icon, tint: look.tint },
    section: "Uploads",
    accessories: [{ tag: look.label, color: look.tint }, { text: ago(u.at) }],
    detail: {
      markdown: st.message ? st.message : undefined,
      metadata: [
        meta.text("Status", look.label, { icon: look.icon, color: look.tint }),
        meta.text("File", tilde(u.path), { icon: Icons.file }),
        meta.text("Uploaded", ago(u.at), { icon: Icons.clock }),
        ...(st.documentId ? [meta.link("Document", `#${st.documentId}`, webUrl(s.base, st.documentId))] : []),
      ],
    },
    actions,
  };
}

export default list({
  placeholder: "Pick a file to upload to Paperless-ngx…",
  empty: {
    title: "No file to upload",
    description: "Copy files in your file manager (Ctrl+C), then open this command again",
    icon: Icons.upload,
  },
  async *items({ preferences, signal }) {
    let s: Server;
    try {
      s = server(preferences);
    } catch (e) {
      if (e instanceof SetupError) {
        yield [setupItem(e)];
        return;
      }
      throw e;
    }
    const [copied, recent] = await Promise.all([
      clipboardFiles().then(async (paths) =>
        (await Promise.all(paths.map(localFile))).filter((f): f is LocalFile => !!f && CONSUMABLE.test(f.name))
      ),
      recentFiles(),
    ]);
    const others = recent.filter((r) => !copied.some((c) => c.path === r.path));
    const files = [
      ...copied.map((f) => fileItem(s, f, "Copied Files", copied)),
      ...others.map((f) => fileItem(s, f, "Recent Files", others)),
    ];
    while (!signal.aborted) {
      const list = await uploads();
      const pending = list.filter((u) => u.last?.state !== "done" && u.last?.state !== "failed");
      if (pending.length) {
        try {
          await Promise.all(pending.map(async (u) => {
            const t = await task(s, u.taskId, signal);
            if (t) u.last = taskState(t);
          }));
          await saveUploads(list);
        } catch (e) {
          if (signal.aborted) return;
          if (e instanceof SetupError) {
            yield [setupItem(e)];
            return;
          }
          // Shown with their last known state.
        }
      }
      yield [...list.map((u) => uploadItem(s, u)), ...files];
      await wait(pending.length ? POLL_MS : 60_000, signal);
    }
  },
});
