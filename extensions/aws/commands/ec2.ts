import { type Action, action, copy, Icons, type Item, list, meta, open, refresh, toast } from "@backslash/api";
import {
  age,
  capitalize,
  ec2ConsoleUrl,
  filterInstances,
  formatDate,
  type Instance,
  type InstanceFilter,
  parseInstances,
  sortInstances,
  STATE_COLORS,
} from "../lib.ts";
import {
  aws,
  awsArgv,
  awsMissing,
  inTerminal,
  isMissing,
  noProfiles,
  perRegion,
  type Prefs,
  profileActions,
  type Session,
  session,
  showProfile,
} from "../aws.ts";
import { shellLine } from "../terminal.ts";

function changeState(i: Instance, s: Session, verb: "start" | "stop" | "reboot"): Action {
  const label = i.name ?? i.id;
  const titles = { start: "Start Instance", stop: "Stop Instance", reboot: "Reboot Instance" };
  const icons = { start: Icons.play, stop: Icons.stop, reboot: Icons.refresh };
  return action(titles[verb], async () => {
    await aws(["ec2", `${verb}-instances`, "--instance-ids", i.id], { profile: s.profile, region: i.region });
    await toast(`${verb === "start" ? "Starting" : verb === "stop" ? "Stopping" : "Rebooting"} ${label}`, {
      style: "success",
    });
    return refresh();
  }, {
    icon: icons[verb],
    confirm: verb === "start" ? undefined : `${capitalize(verb)} ${label} (${i.id})?`,
    destructive: verb !== "start",
    section: "Instance",
    shortcut: verb === "start" ? "<Ctrl><Shift>s" : verb === "stop" ? "<Ctrl><Shift>x" : undefined,
  });
}

function item(i: Instance, s: Session, prefs: Prefs, multiRegion: boolean): Item {
  const color = STATE_COLORS[i.state];
  const ssm = awsArgv(["ssm", "start-session", "--target", i.id], s.profile, i.region);
  const actions: Action[] = [];
  if (i.state === "running") {
    actions.push(inTerminal("Start SSM Session", ssm, prefs, { icon: Icons.terminal, section: "Terminal" }));
  }
  actions.push(open(ec2ConsoleUrl(i), "Open in AWS Console", { icon: Icons.globe, shortcut: "<Ctrl>o" }));
  actions.push(
    copy(i.id, "Copy Instance ID", { shortcut: "<Ctrl>period", section: "Copy" }),
    ...(i.publicIp ? [copy(i.publicIp, "Copy Public IP", { icon: Icons.globe, section: "Copy" })] : []),
    ...(i.privateIp ? [copy(i.privateIp, "Copy Private IP", { icon: Icons.server, section: "Copy" })] : []),
    ...(i.publicDns ? [copy(i.publicDns, "Copy Public DNS", { icon: Icons.link, section: "Copy" })] : []),
    copy(shellLine(ssm), "Copy SSM Command", { icon: Icons.terminal, section: "Copy" }),
  );
  if (i.state === "stopped") actions.push(changeState(i, s, "start"));
  if (i.state === "running") actions.push(changeState(i, s, "stop"), changeState(i, s, "reboot"));
  actions.push(
    action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ...profileActions(prefs),
  );

  const extraTags = Object.entries(i.tags).filter(([k]) => k !== "Name" && !k.startsWith("aws:")).slice(0, 8);
  return {
    id: `${i.region}/${i.id}`,
    title: i.name ?? i.id,
    subtitle: i.name ? i.id : undefined,
    icon: { source: Icons.server, tint: color },
    section: multiRegion ? i.region : capitalize(i.state),
    keywords: [i.id, i.type, i.state, i.privateIp ?? "", i.publicIp ?? "", i.region, ...Object.values(i.tags)],
    accessories: [
      ...(i.publicIp ? [{ icon: Icons.globe, text: i.publicIp, tooltip: "Public IP" }] : []),
      { text: i.type, tooltip: "Instance type" },
      { tag: capitalize(i.state), color },
    ],
    detail: {
      stats: [
        { label: "state", value: capitalize(i.state), color },
        { label: "type", value: i.type },
        { label: "up for", value: i.state === "running" ? age(i.launched) || "—" : "—" },
      ],
      metadata: [
        meta.text("Instance ID", i.id, { icon: Icons.hash }),
        ...(i.publicIp ? [meta.text("Public IP", i.publicIp, { icon: Icons.globe })] : []),
        ...(i.privateIp ? [meta.text("Private IP", i.privateIp, { icon: Icons.server })] : []),
        ...(i.publicDns ? [meta.text("Public DNS", i.publicDns)] : []),
        meta.text("Zone", i.zone ?? i.region, { icon: Icons.pin }),
        meta.text("Platform", `${i.platform}${i.architecture ? ` · ${i.architecture}` : ""}`, { icon: Icons.cpu }),
        ...(i.imageId ? [meta.text("AMI", i.imageId)] : []),
        ...(i.keyName ? [meta.text("Key pair", i.keyName, { icon: Icons.key })] : []),
        ...(i.iamProfile ? [meta.text("IAM profile", i.iamProfile, { icon: Icons.shield })] : []),
        ...(i.securityGroups.length ? [meta.tags("Security groups", i.securityGroups)] : []),
        meta.separator(),
        ...(i.vpcId ? [meta.text("VPC", i.vpcId, { icon: Icons.layers })] : []),
        ...(i.subnetId ? [meta.text("Subnet", i.subnetId)] : []),
        ...(extraTags.length ? [meta.tags("Tags", extraTags.map(([k, v]) => `${k}=${v}`))] : []),
        ...(i.launched ? [meta.text("Launched", formatDate(i.launched), { icon: Icons.calendar })] : []),
        ...(i.stateReason && i.state !== "running" ? [meta.text("Reason", i.stateReason, { icon: Icons.info })] : []),
        meta.text("Profile", s.profile ?? "default", { icon: Icons.person }),
      ],
    },
    actions,
  };
}

let summary = "";

export default list({
  placeholder: "Filter instances by name, ID, IP, type, tag…",
  filter: {
    options: [
      { value: "running", title: "Running" },
      { value: "stopped", title: "Stopped" },
      { value: "all", title: "All" },
    ],
    default: "all",
  },
  empty: { title: "No instances", description: "Nothing matches in these regions", icon: Icons.server },
  status: () => summary,
  async items({ preferences, filter, signal }) {
    const prefs = preferences as Prefs;
    summary = "";
    const s = await session(prefs);
    let loaded;
    try {
      loaded = await perRegion(s, prefs, async (region) =>
        parseInstances(
          await aws(["ec2", "describe-instances"], { profile: s.profile, region, signal }),
          region,
        ));
    } catch (err) {
      if (isMissing(err)) return [await awsMissing()];
      throw err;
    }
    // Without any profile, credentials may still come from the environment.
    if (!s.profiles.length && loaded.errors.length) return [noProfiles(prefs)];
    const all = loaded.results;
    const running = all.filter((i) => i.state === "running").length;
    summary = `${s.profile ?? "default"} · ${s.regions.join(", ")} · ${all.length} instance${
      all.length === 1 ? "" : "s"
    } · ${running} running`;
    await showProfile(s, loaded.errors.length ? undefined : `${running} running`);
    const multi = s.regions.length > 1;
    const shown = sortInstances(filterInstances(all, (filter ?? "all") as InstanceFilter));
    return [...loaded.errors, ...shown.map((i) => item(i, s, prefs, multi))];
  },
});
