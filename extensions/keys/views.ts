// The "generate a key" form and the GitHub / GitLab shortcuts, shared by both commands.

import {
  type Action,
  action,
  clipboard,
  close,
  copy,
  detail,
  field,
  form,
  type FormSpec,
  Icons,
  openExternal,
  replace,
  toast,
} from "@backslash/api";
import { addToAgent, generate, HOME, SSH_DIR } from "./keyring.ts";
import { runInTerminal, shellLine } from "./terminal.ts";

export const PAGES = {
  githubSsh: "https://github.com/settings/ssh/new",
  gitlabSsh: "https://gitlab.com/-/user_settings/ssh_keys",
  githubGpg: "https://github.com/settings/gpg/new",
  gitlabGpg: "https://gitlab.com/-/user_settings/gpg_keys",
};

/** Copies the key, then opens the page where it is pasted. */
export function pasteOn(title: string, text: string, url: string, site: string, options = {}): Action {
  return action(title, async () => {
    await clipboard.write(text);
    await openExternal(url);
    return close(`Public key copied: paste it on ${site}`);
  }, { icon: Icons.external, section: "Add to a Service", ...options });
}

export function agentAction(privatePath: string, terminal?: string): Action {
  return action("Add to SSH Agent", async () => {
    if (await addToAgent(privatePath)) {
      await toast("Key added to the agent", { style: "success" });
      return;
    }
    // A passphrase is needed and no askpass dialog is available: ask in a terminal.
    const script = `${shellLine(["ssh-add", privatePath])} || { echo; printf 'Press Enter to close.'; read _; }`;
    const term = runInTerminal(["sh", "-c", script], terminal);
    await toast(`Type the passphrase in ${term}`);
  }, { icon: Icons.plus, shortcut: "<Ctrl>a", section: "Agent" });
}

function userName(): string {
  try {
    return Deno.env.get("USER") ?? "";
  } catch {
    return "";
  }
}

export function generateForm(suggested: string, terminal?: string): FormSpec {
  return form({
    title: "New Ed25519 SSH Key",
    submitTitle: "Generate Key",
    fields: [
      field.text("name", "File name", { value: suggested, required: true, placeholder: "id_ed25519_work" }),
      field.text("comment", "Comment", {
        value: userName() ? `${userName()}@${hostName()}` : "",
        placeholder: "you@laptop, or the email of your Git account",
      }),
      field.password("passphrase", "Passphrase", { placeholder: "Recommended; empty for none" }),
      field.password("confirm", "Repeat passphrase"),
      field.checkbox("agent", "Add it to the SSH agent", { value: true }),
    ],
    async submit(values) {
      const name = String(values.name ?? "").trim();
      const passphrase = String(values.passphrase ?? "");
      if (passphrase !== String(values.confirm ?? "")) throw new Error("The two passphrases differ");
      if (passphrase && passphrase.length < 5) throw new Error("A passphrase needs at least 5 characters");
      const pub = await generate(name, String(values.comment ?? "").trim(), passphrase);
      const path = `${SSH_DIR}/${name}`;
      let agentNote = "";
      if (values.agent) {
        agentNote = await addToAgent(path).then((ok) =>
          ok ? "It is loaded in the SSH agent." : "Add it to the agent with Ctrl+A (asks for the passphrase)."
        ).catch((e) => `Not added to the agent: ${e.message}`);
      }
      await toast(`Created ~/.ssh/${name}`, { style: "success" });
      return replace(detail({
        title: `~/.ssh/${name}`,
        markdown: [
          `## Your new key`,
          "",
          "```",
          pub,
          "```",
          "",
          `The private key is \`${path.replace(HOME, "~")}\` and never leaves this computer. ${agentNote}`,
          "",
          "Copy the public key above to GitHub, GitLab or a server's `~/.ssh/authorized_keys`.",
        ].join("\n"),
        actions: [
          copy(pub, "Copy Public Key"),
          pasteOn("Add to GitHub", pub, PAGES.githubSsh, "GitHub", { shortcut: "<Ctrl>g" }),
          pasteOn("Add to GitLab", pub, PAGES.gitlabSsh, "GitLab"),
          agentAction(path, terminal),
        ],
      }));
    },
  });
}

function hostName(): string {
  try {
    return Deno.readTextFileSync("/etc/hostname").trim() || "linux";
  } catch {
    return "linux";
  }
}
