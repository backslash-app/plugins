import { assertEquals } from "@std/assert";
import {
  attributes,
  classifyError,
  cleanError,
  findArgs,
  groupByType,
  installCommands,
  osFamily,
  outputText,
  parseAddress,
  parseFolders,
  parseOutputs,
  parseShow,
  parseStateList,
  parseWorkspaces,
  projectsFromFind,
  relativeTime,
  resourceId,
  tilde,
} from "./lib.ts";
import { holdOpen, terminalArgs } from "./terminal.ts";

Deno.test("folders preference", () => {
  assertEquals(parseFolders("~/infra, ~/infra/, /srv/tf:~", "/home/ada"), ["/home/ada/infra", "/srv/tf", "/home/ada"]);
  assertEquals(parseFolders("", "/home/ada")[0], "/home/ada/Projects");
  assertEquals(tilde("/home/ada/infra/prod", "/home/ada"), "~/infra/prod");
  assertEquals(tilde("/srv/x", "/home/ada"), "/srv/x");
});

Deno.test("find arguments", () => {
  const args = findArgs(["/home/ada/infra"], 3);
  assertEquals(args.slice(0, 5), ["/home/ada/infra", "-mindepth", "1", "-maxdepth", "4"]);
  assertEquals(findArgs(["/x"], 50)[4], "9");
  assertEquals(findArgs(["/x"], 0)[4], "5");
  assertEquals(args.includes(".terraform"), true);
});

Deno.test("projects from find", () => {
  const out = [
    "F\t1761600000.123\tmain.tf\t/home/ada/infra/prod",
    "F\t1761650000.5\tvariables.tf\t/home/ada/infra/prod",
    "I\t/home/ada/infra/prod",
    "F\t1761650000.5\tterraform.tfstate\t/home/ada/infra/prod",
    "F\t1761000000\tmain.tf\t/home/ada/infra/modules/vpc",
    "F\t1761700000\tmain.tofu\t/home/ada/code/my app",
    "F\t1761800000\tterraform.tfstate\t/home/ada/stray",
    "find: ‘/home/ada/repos’: No such file or directory",
  ].join("\n");
  const projects = projectsFromFind(out);
  assertEquals(projects.map((p) => p.path), [
    "/home/ada/code/my app",
    "/home/ada/infra/prod",
    "/home/ada/infra/modules/vpc",
  ]);
  const prod = projects[1];
  assertEquals(prod.name, "prod");
  assertEquals(prod.files, ["main.tf", "variables.tf"]);
  assertEquals(prod.modified, 1761650000);
  assertEquals(prod.initialized, true);
  assertEquals(prod.localState, true);
  assertEquals(prod.module, false);
  assertEquals(projects[2].module, true);
  assertEquals(projects[0].initialized, false);
});

Deno.test("workspaces", () => {
  assertEquals(parseWorkspaces("  default\n* staging\n  prod\n\n"), {
    current: "staging",
    names: ["default", "staging", "prod"],
  });
  assertEquals(parseWorkspaces(""), { current: "default", names: ["default"] });
});

Deno.test("addresses", () => {
  assertEquals(parseAddress("aws_instance.web[0]"), {
    address: "aws_instance.web[0]",
    module: "",
    mode: "managed",
    type: "aws_instance",
    name: "web",
    index: "0",
  });
  assertEquals(parseAddress('module.net.module.subnets["a"].aws_subnet.private["eu-west-1a"]'), {
    address: 'module.net.module.subnets["a"].aws_subnet.private["eu-west-1a"]',
    module: 'module.net.module.subnets["a"]',
    mode: "managed",
    type: "aws_subnet",
    name: "private",
    index: '"eu-west-1a"',
  });
  const data = parseAddress("module.vpc.data.aws_availability_zones.available");
  assertEquals([data.mode, data.module, data.type, data.name, data.index], [
    "data",
    "module.vpc",
    "aws_availability_zones",
    "available",
    undefined,
  ]);
  assertEquals(parseStateList("aws_s3_bucket.logs\ndata.aws_caller_identity.me\n\n"), [
    "aws_s3_bucket.logs",
    "data.aws_caller_identity.me",
  ]);
});

Deno.test("grouped by type, data sources last", () => {
  const groups = groupByType(
    ["data.aws_ami.ubuntu", "aws_instance.web[10]", "aws_instance.web[2]", "aws_eip.web"].map(parseAddress),
  );
  assertEquals(groups.map(([t, rs]) => [t, rs.map((r) => r.address)]), [
    ["aws_eip", ["aws_eip.web"]],
    ["aws_instance", ["aws_instance.web[2]", "aws_instance.web[10]"]],
    ["data.aws_ami", ["data.aws_ami.ubuntu"]],
  ]);
});

