import {
  type Action,
  action,
  clipboard,
  close,
  type Color,
  copy,
  exec,
  Icons,
  type Item,
  list,
  meta,
  open,
  openExternal,
  refresh,
  toast,
} from "@backslash/api";
import {
  type Agent,
  agent,
  gpgKeys,
  removeFromAgent,
  SSH_DIR,
  type SshKey,
  sshKeys,
  suggestedName,
} from "../keyring.ts";
import {
  capabilityWords,
  type GpgKey,
  groupFingerprint,
  type KeyHealth,
  keyHealth,
  parsePublicKey,
  sha256Fingerprint,
  shortDate,
  whenWords,
} from "../lib.ts";
import { agentAction, generateForm, PAGES, pasteOn } from "../views.ts";

type Prefs = { terminal?: string };

const HEALTH: Record<KeyHealth, { text: string; color: Color }> = {
  ok: { text: "valid", color: "green" },
  expiring: { text: "expires soon", color: "orange" },
  expired: { text: "expired", color: "red" },
  revoked: { text: "revoked", color: "red" },
  invalid: { text: "invalid", color: "red" },
};

const newKey = (prefs: Prefs) =>
  action("Generate New SSH Key", async () => generateForm(await suggestedName(), prefs.terminal?.trim() || undefined), {
    icon: Icons.plus,
    shortcut: "<Ctrl>n",
    section: "Keys",
  });

// ---------------------------------------------------------------------------
// SSH

function sshItem(k: SshKey, a: Agent, prefs: Prefs): Item {
  const loaded = a.keys.some((x) => x.fingerprint === k.fp.fingerprint);
  const cert = k.certificate;
  const health: KeyHealth = cert?.validTo ? keyHealth({ validity: "", expires: cert.validTo }, Date.now(), 7) : "ok";
  const bad = health === "expired" || health === "revoked" || health === "invalid";
  const comment = k.fp.comment || k.key.comment;
  const actions: Action[] = [
    copy(k.publicText, "Copy Public Key"),
    copy(k.fp.fingerprint, "Copy Fingerprint", { icon: Icons.hash }),
    ...(k.privatePath && !loaded ? [agentAction(k.privatePath, prefs.terminal?.trim() || undefined)] : []),
    ...(loaded
      ? [action("Remove from SSH Agent", async () => {
        await removeFromAgent(k.pubPath);
        await toast("Key removed from the agent", { style: "success" });
        return refresh();
      }, { icon: Icons.minus, shortcut: "<Ctrl>a", section: "Agent" })]
      : []),
    pasteOn("Add to GitHub", k.publicText, PAGES.githubSsh, "GitHub", { shortcut: "<Ctrl>g" }),
    pasteOn("Add to GitLab", k.publicText, PAGES.gitlabSsh, "GitLab"),
    copy(`ssh-copy-id -i ${k.pubPath.replace(SSH_DIR, "~/.ssh")} user@host`, "Copy ssh-copy-id Command", {
      section: "Copy",
    }),
    open(SSH_DIR, "Open ~/.ssh Folder", { icon: Icons.folder, section: "Keys" }),
    newKey(prefs),
  ];
  return {
    id: `ssh:${k.pubPath}`,
    title: k.name,
    subtitle: comment,
    icon: { source: Icons.key, tint: bad ? "red" : loaded ? "green" : "blue" },
    section: "SSH keys",
    keywords: [k.fp.fingerprint, k.fp.type, comment, k.key.algorithm, "ssh"],
    accessories: [
      ...(cert
        ? [{
          tag: health === "ok" ? "certificate" : HEALTH[health].text,
          color: health === "ok" ? "purple" as Color : HEALTH[health].color,
          tooltip: cert.validTo ? `Valid until ${shortDate(cert.validTo)}` : "Valid forever",
        }]
        : []),
      ...(loaded ? [{ tag: "in agent", color: "green" as Color }] : []),
      ...(!k.privatePath && !cert ? [{ tag: "public only", color: "gray" as Color }] : []),
      { text: k.fp.bits ? `${k.fp.type} ${k.fp.bits}` : k.fp.type, tooltip: k.key.algorithm },
    ],
    detail: {
      metadata: [
        meta.text("Type", `${k.fp.type}${k.fp.bits ? ` · ${k.fp.bits} bits` : ""}`, { icon: Icons.key }),
        meta.text("Fingerprint", k.fp.fingerprint, { icon: Icons.hash }),
        ...(comment ? [meta.text("Comment", comment, { icon: Icons.comment })] : []),
        meta.text("SSH agent", loaded ? "Loaded" : a.state === "no-agent" ? "No agent running" : "Not loaded", {
          icon: Icons.shield,
          color: loaded ? "green" : undefined,
        }),
        ...(cert
          ? [
            meta.separator(),
            meta.text(
              "Certificate",
              cert.validTo
                ? `${shortDate(cert.validFrom)} → ${shortDate(cert.validTo)} (${whenWords(cert.validTo)})`
                : "Valid forever",
              { icon: Icons.calendar, color: bad ? "red" : health === "expiring" ? "orange" : undefined },
            ),
            ...(cert.keyId ? [meta.text("Key ID", cert.keyId)] : []),
            ...(cert.principals.length ? [meta.tags("Principals", cert.principals)] : []),
          ]
          : []),
        meta.separator(),
        meta.text("Public key", k.pubPath.replace(SSH_DIR, "~/.ssh"), { icon: Icons.file }),
        meta.text("Private key", k.privatePath ? k.privatePath.replace(SSH_DIR, "~/.ssh") : "Not in ~/.ssh", {
          icon: Icons.lock,
        }),
        ...(k.modified ? [meta.text("Created", shortDate(k.modified), { icon: Icons.clock })] : []),
      ],
    },
    actions,
  };
}

