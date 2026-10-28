import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  classifyError,
  cleanError,
  configInventory,
  DEFAULT_FOLDERS,
  findArgs,
  installCommand,
  parseFolders,
  parseInventory,
  parseListTasks,
  parsePlaybook,
  playbookArgv,
  playHosts,
  playTags,
  projectsFromFind,
  relativeTime,
  relativeTo,
  sshTarget,
  tilde,
  varText,
} from "./lib.ts";
import { holdOpen, TERMINALS } from "./terminal.ts";

const SITE = `---
- name: Common setup
  hosts: all
  become: true
  gather_facts: false
  tags: [common]
  pre_tasks:
    - name: Update apt cache
      ansible.builtin.apt:
        update_cache: true
  roles:
    - common
    - role: users
      vars:
        admin: ada

- name: Web servers
  hosts:
    - webservers
    - canary
  serial: "25%"
  vars:
    db_password: !vault |
      $ANSIBLE_VAULT;1.1;AES256
      62313365396662343061393464336163383764373764613633653634306231386433626436623361
  tasks:
    - name: Install nginx
      ansible.builtin.package:
        name: nginx
      tags: nginx
    - block:
        - name: Template config
          ansible.builtin.template: { src: nginx.conf.j2, dest: /etc/nginx/nginx.conf }
        - name: Validate
          ansible.builtin.command: nginx -t
      rescue:
        - name: Roll back
          ansible.builtin.debug: { msg: "rollback" }
  handlers:
    - name: Reload nginx
      ansible.builtin.service: { name: nginx, state: reloaded }

- ansible.builtin.import_playbook: db.yml
`;

// `ansible-inventory -i inventories/production --list`
const INVENTORY = JSON.stringify({
  _meta: {
    hostvars: {
      "web1.example.com": { ansible_host: "10.0.0.11", ansible_user: "deploy", http_port: 80 },
      "web10.example.com": {
        ansible_host: "10.0.0.20",
        ansible_port: 2222,
        ansible_ssh_private_key_file: "~/.ssh/deploy",
      },
      "web2.example.com": {
        ansible_host: "10.0.0.12",
        db_password: { __ansible_vault: "$ANSIBLE_VAULT;1.1;AES256\n6231" },
      },
      "db1": {
        ansible_host: "10.0.1.5",
        ansible_become_password: "hunter2",
        ansible_ssh_common_args: "-o ProxyJump=bastion.example.com",
      },
      "localhost": { ansible_connection: "local" },
    },
  },
  all: { children: ["ungrouped", "production"] },
  production: { children: ["webservers", "dbservers"] },
  webservers: { hosts: ["web1.example.com", "web2.example.com", "web10.example.com"] },
  dbservers: { hosts: ["db1"] },
  ungrouped: { hosts: ["localhost"] },
});

// `ansible-playbook -i inventory site.yml --list-hosts --list-tasks`
const LIST_TASKS = `
playbook: site.yml

  play #1 (all): Common setup	TAGS: [common]
    pattern: ['all']
    hosts (2):
      web1
      db1
    tasks:
      Update apt cache	TAGS: [common]
      common : Install base packages	TAGS: [common, packages]
      users : Create users	TAGS: [common]

  play #2 (webservers,canary): Web servers	TAGS: []
    pattern: ['webservers', 'canary']
    hosts (1):
      web1
    tasks:
      Install nginx	TAGS: [nginx]
`;

Deno.test("programs and terminals match the manifest; default folders are readable", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { run: string[]; read: string[] };
    preferences: { name: string; default?: unknown }[];
  };
  assertEquals(manifest.permissions.run, ["ansible-inventory", "ansible-playbook", "find", ...TERMINALS]);
  assertEquals(manifest.preferences.find((p) => p.name === "folders")?.default, DEFAULT_FOLDERS);
  for (const f of DEFAULT_FOLDERS.split(", ")) assert(manifest.permissions.read.includes(f), `${f} readable`);
});