const SHOW = JSON.stringify({
  format_version: "1.0",
  terraform_version: "1.9.5",
  values: {
    outputs: {
      bucket: { sensitive: false, value: "acme-logs", type: "string" },
      db_password: { sensitive: true, value: "hunter2", type: "string" },
      subnets: { sensitive: false, value: ["subnet-1", "subnet-2"], type: ["tuple", ["string", "string"]] },
    },
    root_module: {
      resources: [
        {
          address: "aws_s3_bucket.logs",
          mode: "managed",
          type: "aws_s3_bucket",
          name: "logs",
          provider_name: "registry.terraform.io/hashicorp/aws",
          values: {
            bucket: "acme-logs",
            arn: "arn:aws:s3:::acme-logs",
            id: "acme-logs",
            tags: { team: "infra" },
            grants: [],
            policy: null,
            website: {},
          },
          sensitive_values: { tags: {} },
          depends_on: ["random_id.suffix"],
        },
      ],
      child_modules: [
        {
          address: "module.db",
          resources: [
            {
              address: "module.db.aws_db_instance.main",
              mode: "managed",
              type: "aws_db_instance",
              name: "main",
              provider_name: "registry.opentofu.org/hashicorp/aws",
              values: { identifier: "main", password: "hunter2", endpoint: "main.x.rds.amazonaws.com:5432" },
              sensitive_values: { password: true },
            },
          ],
        },
      ],
    },
  },
});

Deno.test("show -json", () => {
  const state = parseShow(SHOW);
  assertEquals(state.version, "1.9.5");
  assertEquals(state.resources.map((r) => [r.address, r.module, r.provider]), [
    ["aws_s3_bucket.logs", "", "aws"],
    ["module.db.aws_db_instance.main", "module.db", "aws"],
  ]);
  const [bucket, db] = state.resources;
  assertEquals(resourceId(bucket), "acme-logs");
  assertEquals(bucket.dependsOn, ["random_id.suffix"]);
  assertEquals(attributes(bucket).map((a) => a.key), ["id", "arn", "bucket", "tags"]);
  assertEquals(attributes(bucket)[3].value, '{"team":"infra"}');
  assertEquals(attributes(db).find((a) => a.key === "password"), {
    key: "password",
    value: "(sensitive)",
    sensitive: true,
  });
  assertEquals(attributes(db)[0].key, "endpoint");
  assertEquals(state.outputs.map((o) => o.name), ["bucket", "db_password", "subnets"]);
  assertEquals(parseShow("{}").resources, []);
});

Deno.test("outputs", () => {
  const outputs = parseOutputs(
    '{"url":{"sensitive":false,"type":"string","value":"https://x"},"ids":{"sensitive":false,"type":["list","number"],"value":[1,2]}}',
  );
  assertEquals(outputs.map((o) => [o.name, o.type]), [["ids", "list"], ["url", "string"]]);
  assertEquals(outputText(outputs[1]), "https://x");
  assertEquals(outputText(outputs[0]), "[\n  1,\n  2\n]");
  assertEquals(parseOutputs("{}"), []);
});

Deno.test("errors", () => {
  const raw =
    'terraform exited with 1: \x1b[31m╷\x1b[0m\n│ Error: Backend initialization required, please run "terraform init"\n│ \n╵';
  assertEquals(cleanError(raw), 'Error: Backend initialization required, please run "terraform init"');
  assertEquals(classifyError(cleanError(raw)).problem, "init");
  assertEquals(classifyError("Error acquiring the state lock").problem, "locked");
  assertEquals(classifyError("NoCredentialProviders: no valid providers").problem, "auth");
  assertEquals(classifyError("boom").problem, "other");
});

Deno.test("install hints and time", () => {
  assertEquals(osFamily('NAME="Fedora Linux"\nID=fedora\n'), "fedora");
  assertEquals(osFamily("ID=ubuntu\nID_LIKE=debian\n"), "debian");
  assertEquals(installCommands("arch").tofu, "sudo pacman -S opentofu");
  assertEquals(installCommands(undefined).terraform, "sudo snap install terraform --classic");
  const now = Date.parse("2026-10-28T12:00:00Z");
  assertEquals(relativeTime(now / 1000 - 30, now), "just now");
  assertEquals(relativeTime(now / 1000 - 7200, now), "2 h ago");
  assertEquals(relativeTime(now / 1000 - 86400 * 3, now), "3 days ago");
});

Deno.test("terminal command lines", () => {
  const argv = ["tofu", "-chdir=/home/ada/my infra", "plan"];
  assertEquals(terminalArgs("kitty", argv), argv);
  assertEquals(terminalArgs("gnome-terminal", argv), ["--", ...argv]);
  assertEquals(holdOpen(argv)[2].startsWith("tofu '-chdir=/home/ada/my infra' plan;"), true);
});
