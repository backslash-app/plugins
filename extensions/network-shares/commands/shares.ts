import {
  type Action,
  action,
  clipboard,
  close,
  copy,
  field,
  form,
  type FormSpec,
  type Icon,
  Icons,
  type Item,
  list,
  meta,
  openExternal,
  pop,
  refresh,
  toast,
} from "@backslash/api";
import {
  ago,
  displayAddress,
  findMount,
  type Kind,
  kindOf,
  type Method,
  type Mounted,
  newId,
  normalizeAddress,
  parseUri,
  type Share,
  slug,
  suggestName,
  systemKind,
  type SystemMount,
  systemUri,
  userMountable,
  withUser,
} from "../lib.ts";
import {
  type Credentials,
  domainOf,
  fstab,
  fstabMount,
  gioMount,
  gioMounts,
  gioUnmount,
  mountInTerminal,
  NeedsCredentials,
  openTarget,
  saveShares,
  shares,
  sshfsMount,
  systemMounts,
  tilde,
  unmountPath,
  upsert,
  userOf,
} from "../system.ts";

const ICON: Record<Kind, string> = { SMB: Icons.folder, NFS: Icons.server, SFTP: Icons.terminal, WebDAV: Icons.cloud };
const METHOD: Record<Method, string> = {
  gio: "GVfs (gio), like the file manager",
  sshfs: "sshfs, into a folder",
  fstab: "mount, from its /etc/fstab line",
};

type Prefs = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Mounting

async function mountShare(s: Share, creds?: Credentials): Promise<void> {
  if (s.method === "sshfs") await sshfsMount(s, creds?.password);
  else if (s.method === "fstab") await fstabMount(s.mountpoint ?? "");
  else await gioMount(creds?.user ? withUser(s.uri, creds.user, creds.domain) : s.uri, creds);
  await upsert({ ...s, lastMounted: Date.now() });
}

/** Mounts, asking for a password when the server wants one; opens the share after when asked. */
async function mountFlow(s: Share, openAfter: boolean, prefs: Prefs, creds?: Credentials) {
  try {
    await toast(`Mounting ${s.name}…`);
    await mountShare(s, creds);
  } catch (e) {
    if (e instanceof NeedsCredentials) return signInForm(s, openAfter, prefs);
    throw e;
  }
  if (!openAfter) {
    await toast(`${s.name} mounted`, { style: "success" });
    return refresh();
  }
  const m = findMount(s, await gioMounts(), await systemMounts());
  await openExternal(m ? await openTarget(m) : s.uri);
  return close(`${s.name} mounted`);
}

function signInForm(s: Share, openAfter: boolean, prefs: Prefs): FormSpec {
  const kind = kindOf(s.uri);
  return form({
    title: `Sign In to ${s.name}`,
    submitTitle: openAfter ? "Mount and Open" : "Mount",
    fields: [
      ...(s.method === "sshfs" ? [] : [
        field.text("user", "User name", { value: userOf(s.uri) ?? "", placeholder: "Leave empty for guest access" }),
      ]),
      ...(kind === "SMB"
        ? [field.text("domain", "Domain", { value: domainOf(s.uri) ?? "", placeholder: "WORKGROUP (usually)" })]
        : []),
      field.password("password", "Password", { required: true }),
    ],
    async submit(values) {
      const creds: Credentials = {
        user: s.method === "sshfs" ? undefined : String(values.user ?? "").trim(),
        domain: String(values.domain ?? "").trim() || undefined,
        password: String(values.password ?? ""),
      };
      // The password is passed to gio or sshfs and forgotten; GVfs keeps the mount signed in.
      const outcome = await mountFlow(s, openAfter, prefs, creds);
      return outcome && "type" in outcome && outcome.type === "refresh" ? pop() : outcome;
    },
  });
}

async function unmountShare(s: Share, m: Mounted) {
  if (s.method === "gio") await gioUnmount(m.root ?? s.uri);
  else await unmountPath(m.location, s.method === "sshfs");
}

// ---------------------------------------------------------------------------
// Adding and editing