Deno.test("folders preference", () => {
  assertEquals(parseFolders("~/infra, ~/infra/, /srv/ansible:~", "/home/ada"), [
    "/home/ada/infra",
    "/srv/ansible",
    "/home/ada",
  ]);
  assertEquals(parseFolders("", "/home/ada")[0], "/home/ada/Projects");
  assertEquals(tilde("/home/ada/infra/site", "/home/ada"), "~/infra/site");
});

Deno.test("find arguments", () => {
  const args = findArgs(["/home/ada/infra"], 3);
  assertEquals(args.slice(0, 5), ["/home/ada/infra", "-mindepth", "1", "-maxdepth", "4"]);
  assertEquals(findArgs(["/x"], 50)[4], "9");
  assert(args.includes("ansible.cfg"));
});

Deno.test("projects from find output", () => {
  const out = [
    "C\t/home/ada/infra/site",
    "R\t/home/ada/infra/site",
    "D\t/home/ada/infra/site\tinventories",
    "V\t/home/ada/infra/site/inventories/production\thosts.yml",
    "V\t/home/ada/infra/site/inventories/staging\thosts.ini",
    "G\t/home/ada/infra/site/inventories/staging",
    "G\t/home/ada/infra/site/inventories/dynamic",
    "Y\t1761600000.5\t/home/ada/infra/site\tsite.yml",
    "Y\t1761650000\t/home/ada/infra/site/playbooks\tdeploy.yml",
    "Y\t1761000000\t/home/ada/infra/site\trequirements.yml",
    "Y\t1761000000\t/home/ada/infra/site/inventories/production/group_vars\tall.yml",
    // A small project: an inventory file and a playbook.
    "V\t/home/ada/code/lab\tinventory.ini",
    "Y\t1761700000\t/home/ada/code/lab\tplaybook.yml",
    // An inventory/ folder.
    "D\t/home/ada/code/pi\tinventory",
    "V\t/home/ada/code/pi/inventory\thosts",
    "Y\t1761500000\t/home/ada/code/pi\tmain.yml",
    // Not Ansible: a Kubernetes folder and a stray hosts file.
    "Y\t1761800000\t/home/ada/code/k8s\tdeployment.yaml",
    "V\t/home/ada/code/notes\thosts",
    "find: ‘/home/ada/repos’: No such file or directory",
  ].join("\n");
  const projects = projectsFromFind(out);
  assertEquals(projects.map((p) => p.path), ["/home/ada/code/lab", "/home/ada/infra/site", "/home/ada/code/pi"]);
  const site = projects[1];
  assertEquals(site.hasConfig, true);
  assertEquals(site.hasRoles, true);
  assertEquals(site.playbooks, ["/home/ada/infra/site/playbooks/deploy.yml", "/home/ada/infra/site/site.yml"]);
  assertEquals(site.inventories.map((i) => [i.name, i.path]), [
    ["dynamic", "/home/ada/infra/site/inventories/dynamic"],
    ["production", "/home/ada/infra/site/inventories/production"],
    ["staging", "/home/ada/infra/site/inventories/staging"],
  ]);
  assertEquals(site.modified, 1761650000);
  assertEquals(projects[0].inventories, [{ name: "inventory.ini", path: "/home/ada/code/lab/inventory.ini" }]);
  assertEquals(projects[2].inventories, [{ name: "inventory", path: "/home/ada/code/pi/inventory" }]);
});