/** Keys the agent holds that aren't in ~/.ssh: hardware tokens, password managers, other folders. */
async function agentOnly(a: Agent, onDisk: SshKey[]): Promise<Item[]> {
  const known = new Set(onDisk.map((k) => k.fp.fingerprint));
  const pubs = await Promise.all(a.publicKeys.map(async (text) => {
    const key = parsePublicKey(text);
    return key ? { text, fingerprint: await sha256Fingerprint(key.blob) } : undefined;
  }));
  return a.keys.filter((k) => !known.has(k.fingerprint)).map((k) => {
    const pub = pubs.find((p) => p?.fingerprint === k.fingerprint)?.text;
    return {
      id: `agent:${k.fingerprint}`,
      title: k.comment || k.fingerprint,
      subtitle: k.comment ? k.fingerprint : undefined,
      icon: { source: Icons.key, tint: "teal" },
      section: "Only in the SSH agent",
      keywords: [k.fingerprint, k.type],
      accessories: [{ tag: "in agent", color: "green" }, { text: `${k.type} ${k.bits}` }],
      detail: {
        markdown: "Loaded in the agent from somewhere else than `~/.ssh`: a password manager, a hardware key…",
        metadata: [
          meta.text("Type", `${k.type} · ${k.bits} bits`, { icon: Icons.key }),
          meta.text("Fingerprint", k.fingerprint, { icon: Icons.hash }),
        ],
      },
      actions: [
        ...(pub
          ? [
            copy(pub, "Copy Public Key"),
            pasteOn("Add to GitHub", pub, PAGES.githubSsh, "GitHub", { shortcut: "<Ctrl>g" }),
            pasteOn("Add to GitLab", pub, PAGES.gitlabSsh, "GitLab"),
          ]
          : []),
        copy(k.fingerprint, "Copy Fingerprint", { icon: Icons.hash }),
      ],
    } satisfies Item;
  });
}