function shareForm(title: string, initial: Partial<Share>, existing?: Share): FormSpec {
  return form({
    title,
    submitTitle: existing ? "Save" : "Add Share",
    fields: [
      field.text("address", "Address", {
        value: initial.uri ?? "",
        required: true,
        placeholder: "smb://nas.local/photos, nfs://nas/export, ada@server:/srv, https://cloud.example.com/dav",
      }),
      field.text("name", "Name", { value: initial.name ?? "", placeholder: "Optional: Photos on the NAS" }),
      field.dropdown(
        "method",
        "Mount with",
        (Object.keys(METHOD) as Method[]).map((m) => ({ value: m, title: METHOD[m] })),
        { value: initial.method ?? "gio" },
      ),
      field.text("mountpoint", "Mount point", {
        value: initial.mountpoint ?? "",
        placeholder: "sshfs and fstab only, e.g. ~/mnt/server (sshfs: created if needed)",
      }),
    ],
    async submit(values) {
      const uri = normalizeAddress(String(values.address ?? ""));
      const method = (String(values.method || "gio")) as Method;
      const name = String(values.name ?? "").trim() || suggestName(uri);
      let mountpoint = String(values.mountpoint ?? "").trim() || undefined;
      if (method === "sshfs") {
        if (parseUri(uri).scheme !== "sftp") throw new Error("sshfs mounts SSH addresses: ada@server:/srv or sftp://");
        mountpoint ??= `~/mnt/${slug(name)}`;
      }
      if (method === "fstab" && !mountpoint) throw new Error("Give the mount point of its /etc/fstab line");
      const s: Share = {
        id: existing?.id ?? newId(name),
        name,
        uri,
        method,
        mountpoint: method === "gio" ? undefined : mountpoint,
        lastMounted: existing?.lastMounted,
      };
      const others = (await shares()).filter((x) => x.id !== s.id);
      if (others.some((x) => x.uri === s.uri && x.method === s.method)) {
        throw new Error(`${displayAddress(uri)} is already saved`);
      }
      await upsert(s);
      await toast(existing ? `${s.name} saved` : `${s.name} added`, { style: "success" });
      return pop();
    },
  });
}

const addAction = (shortcut = true) =>
  action("Add Share", () => shareForm("Add Network Share", {}), {
    icon: Icons.plus,
    shortcut: shortcut ? "<Ctrl>n" : undefined,
    section: "Shares",
  });

// ---------------------------------------------------------------------------
// Rows

