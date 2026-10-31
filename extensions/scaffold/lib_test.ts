import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  answers,
  checkFolderName,
  cloneArgv,
  cookiecutterArgv,
  cookiecutterQuestions,
  copierArgv,
  copierQuestions,
  explainFailure,
  gitOrigin,
  gitScript,
  humanize,
  newEntry,
  parseTemplate,
  parseTemplateList,
  questionFields,
  rawUrls,
  terminalScript,
  toolSource,
} from "./lib.ts";

const HOME = "/home/ada";

Deno.test("parseTemplate: abbreviations, URLs, degit shorthand, local folders", () => {
  const gh = parseTemplate("gh:audreyfeldroy/cookiecutter-pypackage", HOME)!;
  assertEquals([gh.host, gh.owner, gh.repo, gh.name], [
    "github",
    "audreyfeldroy",
    "cookiecutter-pypackage",
    "cookiecutter-pypackage",
  ]);
  assertEquals(gh.cloneUrl, "https://github.com/audreyfeldroy/cookiecutter-pypackage.git");
  assertEquals(gh.webUrl, "https://github.com/audreyfeldroy/cookiecutter-pypackage");

  const degit = parseTemplate("degit:vitejs/vite/packages/create-vite/template-react-ts#v5.4.0", HOME)!;
  assertEquals(degit.kind, "git");
  assertEquals(degit.subdir, "packages/create-vite/template-react-ts");
  assertEquals(degit.ref, "v5.4.0");
  assertEquals(degit.name, "template-react-ts");
  assertEquals(degit.webUrl, "https://github.com/vitejs/vite/tree/v5.4.0/packages/create-vite/template-react-ts");

  const tree = parseTemplate("https://github.com/acme/templates/tree/main/python", HOME)!;
  assertEquals([tree.repo, tree.ref, tree.subdir], ["templates", "main", "python"]);

  const gl = parseTemplate("copier:https://gitlab.com/acme/platform/service-template.git", HOME)!;
  assertEquals([gl.kind, gl.host, gl.owner, gl.repo], ["copier", "gitlab", "acme/platform", "service-template"]);

  const ssh = parseTemplate("git@github.com:acme/private-template.git", HOME)!;
  assertEquals([ssh.host, ssh.repo, ssh.cloneUrl], [
    "github",
    "private-template",
    "git@github.com:acme/private-template.git",
  ]);

  const other = parseTemplate("https://git.acme.dev/infra/tpl.git", HOME)!;
  assertEquals([other.host, other.name], ["git", "tpl"]);

  const local = parseTemplate("~/templates/fastapi/", HOME)!;
  assertEquals([local.host, local.path, local.name], ["local", "/home/ada/templates/fastapi", "fastapi"]);

  assertEquals(parseTemplate("", HOME), undefined);
  assertEquals(parseTemplate("just words", HOME), undefined);
});

Deno.test("parseTemplateList splits on commas and lines", () => {
  const list = parseTemplateList("gh:a/b, copier:gh:c/d\n~/templates/x,, nonsense here", HOME);
  assertEquals(list.map((t) => t.name), ["b", "d", "x"]);
  assertEquals(list[1].kind, "copier");
});

Deno.test("toolSource and rawUrls", () => {
  const gh = parseTemplate("acme/tpl", HOME)!;
  assertEquals(toolSource(gh), "gh:acme/tpl");
  assertEquals(rawUrls(gh, "cookiecutter.json"), ["https://raw.githubusercontent.com/acme/tpl/HEAD/cookiecutter.json"]);
  const sub = parseTemplate("acme/tpl/python#dev", HOME)!;
  assertEquals(rawUrls(sub, "copier.yml"), ["https://raw.githubusercontent.com/acme/tpl/dev/python/copier.yml"]);
  const gl = parseTemplate("gl:acme/tpl", HOME)!;
  assertEquals(toolSource(gl), "gl:acme/tpl");
  assertEquals(rawUrls(gl, "copier.yml"), ["https://gitlab.com/acme/tpl/-/raw/HEAD/copier.yml"]);
  const cb = parseTemplate("https://codeberg.org/acme/tpl", HOME)!;
  assertEquals(toolSource(cb), "https://codeberg.org/acme/tpl.git");
  assertEquals(rawUrls(cb, "copier.yml"), [
    "https://codeberg.org/acme/tpl/raw/branch/main/copier.yml",
    "https://codeberg.org/acme/tpl/raw/branch/master/copier.yml",
  ]);
  assertEquals(rawUrls(parseTemplate("~/t", HOME)!, "copier.yml"), []);
});

Deno.test("gitOrigin reads a clone's remote", () => {
  const config = `[core]
	repositoryformatversion = 0
[remote "upstream"]
	url = https://github.com/other/fork.git
[remote "origin"]
	url = https://github.com/audreyfeldroy/cookiecutter-pypackage.git
	fetch = +refs/heads/*:refs/remotes/origin/*
[branch "master"]
	remote = origin
`;
  assertEquals(gitOrigin(config), "https://github.com/audreyfeldroy/cookiecutter-pypackage.git");
  assertEquals(gitOrigin("[core]\n"), undefined);
});

