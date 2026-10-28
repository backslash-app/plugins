import { assert, assertEquals } from "@std/assert";
import {
  connection,
  expandPath,
  explainCupsError,
  installCups,
  looksLikePath,
  lpstatProblem,
  osFamily,
  parseJobs,
  parseLpq,
  parseLpstat,
  prettyName,
  size,
} from "./lib.ts";

// CUPS 2.4, LC_ALL=C.
const LPSTAT_P = `printer Brother_HL-L2350DW disabled since Mon 27 Oct 2026 06:22:10 PM CET -
	Paused
	Form mounted:
	Content types: any
	Printer types: unknown
	Description: Brother HL-L2350DW
	Alerts: paused
	Location: Study
	Connection: direct
	Interface: /etc/cups/ppd/Brother_HL-L2350DW.ppd
printer HP_LaserJet_M404 now printing HP_LaserJet_M404-58.  enabled since Tue 28 Oct 2026 10:05:12 AM CET
	Printing page 2, 45% complete.
	Form mounted:
	Description: HP LaserJet Pro M404dn
	Alerts: none
	Location: Office, 2nd floor
	Users allowed:
		(all)
	Banner required
printer PDF is idle.  enabled since Sun 26 Oct 2026 09:00:00 AM CET
system default destination: HP_LaserJet_M404
`;
const LPSTAT_A = `Brother_HL-L2350DW not accepting requests since Mon 27 Oct 2026 06:22:10 PM CET -
	Rejecting Jobs
HP_LaserJet_M404 accepting requests since Tue 28 Oct 2026 10:05:12 AM CET
PDF accepting requests since Sun 26 Oct 2026 09:00:00 AM CET
`;
const LPSTAT_V = `device for Brother_HL-L2350DW: usb://Brother/HL-L2350DW%20series?serial=U12345
device for HP_LaserJet_M404: ipp://192.168.1.20/ipp/print
device for PDF: cups-pdf:/
`;

Deno.test("parseLpstat reads state, details, acceptance and devices", () => {
  const { printers, defaultName } = parseLpstat(LPSTAT_P, LPSTAT_A, LPSTAT_V);
  assertEquals(defaultName, "HP_LaserJet_M404");
  assertEquals(printers.map((p) => [p.name, p.state, p.accepting, p.isDefault]), [
    ["Brother_HL-L2350DW", "disabled", false, false],
    ["HP_LaserJet_M404", "printing", true, true],
    ["PDF", "idle", true, false],
  ]);
  const [brother, hp, pdf] = printers;
  assertEquals([brother.message, brother.alerts, brother.location], ["Paused", "paused", "Study"]);
  assertEquals(brother.since, "Mon 27 Oct 2026 06:22:10 PM CET");
  assertEquals([hp.job, hp.message, hp.description], [
    "HP_LaserJet_M404-58",
    "Printing page 2, 45% complete.",
    "HP LaserJet Pro M404dn",
  ]);
  assertEquals(hp.alerts, undefined);
  assertEquals(hp.location, "Office, 2nd floor");
  assertEquals(pdf.device, "cups-pdf:/");
  assertEquals(parseLpstat("no system default destination\n").printers, []);
});

Deno.test("parseJobs and parseLpq", () => {
  const jobs = parseJobs(
    "HP_LaserJet_M404-58     ada              1024000   Tue 28 Oct 2026 10:05:12 AM CET\n" +
      "Brother_HL-L2350DW-7    bob                 2048   Tue 28 Oct 2026 10:06:40 AM CET\n",
  );
  assertEquals(jobs.map((j) => [j.id, j.printer, j.number, j.user, j.size]), [
    ["HP_LaserJet_M404-58", "HP_LaserJet_M404", 58, "ada", 1024000],
    ["Brother_HL-L2350DW-7", "Brother_HL-L2350DW", 7, "bob", 2048],
  ]);
  assertEquals(jobs[0].date, "Tue 28 Oct 2026 10:05:12 AM CET");
  const lpq = parseLpq(
    "HP_LaserJet_M404 is ready and printing\nRank    Owner   Job     File(s)                         Total Size\n" +
      "active  ada     58      Quarterly report.pdf            1024000 bytes\n1st     ada     59      notes.txt   2048 bytes\n",
  );
  assertEquals(lpq.get(58), { rank: "active", title: "Quarterly report.pdf" });
  assertEquals(lpq.get(59)?.rank, "1st");
});

Deno.test("errors become advice", () => {
  assertEquals(lpstatProblem("lpstat exited with 1: lpstat: Scheduler is not running."), "no-scheduler");
  assertEquals(lpstatProblem("lpstat: No destinations added."), "no-printers");
  assertEquals(lpstatProblem("something else"), undefined);
  assert(explainCupsError("cupsdisable exited with 1: cupsdisable: Forbidden").includes("lpadmin"));
  assertEquals(
    explainCupsError("cancel exited with 1: cancel: Job #9 does not exist."),
    "cancel: Job #9 does not exist.",
  );
});

Deno.test("connection describes device URIs", () => {
  assertEquals(connection("ipp://192.168.1.20/ipp/print"), "Network (IPP) · 192.168.1.20");
  assertEquals(connection("usb://Brother/HL-L2350DW%20series?serial=U12345"), "USB");
  assertEquals(connection("socket://printer.lan:9100"), "Network (JetDirect) · printer.lan");
  assertEquals(connection("dnssd://HP%20M404._ipp._tcp.local/"), "Network (Bonjour) · HP M404._ipp._tcp.local");
  assertEquals(connection(undefined), undefined);
});

Deno.test("small helpers", () => {
  assertEquals(size(1024000), "1.0 MB");
  assertEquals(size(2048), "2.0 KB");
  assertEquals(size(512), "512 B");
  assertEquals(prettyName("HP_LaserJet_M404"), "HP LaserJet M404");
  assertEquals(expandPath("~/Documents/a.pdf", "/home/ada"), "/home/ada/Documents/a.pdf");
  assertEquals(expandPath("file:///tmp/My%20File.pdf", "/home/ada"), "/tmp/My File.pdf");
  assert(looksLikePath("~/Documents/report.pdf"));
  assert(looksLikePath("/tmp/photo.jpg"));
  assert(!looksLikePath("HP"));
  assert(!looksLikePath("~/Documents"));
});

Deno.test("install hints follow the distribution", () => {
  assertEquals(osFamily('NAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\n'), "debian");
  assertEquals(osFamily('ID="opensuse-tumbleweed"\nID_LIKE="opensuse suse"\n'), "suse");
  assertEquals(osFamily("ID=nixos\n"), undefined);
  assertEquals(installCups("arch"), [{
    family: "arch",
    command: "sudo pacman -S cups && sudo systemctl enable --now cups",
  }]);
  assertEquals(installCups().length, 4);
});
