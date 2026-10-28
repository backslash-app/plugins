import { assertEquals } from "@std/assert";
import {
  activeProfile,
  age,
  bytes,
  classifyError,
  filterInstances,
  installCommand,
  logGroupConsoleUrl,
  logSource,
  maskKey,
  osFamily,
  parseBuckets,
  parseIni,
  parseInstances,
  parseLogGroups,
  parseObjects,
  parseProfiles,
  regionsFor,
  relativeKey,
  s3ConsoleUrl,
  sortInstances,
} from "./lib.ts";
import { holdOpen, terminalArgs } from "./terminal.ts";

const CONFIG = `
[default]
region = eu-west-3
output = json

[profile prod]
sso_session = acme
sso_account_id = 123456789012
sso_role_name = AdministratorAccess

[sso-session acme]
sso_start_url = https://acme.awsapps.com/start
sso_region = eu-west-1

[profile ci]
role_arn = arn:aws:iam::210987654321:role/ci-deploy
source_profile = default
s3 =
  max_concurrent_requests = 20

[services local]
s3 =
  endpoint_url = http://localhost:4566
`;

const CREDENTIALS = `
[default]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

[temp]
aws_access_key_id = ASIAXXXXXXXXXXXX1234
aws_secret_access_key = x
aws_session_token = y
`;

Deno.test("ini: nested values and sections", () => {
  const ini = parseIni(CONFIG);
  assertEquals(ini.get("profile ci")?.s3, "max_concurrent_requests = 20");
  assertEquals(ini.get("sso-session acme")?.sso_region, "eu-west-1");
});

Deno.test("profiles from config and credentials", () => {
  const profiles = parseProfiles(CONFIG, CREDENTIALS);
  assertEquals(profiles.map((p) => [p.name, p.kind]), [
    ["default", "keys"],
    ["ci", "role"],
    ["prod", "sso"],
    ["temp", "keys"],
  ]);
  const prod = profiles.find((p) => p.name === "prod")!;
  assertEquals(prod.ssoStartUrl, "https://acme.awsapps.com/start");
  // Falls back to the SSO region when the profile has none.
  assertEquals(prod.region, "eu-west-1");
  assertEquals(profiles[0].files, ["config", "credentials"]);
  assertEquals(profiles[0].accessKeyId, "AKIAIOSFODNN7EXAMPLE");
  assertEquals(profiles.find((p) => p.name === "temp")!.temporary, true);
  // The secret never makes it into a profile.
  assertEquals(JSON.stringify(profiles).includes("wJalrXUtnFEMI"), false);
  assertEquals(maskKey("AKIAIOSFODNN7EXAMPLE"), "AKIA…MPLE");
});

Deno.test("active profile: picked, then $AWS_PROFILE, then default", () => {
  const profiles = parseProfiles(CONFIG, CREDENTIALS);
  assertEquals(activeProfile(profiles, "prod", "ci"), "prod");
  assertEquals(activeProfile(profiles, "gone", "ci"), "ci");
  assertEquals(activeProfile(profiles, undefined, undefined), "default");
  assertEquals(activeProfile(parseProfiles("[profile a]\nregion=x\n", ""), undefined, undefined), "a");
  assertEquals(activeProfile([], undefined, undefined), undefined);
});

Deno.test("regions preference", () => {
  assertEquals(regionsFor("eu-west-3, us-east-1 eu-west-3", "x"), ["eu-west-3", "us-east-1"]);
  assertEquals(regionsFor("", "ap-south-1"), ["ap-south-1"]);
  assertEquals(regionsFor("nonsense", undefined, "us-gov-west-1"), ["us-gov-west-1"]);
  assertEquals(regionsFor(undefined), ["us-east-1"]);
});

const INSTANCES = JSON.stringify({
  Reservations: [{
    Instances: [
      {
        InstanceId: "i-0a1b2c3d4e5f60718",
        InstanceType: "t3.medium",
        LaunchTime: "2026-10-20T08:12:00+00:00",
        Placement: { AvailabilityZone: "eu-west-3a" },
        PrivateIpAddress: "10.0.1.12",
        PublicIpAddress: "15.236.10.4",
        PublicDnsName: "",
        State: { Code: 16, Name: "running" },
        PlatformDetails: "Linux/UNIX",
        SecurityGroups: [{ GroupName: "web", GroupId: "sg-1" }],
        Tags: [{ Key: "Name", Value: "web-1" }, { Key: "env", Value: "prod" }],
        IamInstanceProfile: { Arn: "arn:aws:iam::123456789012:instance-profile/web-role" },
      },
      { InstanceId: "i-2", InstanceType: "m6i.large", State: { Name: "stopped" }, Platform: "windows" },
      { InstanceId: "i-3", InstanceType: "t4g.nano", State: { Name: "pending" }, Tags: [{ Key: "Name", Value: "a" }] },
    ],
  }],
});