// cookiecutter-pypackage's cookiecutter.json, with cookiecutter 2.2 prompts.
const COOKIECUTTER = JSON.stringify({
  full_name: "Audrey Roy Greenfeld",
  email: "audreyr@example.com",
  project_name: "Python Boilerplate",
  project_slug: "{{ cookiecutter.project_name.lower().replace(' ', '_').replace('-', '_') }}",
  version: "0.1.0",
  use_pytest: "n",
  command_line_interface: ["Typer", "Argparse", "No command-line interface"],
  open_source_license: ["MIT license", "BSD license", "Not open source"],
  add_docs: true,
  _copy_without_render: ["*.html"],
  __year: "{% now 'utc', '%Y' %}",
  __prompts__: {
    full_name: "Your name",
    open_source_license: { __prompt__: "License?", "MIT license": "MIT", "BSD license": "BSD 3-Clause" },
  },
  settings: { nested: true },
});

Deno.test("cookiecutterQuestions", () => {
  const qs = cookiecutterQuestions(COOKIECUTTER);
  assertEquals(qs.map((q) => q.key), [
    "full_name",
    "email",
    "project_name",
    "project_slug",
    "version",
    "use_pytest",
    "command_line_interface",
    "open_source_license",
    "add_docs",
  ]);
  assertEquals(qs[0].title, "Your name");
  assertEquals(qs[3].default, "");
  assert(qs[3].computed?.includes("cookiecutter.project_name"));
  const license = qs[7];
  assertEquals(license.title, "License");
  assertEquals(license.type, "choice");
  assertEquals(license.default, "MIT license");
  assertEquals(license.choices![1], { value: "BSD license", title: "BSD 3-Clause" });
  assertEquals(qs[8].type, "bool");
  assertEquals(cookiecutterQuestions("{ broken"), []);
  assertEquals(cookiecutterQuestions("[]"), []);
});

// pawamoy/copier-uv-style copier.yml
const COPIER = `_min_copier_version: "9"
_subdirectory: project
_tasks:
  - "git init"
project_name:
  type: str
  help: Your project name
  placeholder: my-project
project_description:
  type: str
  help: |
    Your project description
    (one line)
  multiline: true
python_package_distribution_name:
  type: str
  help: Your Python package distribution name (for pip install NAME)
  default: "{{ project_name|lower|replace(' ', '-') }}"
copyright_license:
  type: str
  help: Your project's license
  default: ISC
  choices:
    Academic Free License v3.0: AFL-3.0
    ISC License: ISC
    MIT License: MIT
author_email:
  type: str
  default: dev@example.com
pypi_token:
  type: str
  secret: true
  default: ""
insiders:
  type: bool
  help: Does this project have an Insiders version?
  default: false
legacy_option:
  type: str
  when: false
python_version: "3.12"
features:
  type: str
  multiselect: true
  choices: [a, b]
---
extra_question:
  type: str
  choices:
    - [Small, s]
    - [Large, l]
`;

Deno.test("copierQuestions", () => {
  const info = copierQuestions(COPIER);
  assert(info.needsTrust);
  const byKey = Object.fromEntries(info.questions.map((q) => [q.key, q]));
  assertEquals(Object.keys(byKey), [
    "project_name",
    "project_description",
    "python_package_distribution_name",
    "copyright_license",
    "author_email",
    "pypi_token",
    "insiders",
    "python_version",
    "features",
    "extra_question",
  ]);
  assertEquals(byKey.project_name.title, "Your project name");
  assertEquals(byKey.project_description.type, "multiline");
  assertEquals(byKey.project_description.title, "Your project description");
  assertEquals(byKey.python_package_distribution_name.default, "");
  assertEquals(byKey.copyright_license.type, "choice");
  assertEquals(byKey.copyright_license.default, "ISC");
  assertEquals(byKey.copyright_license.choices![2], { title: "MIT License", value: "MIT" });
  assertEquals(byKey.pypi_token.type, "secret");
  assertEquals(byKey.insiders.type, "bool");
  assertEquals(byKey.python_version.default, "3.12");
  assertEquals(byKey.features.type, "text"); // multiselect: typed as text
  assertEquals(byKey.extra_question.choices, [{ title: "Small", value: "s" }, { title: "Large", value: "l" }]);
  assertEquals(copierQuestions("key: !include other.yml").unreadable, true);
  assertEquals(copierQuestions("_tasks: []\nname: x").needsTrust, false);
});

Deno.test("questionFields builds form fields with prefixed ids", () => {
  const fields = questionFields(cookiecutterQuestions(COOKIECUTTER));
  assertEquals(fields[0], {
    id: "v:full_name",
    title: "Your name",
    kind: "text",
    value: "Audrey Roy Greenfeld",
    placeholder: undefined,
  });
  assertEquals(fields[3].placeholder?.startsWith("Computed: {{ cookiecutter.project_name"), true);
  assertEquals(fields[7].kind, "dropdown");
  assertEquals(fields[8], { id: "v:add_docs", title: "Add docs", kind: "checkbox", value: true });
});