function shareRow(s: Share, m: Mounted | undefined, prefs: Prefs): Item {
  const kind = kindOf(s.uri);
  const user = userOf(s.uri);
  const where = s.mountpoint ? tilde(s.mountpoint) : undefined;
  const openIt = action("Open in File Manager", async () => {
    await openExternal(await openTarget(m!));
    return close();
  }, { icon: Icons.folder });
  const actions: Action[] = m
    ? [
      openIt,
      action("Unmount", async () => {
        await unmountShare(s, m);
        await toast(`${s.name} unmounted`, { style: "success" });
        return refresh();
      }, { icon: Icons.upload, shortcut: "<Ctrl>u" }),
    ]
    : [
      action("Mount and Open", () => mountFlow(s, true, prefs), { icon: Icons.folder }),
      action("Mount", () => mountFlow(s, false, prefs), { icon: Icons.download, shortcut: "<Ctrl>m" }),
      action("Sign In and Mount…", () => signInForm(s, true, prefs), { icon: Icons.key, shortcut: "<Ctrl>p" }),
    ];
  actions.push(
    action("Mount in Terminal", () => {
      const term = mountInTerminal(s, String(prefs.terminal ?? ""));
      return close(`Mounting in ${term}`);
    }, { icon: Icons.terminal, shortcut: "<Ctrl>t", section: "Share" }),
    copy(s.uri, "Copy Address", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    ...(m && !/^[a-z]+:\/\//.test(m.location) ? [copy(m.location, "Copy Local Path", { section: "Copy" })] : []),
    ...(m && /^[a-z]+:\/\//.test(m.location)
      ? [action("Copy Local Path", async () => {
        const path = await openTarget(m);
        if (/^[a-z]+:\/\//.test(path)) throw new Error("GVfs has no local folder for it (is gvfs-fuse running?)");
        await clipboard.write(path);
        return close("Local path copied");
      }, { icon: Icons.copy, section: "Copy" })]
      : []),
    action("Edit", () => shareForm(`Edit ${s.name}`, s, s), {
      icon: Icons.settings,
      shortcut: "<Ctrl>e",
      section: "Share",
    }),
    addAction(),
    action("Remove", async () => {
      await saveShares((await shares()).filter((x) => x.id !== s.id));
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Remove ${s.name} from the list? It stays on the server`,
      shortcut: "<Ctrl>Delete",
      section: "Shares",
    }),
  );
  return {
    id: s.id,
    title: s.name,
    subtitle: `${user ? `${user}@` : ""}${displayAddress(s.uri)}`,
    icon: { source: ICON[kind], tint: m ? "green" : "blue" } as Icon,
    section: "Saved Shares",
    keywords: [kind, s.method, s.uri, where ?? ""],
    accessories: [
      { tag: kind, color: "gray" },
      m ? { icon: { source: Icons.dot, tint: "green" }, text: "mounted" } : { text: "not mounted", color: "gray" },
    ],
    detail: {
      metadata: [
        meta.text("Status", m ? "Mounted" : "Not mounted", { icon: Icons.dot, color: m ? "green" : "gray" }),
        meta.text("Address", s.uri, { icon: Icons.link }),
        meta.text("Type", kind, { icon: ICON[kind] }),
        ...(user ? [meta.text("User", user, { icon: Icons.person })] : []),
        meta.text("Mounted with", METHOD[s.method], { icon: Icons.plug }),
        ...(where ? [meta.text("Mount point", where, { icon: Icons.folder })] : []),
        ...(m && !/^[a-z]+:\/\//.test(m.location) ? [meta.text("Local folder", tilde(m.location))] : []),
        ...(s.lastMounted ? [meta.text("Last mounted", ago(s.lastMounted), { icon: Icons.history })] : []),
      ],
    },
    actions,
  };
}

/** A network mount nobody saved here: unmount it, open it, or save it. */
function otherRow(
  title: string,
  uri: string | undefined,
  kind: Kind,
  target: string,
  unmount: () => Promise<void>,
): Item {
  return {
    id: `mount:${target}`,
    title,
    subtitle: uri ? displayAddress(uri) : target,
    icon: { source: ICON[kind], tint: "green" },
    section: "Other Network Mounts",
    keywords: [kind, target],
    accessories: [{ tag: kind, color: "gray" }, { icon: { source: Icons.dot, tint: "green" }, text: "mounted" }],
    detail: {
      metadata: [
        meta.text("Status", "Mounted", { icon: Icons.dot, color: "green" }),
        ...(uri ? [meta.text("Address", uri, { icon: Icons.link })] : []),
        meta.text("Type", kind, { icon: ICON[kind] }),
        meta.text("Where", tilde(target), { icon: Icons.folder }),
      ],
    },
    actions: [
      action("Open in File Manager", async () => {
        await openExternal(/^[a-z]+:\/\//.test(target) ? await openTarget({ location: target }) : target);
        return close();
      }, { icon: Icons.folder }),
      action("Unmount", async () => {
        await unmount();
        await toast(`${title} unmounted`, { style: "success" });
        return refresh();
      }, { icon: Icons.upload, shortcut: "<Ctrl>u" }),
      ...(uri
        ? [action("Save to My Shares", () => shareForm("Save Network Share", { uri, name: title }), {
          icon: Icons.plus,
          shortcut: "<Ctrl>s",
        })]
        : []),
      copy(uri ?? target, "Copy Address", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    ],
  };
}

/** An /etc/fstab network line the user may mount, not saved yet. */
function fstabRow(f: SystemMount): Item {
  const uri = systemUri(f);
  const kind = systemKind(f);
  const name = f.target.split("/").pop() || f.target;
  return {
    id: `fstab:${f.target}`,
    title: name,
    subtitle: f.source,
    icon: { source: ICON[kind], tint: "gray" },
    section: "In /etc/fstab",
    keywords: [kind, f.target, "fstab"],
    accessories: [{ tag: kind, color: "gray" }, { text: "not mounted", color: "gray" }],
    detail: {
      metadata: [
        meta.text("Source", f.source, { icon: Icons.link }),
        meta.text("Mount point", f.target, { icon: Icons.folder }),
        meta.text("File system", f.fstype),
        meta.text("Options", f.options.join(", ")),
      ],
    },
    actions: [
      action("Mount and Open", async () => {
        await fstabMount(f.target);
        await openExternal(f.target);
        return close(`${name} mounted`);
      }, { icon: Icons.folder }),
      action("Save to My Shares", () =>
        shareForm("Save Network Share", {
          uri: uri ?? "",
          name,
          method: "fstab",
          mountpoint: f.target,
        }), { icon: Icons.plus, shortcut: "<Ctrl>s" }),
    ],
  };
}

let status = "";

export default list({
  placeholder: "Filter shares…",
  empty: {
    title: "No network share yet",
    description: "Add one with Ctrl+N: smb://nas.local/photos, nfs://nas/export, ada@server:/srv or a WebDAV URL",
    icon: Icons.folder,
  },
  status: () => status,
  actions: [addAction()],
  async items({ preferences, signal }) {
    const [saved, gio, system, tab] = await Promise.all([shares(), gioMounts(signal), systemMounts(), fstab()]);
    saved.sort((a, b) => a.name.localeCompare(b.name));
    const found = saved.map((s) => ({ s, m: findMount(s, gio, system) }));
    const usedGio = new Set(found.flatMap(({ m }) => (m?.root ? [m.root] : [])));
    const usedPaths = new Set(found.flatMap(({ m }) => (m && !m.root ? [m.location] : [])));
    const savedPoints = new Set(saved.flatMap((s) => (s.mountpoint ? [s.mountpoint] : [])));

    const others: Item[] = [
      ...gio.filter((g) => !usedGio.has(g.uri)).map((g) =>
        otherRow(g.name, g.uri, kindOf(g.uri), g.uri, () => gioUnmount(g.uri))
      ),
      ...system.filter((m) => !usedPaths.has(m.target)).map((m) =>
        otherRow(
          tilde(m.target).split("/").pop() || m.target,
          systemUri(m),
          systemKind(m),
          m.target,
          () => unmountPath(m.target, m.fstype.startsWith("fuse") || m.fstype === "sshfs"),
        )
      ),
    ];
    const mountedPaths = new Set(system.map((m) => m.target));
    const fromFstab = tab.filter((f) => userMountable(f) && !mountedPaths.has(f.target) && !savedPoints.has(f.target))
      .map(fstabRow);

    const mounted = found.filter(({ m }) => m).length + others.length;
    status = `${saved.length} saved · ${mounted} mounted`;
    return [...found.map(({ s, m }) => shareRow(s, m, preferences)), ...others, ...fromFstab];
  },
});