Deno.test("find and projectsFromFind on a real tree", async () => {
  const root = await Deno.makeTempDir();
  try {
    const write = async (path: string, text = "") => {
      await Deno.mkdir(`${root}/${path}`.replace(/\/[^/]+$/, ""), { recursive: true });
      await Deno.writeTextFile(`${root}/${path}`, text);
    };
    await write("infra/ansible.cfg", "[defaults]\ninventory = ./inventories/prod\n");
    await write("infra/site.yml", SITE);
    await write("infra/inventories/prod/hosts.yml", "all:\n  hosts:\n    web1:\n");
    await write("infra/roles/common/tasks/main.yml", "- debug: {}\n");
    await write("infra/.github/workflows/ci.yml", "on: push\n");
    await write("infra/node_modules/x/hosts", "");
    const out = await new Deno.Command("find", { args: findArgs([root], 4), stdout: "piped", stderr: "null" })
      .output();
    const projects = projectsFromFind(new TextDecoder().decode(out.stdout));
    assertEquals(projects.length, 1);
    assertEquals(projects[0].path, `${root}/infra`);
    assertEquals(projects[0].playbooks, [`${root}/infra/site.yml`]);
    assertEquals(projects[0].inventories, [{ name: "prod", path: `${root}/infra/inventories/prod` }]);
    assertEquals(projects[0].hasRoles, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ansible.cfg inventory", () => {
  const cfg = `# comment
[privilege_escalation]
inventory = nope

[defaults]
host_key_checking = False
inventory = ./inventories/production, ./inventories/extra ; comment
`;
  assertEquals(configInventory(cfg, "/p", "/home/ada"), "/p/inventories/production");
  assertEquals(configInventory("[defaults]\ninventory=~/hosts\n", "/p", "/home/ada"), "/home/ada/hosts");
  assertEquals(configInventory("[defaults]\nhostfile = /etc/ansible/hosts\n", "/p", "/h"), "/etc/ansible/hosts");
  assertEquals(configInventory("[defaults]\nforks = 10\n", "/p", "/h"), undefined);
});

Deno.test("playbook plays", () => {
  const plays = parsePlaybook(SITE)!;
  assertEquals(plays.length, 3);
  assertEquals(plays[0].name, "Common setup");
  assertEquals(plays[0].roles, ["common", "users"]);
  assertEquals(plays[0].tasks, 1);
  assertEquals(plays[0].become, true);
  assertEquals(plays[0].gatherFacts, false);
  assertEquals(plays[1].hosts, "webservers,canary");
  assertEquals(plays[1].tasks, 4);
  assertEquals(plays[1].handlers, 1);
  assertEquals(plays[1].serial, "25%");
  assertEquals(plays[2].imports, "db.yml");
  assertEquals(playTags(plays), ["common"]);
  assertEquals(playHosts(plays), "all, webservers,canary");
});

Deno.test("YAML files that are not playbooks", () => {
  assertEquals(parsePlaybook("apiVersion: apps/v1\nkind: Deployment\n"), undefined);
  assertEquals(parsePlaybook("- name: a task\n  debug: {}\n"), undefined);
  assertEquals(parsePlaybook("key: [unclosed"), undefined);
  assertEquals(parsePlaybook(""), undefined);
});

Deno.test("ansible-playbook --list-hosts --list-tasks", () => {
  const plays = parseListTasks(LIST_TASKS);
  assertEquals(plays.length, 2);
  assertEquals(plays[0].pattern, "all");
  assertEquals(plays[0].name, "Common setup");
  assertEquals(plays[0].tags, ["common"]);
  assertEquals(plays[0].hosts, ["web1", "db1"]);
  assertEquals(plays[0].tasks[1], { role: "common", name: "Install base packages", tags: ["common", "packages"] });
  assertEquals(plays[0].tasks[0].role, "");
  assertEquals(plays[1].pattern, "webservers,canary");
  assertEquals(plays[1].tasks, [{ role: "", name: "Install nginx", tags: ["nginx"] }]);
});

Deno.test("inventory: groups, children and hosts", () => {
  const inv = parseInventory(INVENTORY);
  assertEquals(inv.groups.map((g) => g.name), ["all", "dbservers", "production", "ungrouped", "webservers"]);
  const production = inv.groups.find((g) => g.name === "production")!;
  assertEquals(production.allHosts, ["db1", "web1.example.com", "web2.example.com", "web10.example.com"]);
  assertEquals(production.hosts, []);
  assertEquals(inv.hosts.map((h) => h.name), [
    "db1",
    "localhost",
    "web1.example.com",
    "web2.example.com",
    "web10.example.com",
  ]);
  assertEquals(inv.hosts.find((h) => h.name === "web1.example.com")!.groups, ["webservers"]);
  assertEquals(inv.hosts.find((h) => h.name === "localhost")!.groups, []);
  // An empty inventory has only "all".
  assertEquals(parseInventory('{"_meta":{"hostvars":{}},"all":{"children":["ungrouped"]}}'), { groups: [], hosts: [] });
});

Deno.test("SSH targets", () => {
  const inv = parseInventory(INVENTORY);
  const host = (n: string) => inv.hosts.find((h) => h.name === n)!;
  assertEquals(sshTarget(host("web1.example.com"))!.argv, ["ssh", "deploy@10.0.0.11"]);
  assertEquals(sshTarget(host("web10.example.com"))!.argv, ["ssh", "-p", "2222", "-i", "~/.ssh/deploy", "10.0.0.20"]);
  assertEquals(sshTarget(host("db1"))!.argv, ["ssh", "-J", "bastion.example.com", "10.0.1.5"]);
  assertEquals(sshTarget(host("localhost")), undefined);
  assertEquals(sshTarget({ name: "plain", groups: [], vars: {} })!.argv, ["ssh", "plain"]);
});

Deno.test("variables shown in the detail panel", () => {
  assertEquals(varText("db_password", { __ansible_vault: "$ANSIBLE_VAULT;1.1" }), "(vault encrypted)");
  assertEquals(varText("ansible_become_password", "hunter2"), "••••••••");
  assertEquals(varText("api_key", "abc"), "••••••••");
  assertEquals(varText("ansible_ssh_private_key_file", "~/.ssh/id"), "~/.ssh/id");
  assertEquals(varText("http_port", 80), "80");
  assertEquals(varText("list", ["a", "b"]), '["a","b"]');
});

Deno.test("playbook command lines", () => {
  assertEquals(playbookArgv("site.yml", "inventories/prod"), [
    "ansible-playbook",
    "-i",
    "inventories/prod",
    "site.yml",
  ]);
  assertEquals(playbookArgv("site.yml", "", { check: true, limit: "web1", askBecome: true }), [
    "ansible-playbook",
    "site.yml",
    "--check",
    "--diff",
    "--limit",
    "web1",
    "--ask-become-pass",
  ]);
  assertEquals(playbookArgv("site.yml", "", { syntax: true, askBecome: true }), [
    "ansible-playbook",
    "site.yml",
    "--syntax-check",
  ]);
  assertEquals(playbookArgv("a.yml", "", { tags: "nginx", askVault: true }), [
    "ansible-playbook",
    "a.yml",
    "--tags",
    "nginx",
    "--ask-vault-pass",
  ]);
  assertEquals(relativeTo("/p/playbooks/a.yml", "/p"), "playbooks/a.yml");
  assertEquals(relativeTo("/etc/ansible/hosts", "/p"), "/etc/ansible/hosts");
  assertEquals(
    holdOpen(["ansible-playbook", "site.yml"], "/home/ada/my infra")[2].startsWith("cd '/home/ada/my infra' && "),
    true,
  );
});

Deno.test("errors", () => {
  const vault = `[WARNING]:  * Failed to parse /p/inventories/prod/hosts.yml with yaml plugin
ERROR! Attempting to decrypt but no vault secrets found`;
  assertEquals(classifyError(vault), "vault");
  assertEquals(cleanError(vault), "Attempting to decrypt but no vault secrets found");
  assertEquals(classifyError("ERROR! the playbook: x.yml could not be found"), "other");
  assertEquals(classifyError("Unable to parse /p/hosts as an inventory source"), "parse");
  assertEquals(cleanError("\x1b[0;31mERROR! boom\x1b[0m"), "boom");
});

Deno.test("install hint and dates", () => {
  assertEquals(installCommand("ID=fedora\nVERSION_ID=41\n"), "sudo dnf install ansible");
  assertEquals(installCommand('ID=pop\nID_LIKE="ubuntu debian"\n'), "sudo apt install ansible");
  assertEquals(installCommand("ID=nixos\n"), "pipx install --include-deps ansible");
  const now = Date.parse("2026-10-28T12:00:00Z");
  assertEquals(relativeTime(now / 1000 - 3 * 86400, now), "3 days ago");
  assertEquals(relativeTime(now / 1000 - 30, now), "just now");
});