function orphanItem(name: string, prefs: Prefs): Item {
  return {
    id: `orphan:${name}`,
    title: name,
    subtitle: "Private key without its .pub file",
    icon: { source: Icons.lock, tint: "gray" },
    section: "SSH keys",
    accessories: [{ tag: "no .pub", color: "gray" }],
    detail: {
      markdown: [
        "There is no `.pub` next to this private key, so its type and fingerprint aren't shown",
        "(Backslash never opens private keys).",
        "",
        "Recreate the public key with:",
        "",
        "```",
        `ssh-keygen -y -f ~/.ssh/${name} > ~/.ssh/${name}.pub`,
        "```",
      ].join("\n"),
    },
    actions: [
      copy(`ssh-keygen -y -f ~/.ssh/${name} > ~/.ssh/${name}.pub`, "Copy Command to Recreate the .pub"),
      agentAction(`${SSH_DIR}/${name}`, prefs.terminal?.trim() || undefined),
      open(SSH_DIR, "Open ~/.ssh Folder", { icon: Icons.folder, section: "Keys" }),
    ],
  };
}

// ---------------------------------------------------------------------------
// GPG

async function armored(fpr: string): Promise<string> {
  const out = await exec("gpg", ["--batch", "--armor", "--export", fpr]);
  if (!out.includes("BEGIN PGP PUBLIC KEY BLOCK")) throw new Error("gpg exported nothing for this key");
  return out;
}

function gpgItem(k: GpgKey): Item {
  const fpr = k.fingerprint ?? k.keyId;
  const health = keyHealth(k);
  const h = HEALTH[health];
  const bad = health === "expired" || health === "revoked" || health === "invalid";
  const primary = k.uids.find((u) => u.validity !== "r") ?? k.uids[0];
  const emails = [...new Set(k.uids.map((u) => u.email).filter((e): e is string => !!e))];
  const caps = capabilityWords(k.capabilities);
  const copyArmored = (site?: { title: string; url: string; name: string; shortcut?: string }) =>
    action(site?.title ?? "Copy Public Key (Armored)", async () => {
      await clipboard.write(await armored(fpr));
      if (!site) return close("Public key copied");
      await openExternal(site.url);
      return close(`Public key copied: paste it on ${site.name}`);
    }, site ? { icon: Icons.external, section: "Add to a Service", shortcut: site.shortcut } : { icon: Icons.copy });
  return {
    id: `gpg:${fpr}`,
    title: primary?.name ?? k.keyId,
    subtitle: emails.join(", "),
    icon: {
      source: k.secret ? Icons.key : Icons.lock,
      tint: bad ? "red" : health === "expiring" ? "orange" : "purple",
    },
    section: k.secret ? "GPG keys" : "GPG public keys (others)",
    keywords: [fpr, k.keyId, ...emails, ...k.uids.map((u) => u.name), "gpg", "pgp", "gnupg"],
    accessories: [
      ...(health !== "ok"
        ? [{
          tag: h.text,
          color: h.color,
          tooltip: k.expires ? `${health === "expired" ? "Expired" : "Expires"} ${shortDate(k.expires)}` : undefined,
        }]
        : []),
      ...(k.card === ">" ? [{ tag: "smartcard", color: "teal" as Color }] : []),
      ...(k.card === "#" ? [{ tag: "offline secret", color: "gray" as Color }] : []),
      { text: k.algorithm, tooltip: caps.join(", ") },
    ],
    detail: {
      metadata: [
        meta.text("Fingerprint", groupFingerprint(fpr), { icon: Icons.hash }),
        meta.text("Key ID", k.keyId),
        meta.text("Algorithm", k.algorithm, { icon: Icons.key }),
        meta.tags("Can", caps.map((c) => ({ text: c }))),
        meta.tags("Status", [{ text: h.text, color: h.color }, ...(k.secret ? [{ text: "secret key here" }] : [])]),
        meta.text("Created", shortDate(k.created), { icon: Icons.calendar }),
        meta.text("Expires", k.expires ? `${shortDate(k.expires)} (${whenWords(k.expires)})` : "Never", {
          icon: Icons.clock,
          color: bad ? "red" : health === "expiring" ? "orange" : undefined,
        }),
        meta.separator(),
        ...k.uids.map((u) =>
          meta.text(u.validity === "r" ? "Identity (revoked)" : "Identity", u.uid, {
            icon: Icons.person,
            color: u.validity === "r" ? "red" : undefined,
          })
        ),
        ...k.subkeys.map((s) => {
          const sh = keyHealth(s);
          return meta.text(
            `Subkey (${capabilityWords(s.capabilities).join(", ") || "none"})`,
            `${s.algorithm} · ${s.expires ? `expires ${shortDate(s.expires)}` : "no expiry"}`,
            { color: sh === "ok" ? undefined : HEALTH[sh].color },
          );
        }),
      ],
    },
    actions: [
      copyArmored(),
      copy(fpr, "Copy Fingerprint", { icon: Icons.hash }),
      copy(k.keyId, "Copy Key ID", { section: "Copy" }),
      ...(emails[0] ? [copy(emails[0], "Copy Email", { section: "Copy" })] : []),
      copyArmored({ title: "Add to GitHub", url: PAGES.githubGpg, name: "GitHub", shortcut: "<Ctrl>g" }),
      copyArmored({ title: "Add to GitLab", url: PAGES.gitlabGpg, name: "GitLab" }),
      ...(k.secret && !bad
        ? [action("Publish to keys.openpgp.org", async () => {
          await exec("gpg", ["--batch", "--keyserver", "hkps://keys.openpgp.org", "--send-keys", fpr]);
          await toast("Sent to keys.openpgp.org", {
            style: "success",
            message: "Check your email to make your addresses searchable",
          });
        }, {
          icon: Icons.upload,
          confirm: "Publish this public key to keys.openpgp.org?",
          section: "Add to a Service",
        })]
        : []),
    ],
  };
}