Deno.test("answers keeps what differs from the defaults", () => {
  const qs = cookiecutterQuestions(COOKIECUTTER);
  const values = {
    "v:full_name": "Ada Lovelace",
    "v:email": "audreyr@example.com",
    "v:project_slug": "",
    "v:open_source_license": "BSD license",
    "v:add_docs": false,
    name: "ignored",
  };
  assertEquals(answers(qs, values, "cookiecutter"), [
    ["full_name", "Ada Lovelace"],
    ["open_source_license", "BSD license"],
    ["add_docs", "no"],
  ]);
  const cq = copierQuestions(COPIER).questions;
  assertEquals(answers(cq, { "v:insiders": true, "v:project_name": "Shop" }, "copier"), [
    ["project_name", "Shop"],
    ["insiders", "true"],
  ]);
});

Deno.test("humanize and checkFolderName", () => {
  assertEquals(humanize("project_slug"), "Project slug");
  assertEquals(checkFolderName(" shop-api "), "shop-api");
  assertThrows(() => checkFolderName(""));
  assertThrows(() => checkFolderName("../etc"));
  assertThrows(() => checkFolderName(".."));
});

Deno.test("command lines", () => {
  const t = parseTemplate("gh:audreyfeldroy/cookiecutter-pypackage", HOME)!;
  assertEquals(
    cookiecutterArgv(t, "/home/ada/Projects", [["full_name", "Ada"]], {
      tool: ["uvx", "cookiecutter"],
      interactive: false,
    }),
    [
      "uvx",
      "cookiecutter",
      "--no-input",
      "--output-dir",
      "/home/ada/Projects",
      "gh:audreyfeldroy/cookiecutter-pypackage",
      "full_name=Ada",
    ],
  );
  const sub = parseTemplate("acme/tpl/python#v2", HOME)!;
  assertEquals(cookiecutterArgv(sub, ".", [], { tool: ["cookiecutter"], interactive: true }), [
    "cookiecutter",
    "--output-dir",
    ".",
    "--checkout",
    "v2",
    "--directory",
    "python",
    "gh:acme/tpl",
  ]);
  const c = parseTemplate("gh:pawamoy/copier-uv", HOME)!;
  assertEquals(
    copierArgv(c, "/home/ada/Projects/shop", [["project_name", "Shop"]], {
      tool: ["copier"],
      interactive: false,
      trust: true,
    }),
    [
      "copier",
      "copy",
      "--defaults",
      "--trust",
      "--data",
      "project_name=Shop",
      "gh:pawamoy/copier-uv",
      "/home/ada/Projects/shop",
    ],
  );
  assertEquals(cloneArgv(sub, "x"), [
    "git",
    "clone",
    "--depth",
    "1",
    "--filter=blob:none",
    "--sparse",
    "--branch",
    "v2",
    "https://github.com/acme/tpl.git",
    "x",
  ]);
});

Deno.test("gitScript and terminalScript make valid shell", async () => {
  const plain = gitScript(parseTemplate("acme/tpl", HOME)!, "my app");
  assertEquals(plain, ["git clone --depth 1 https://github.com/acme/tpl.git 'my app'", "rm -rf 'my app/.git'"]);
  const sparse = gitScript(parseTemplate("acme/tpl/web app", HOME) ?? parseTemplate("acme/tpl/web", HOME)!, "site");
  assert(sparse.some((l) => l.includes("sparse-checkout set web")));
  const script = terminalScript("New project", "/home/ada/Projects", sparse);
  const check = await new Deno.Command("bash", { args: ["-n", "-c", script], stderr: "piped" }).output();
  assertEquals(check.code, 0, new TextDecoder().decode(check.stderr));
});

Deno.test("newEntry and explainFailure", () => {
  assertEquals(newEntry(["a", "b"], ["a", "b", "shop", ".cache"]), "shop");
  assertEquals(newEntry(["a"], ["a", "x", "y"]), undefined);
  assert(explainFailure("copier", "Template uses potentially unsafe feature: tasks. Use --trust").includes("Trust"));
  assertEquals(
    explainFailure("cookiecutter", 'Error: "/home/ada/Projects/shop" directory already exists'),
    "A folder with that name already exists",
  );
  assertEquals(
    explainFailure("git", "fatal: repository 'https://github.com/x/y.git/' not found"),
    "The template's repository wasn't found",
  );
  assertEquals(explainFailure("git", "\x1b[31mboom\x1b[0m\n"), "boom");
});

Deno.test("the manifest writes where projects may be created", async () => {
  const { FOLDERS } = await import("./scaffold.ts");
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { read: string[]; write: string[] };
  };
  assertEquals(manifest.permissions.write, FOLDERS.map((f) => `~/${f}`));
  for (const f of manifest.permissions.write) assert(manifest.permissions.read.includes(f));
});