Deno.test("EC2 instances", () => {
  const all = parseInstances(INSTANCES, "eu-west-3");
  assertEquals(all[0].name, "web-1");
  assertEquals(all[0].publicDns, undefined);
  assertEquals(all[0].iamProfile, "web-role");
  assertEquals(all[0].tags.env, "prod");
  assertEquals(all[1].platform, "Windows");
  assertEquals(sortInstances(all).map((i) => i.id), ["i-0a1b2c3d4e5f60718", "i-3", "i-2"]);
  assertEquals(filterInstances(all, "running").map((i) => i.id), ["i-0a1b2c3d4e5f60718", "i-3"]);
  assertEquals(filterInstances(all, "stopped").map((i) => i.id), ["i-2"]);
  assertEquals(parseInstances("", "x"), []);
});

Deno.test("S3 buckets and objects", () => {
  const buckets = parseBuckets(JSON.stringify({
    Buckets: [
      { Name: "zeta", CreationDate: "2024-03-01T10:00:00+00:00" },
      { Name: "acme", CreationDate: "2023-01-15T10:00:00+00:00", BucketRegion: "eu-west-3" },
    ],
  }));
  assertEquals(buckets.map((b) => [b.name, b.region]), [["acme", "eu-west-3"], ["zeta", undefined]]);
  const objects = parseObjects(JSON.stringify({
    CommonPrefixes: [{ Prefix: "site/img/" }],
    Contents: [{ Key: "site/", Size: 0 }, { Key: "site/index.html", Size: 5120, StorageClass: "STANDARD" }],
  }));
  assertEquals(objects.map((o) => [o.key, o.folder]), [["site/img/", true], ["site/index.html", false]]);
  assertEquals(relativeKey("site/img/", "site/"), "img/");
  assertEquals(
    s3ConsoleUrl("acme", "site/", "eu-west-3"),
    "https://s3.console.aws.amazon.com/s3/buckets/acme?region=eu-west-3&prefix=site%2F&showversions=false",
  );
});

Deno.test("CloudWatch log groups", () => {
  const groups = parseLogGroups(
    JSON.stringify({
      logGroups: [{
        logGroupName: "/aws/lambda/checkout",
        creationTime: 1700000000000,
        retentionInDays: 14,
        storedBytes: 52428800,
        arn: "arn:aws:logs:eu-west-3:123:log-group:/aws/lambda/checkout:*",
      }, { logGroupName: "app/api" }],
    }),
    "eu-west-3",
  );
  assertEquals(groups[0].arn, "arn:aws:logs:eu-west-3:123:log-group:/aws/lambda/checkout");
  assertEquals(groups[1].storedBytes, 0);
  assertEquals(logSource(groups[0].name), "Lambda");
  assertEquals(logSource("app/api"), "Custom");
  assertEquals(
    logGroupConsoleUrl(groups[0]),
    "https://eu-west-3.console.aws.amazon.com/cloudwatch/home?region=eu-west-3#logsV2:log-groups/log-group/$252Faws$252Flambda$252Fcheckout",
  );
});

Deno.test("errors are classified with a way out", () => {
  const c = (m: string) => classifyError(new Error(`aws exited with 255: ${m}`)).problem;
  assertEquals(c("Error when retrieving token from sso: Token has expired and refresh failed"), "expired");
  assertEquals(
    c('Unable to locate credentials. You can configure credentials by running "aws configure".'),
    "credentials",
  );
  assertEquals(c("The config profile (nope) could not be found"), "profile");
  assertEquals(c("An error occurred (UnauthorizedOperation) when calling the DescribeInstances operation"), "denied");
  assertEquals(c('Could not connect to the endpoint URL: "https://ec2.eu-west-3.amazonaws.com/"'), "network");
  assertEquals(c("SessionManagerPlugin is not found. Please refer to SessionManager Documentation"), "plugin");
  assertEquals(classifyError(new Error("aws exited with 1: boom")).message, "boom");
});

Deno.test("formatting", () => {
  assertEquals(bytes(512), "512 B");
  assertEquals(bytes(52428800), "50.0 MB");
  assertEquals(bytes(1536 * 1024 * 1024 * 1024), "1.5 TB");
  const now = new Date("2026-10-28T12:00:00Z");
  assertEquals(age(new Date("2026-10-20T08:12:00Z"), now), "8d");
  assertEquals(age(new Date("2026-10-28T11:30:00Z"), now), "30m");
  assertEquals(age(undefined, now), "");
});

Deno.test("install hints and terminals", () => {
  assertEquals(installCommand(osFamily("ID=arch\n")), "sudo pacman -S aws-cli-v2");
  assertEquals(installCommand(osFamily('ID=ubuntu\nID_LIKE="debian"\n')), "sudo snap install aws-cli --classic");
  assertEquals(terminalArgs("konsole", ["aws", "sso", "login"]), ["-e", "aws", "sso", "login"]);
  assertEquals(holdOpen(["aws", "sso", "login"])[0], "sh");
});
