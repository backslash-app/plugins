import { assertEquals } from "@std/assert";
import {
  enterCommand,
  memory,
  mergeContainers,
  parseDistrobox,
  parseDomInfo,
  parseToolbox,
  parseVirshList,
  removeCommand,
  shortStatus,
  stopCommand,
  virsh,
  vmState,
} from "./lib.ts";
import { terminalArgs } from "./terminal.ts";

const DISTROBOX = `ID           | NAME                 | STATUS             | IMAGE                         
d8a8e1ce1b85 | arch                 | Up 2 hours         | quay.io/toolbx/arch-toolbox:latest
5f3c2a1b0e9d | ubuntu-24            | Exited (0) 3 days ago | docker.io/library/ubuntu:24.04
a1b2c3d4e5f6 | fedora-toolbox-41    | Created            | registry.fedoraproject.org/fedora-toolbox:41`;

const TOOLBOX = `CONTAINER ID  CONTAINER NAME     CREATED         STATUS   IMAGE NAME
ee4e1ed1a7c2  fedora-toolbox-41  2 months ago    exited   registry.fedoraproject.org/fedora-toolbox:41
1234567890ab  rhel-dev           5 days ago      running  registry.access.redhat.com/ubi9/toolbox:latest`;

const VIRSH = ` Id   Name          State
------------------------------
 1    win11         running
 3    debian-srv    paused
 -    fedora-41     shut off
 -    broken vm     crashed
`;

const DOMINFO = `Id:             1
Name:           win11
UUID:           3f2504e0-4f89-11d3-9a0c-0305e82c3301
OS Type:        hvm
State:          running
CPU(s):         4
CPU time:       1234.5s
Max memory:     8388608 KiB
Used memory:    8388608 KiB
Persistent:     yes
Autostart:      disable
Managed save:   no
Security model: none
`;

Deno.test("distrobox list", () => {
  const boxes = parseDistrobox(DISTROBOX);
  assertEquals(boxes.map((b) => [b.name, b.running, b.image]), [
    ["arch", true, "quay.io/toolbx/arch-toolbox:latest"],
    ["ubuntu-24", false, "docker.io/library/ubuntu:24.04"],
    ["fedora-toolbox-41", false, "registry.fedoraproject.org/fedora-toolbox:41"],
  ]);
  assertEquals(boxes[0].id, "d8a8e1ce1b85");
  assertEquals(shortStatus(boxes[1].status), "Exited 3 days ago");
  assertEquals(parseDistrobox(""), []);
});

Deno.test("toolbox list, merged without duplicates", () => {
  const tools = parseToolbox(
    `IMAGE ID      IMAGE NAME    CREATED\nc49cb1e19ad3  registry.fedoraproject.org/fedora-toolbox:41  2 months ago\n\n${TOOLBOX}`,
  );
  assertEquals(tools.map((t) => [t.name, t.running, t.created]), [
    ["fedora-toolbox-41", false, "2 months ago"],
    ["rhel-dev", true, "5 days ago"],
  ]);
  const merged = mergeContainers(parseDistrobox(DISTROBOX), tools);
  assertEquals(merged.map((c) => `${c.kind}:${c.name}`), [
    "distrobox:arch",
    "distrobox:ubuntu-24",
    "distrobox:fedora-toolbox-41",
    "toolbox:rhel-dev",
  ]);
  assertEquals(parseToolbox("No containers"), []);
});

Deno.test("virsh list and dominfo", () => {
  const vms = parseVirshList(VIRSH, "qemu:///session");
  assertEquals(vms.map((v) => [v.id, v.name, v.state, vmState(v.state)]), [
    ["1", "win11", "running", "running"],
    ["3", "debian-srv", "paused", "paused"],
    [undefined, "fedora-41", "shut off", "off"],
    [undefined, "broken vm", "crashed", "crashed"],
  ]);
  const info = parseDomInfo(DOMINFO);
  assertEquals(info["CPU(s)"], "4");
  assertEquals(info["OS Type"], "hvm");
  assertEquals(memory(info["Max memory"]), "8 GiB");
  assertEquals(memory("1572864 KiB"), "1.5 GiB");
  assertEquals(memory("524288 KiB"), "512 MiB");
  assertEquals(memory(undefined), undefined);
});

Deno.test("commands", () => {
  const [arch] = parseDistrobox(DISTROBOX);
  const [, rhel] = parseToolbox(TOOLBOX);
  assertEquals(enterCommand(arch), ["distrobox", "enter", "arch"]);
  assertEquals(enterCommand(rhel), ["toolbox", "enter", "rhel-dev"]);
  assertEquals(stopCommand(arch), ["distrobox", "stop", "--yes", "arch"]);
  assertEquals(stopCommand(rhel), ["podman", "stop", "rhel-dev"]);
  assertEquals(removeCommand(rhel), ["toolbox", "rm", "--force", "rhel-dev"]);
  const [win] = parseVirshList(VIRSH, "qemu:///system");
  assertEquals(virsh(win, "shutdown"), ["virsh", "-c", "qemu:///system", "shutdown", "win11"]);
  assertEquals(terminalArgs("ptyxis", enterCommand(arch)), ["--", "distrobox", "enter", "arch"]);
});