// ---------------------------------------------------------------------------

let summary = "";

export default list({
  placeholder: "Filter keys by name, comment, email, fingerprint…",
  filter: {
    options: [{ value: "all", title: "All" }, { value: "ssh", title: "SSH" }, { value: "gpg", title: "GPG" }],
    default: "all",
  },
  empty: {
    title: "No keys yet",
    description: "Generate an SSH key with Ctrl+N",
    icon: Icons.key,
  },
  status: () => summary,
  actions: [
    action(
      "Generate New SSH Key",
      async ({ preferences }) =>
        generateForm(await suggestedName(), String(preferences.terminal ?? "").trim() || undefined),
      { icon: Icons.plus, shortcut: "<Ctrl>n" },
    ),
    open(SSH_DIR, "Open ~/.ssh Folder", { icon: Icons.folder }),
  ],
  async items({ preferences, filter, signal }) {
    const prefs = preferences as Prefs;
    const wantSsh = filter !== "gpg", wantGpg = filter !== "ssh";
    const [ssh, a, gpg] = await Promise.all([
      wantSsh ? sshKeys(signal) : Promise.resolve({ keys: [], orphans: [], names: [] }),
      wantSsh ? agent(signal) : Promise.resolve<Agent>({ state: "ok", keys: [], publicKeys: [] }),
      wantGpg ? gpgKeys(signal) : Promise.resolve({ keys: [], installed: true }),
    ]);
    const extra = wantSsh ? await agentOnly(a, ssh.keys) : [];
    const expired = gpg.keys.filter((k) => k.secret && keyHealth(k) === "expired").length;
    summary = [
      ...(wantSsh ? [`${ssh.keys.length} SSH key${ssh.keys.length === 1 ? "" : "s"}`] : []),
      ...(wantSsh
        ? [
          a.state === "ok" || a.state === "empty"
            ? `${a.keys.length} in agent`
            : a.state === "missing"
            ? "ssh-add not installed"
            : "no SSH agent",
        ]
        : []),
      ...(wantGpg
        ? [gpg.installed ? `${gpg.keys.filter((k) => k.secret).length} GPG secret keys` : "gpg not installed"]
        : []),
      ...(expired ? [`${expired} expired`] : []),
    ].join(" · ");
    const gpgOrder = (k: GpgKey) => (k.secret ? 0 : 2) + (keyHealth(k) === "ok" || keyHealth(k) === "expiring" ? 0 : 1);
    return [
      ...ssh.keys.map((k) => sshItem(k, a, prefs)),
      ...ssh.orphans.map((n) => orphanItem(n, prefs)),
      ...extra,
      ...[...gpg.keys].sort((x, y) => gpgOrder(x) - gpgOrder(y)).map(gpgItem),
    ];
  },
});
