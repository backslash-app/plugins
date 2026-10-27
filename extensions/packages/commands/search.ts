import { copy, exec, Icons, type Item, list, meta, open, paste } from "@backslash/api";

interface Package {
  name: string;
  summary: string;
  version?: string;
  source: "apt" | "dnf" | "pacman" | "zypper" | "flatpak";
}

const INSTALL: Record<Package["source"], (name: string) => string> = {
  apt: (n) => `sudo apt install ${n}`,
  dnf: (n) => `sudo dnf install ${n}`,
  pacman: (n) => `sudo pacman -S ${n}`,
  zypper: (n) => `sudo zypper install ${n}`,
  flatpak: (n) => `flatpak install flathub ${n}`,
};

const PAGE: Record<Package["source"], (name: string) => string> = {
  apt: (n) => `https://packages.debian.org/search?keywords=${n}`,
  dnf: (n) => `https://packages.fedoraproject.org/pkgs/${n}/`,
  pacman: (n) => `https://archlinux.org/packages/?q=${n}`,
  zypper: (n) => `https://software.opensuse.org/package/${n}`,
  flatpak: (n) => `https://flathub.org/apps/${n}`,
};

/** Runs a search tool; a missing tool just means "not this distribution". */
async function tryExec(program: string, args: string[], signal: AbortSignal): Promise<string | null> {
  try {
    return await exec(program, args, { signal });
  } catch (err) {
    if (signal.aborted) throw err;
    return null;
  }
}

async function system(query: string, signal: AbortSignal): Promise<Package[]> {
  const apt = await tryExec("apt-cache", ["search", "--names-only", query], signal);
  if (apt !== null) {
    return apt.split("\n").filter(Boolean).map((line) => {
      const [name, ...rest] = line.split(" - ");
      return { name, summary: rest.join(" - "), source: "apt" as const };
    });
  }
  const dnf = await tryExec("dnf", ["search", "-q", query], signal);
  if (dnf !== null) {
    return dnf.split("\n").filter((l) => l.includes(" : ")).map((line) => {
      const [name, summary] = line.split(" : ");
      return { name: name.trim().replace(/\.[^.]+$/, ""), summary: summary.trim(), source: "dnf" as const };
    });
  }
  const pacman = await tryExec("pacman", ["-Ss", query], signal);
  if (pacman !== null) {
    const lines = pacman.split("\n");
    const out: Package[] = [];
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const [full, version] = lines[i].split(" ");
      out.push({ name: full.split("/")[1] ?? full, version, summary: lines[i + 1].trim(), source: "pacman" });
    }
    return out;
  }
  const zypper = await tryExec("zypper", ["--quiet", "search", query], signal);
  if (zypper !== null) {
    return zypper.split("\n").filter((l) => l.includes("|") && !l.includes("Name")).map((line) => {
      const cols = line.split("|").map((c) => c.trim());
      return { name: cols[1], summary: cols[2] ?? "", source: "zypper" as const };
    }).filter((p) => p.name);
  }
  return [];
}

async function flathub(query: string, signal: AbortSignal): Promise<Package[]> {
  const out = await tryExec("flatpak", ["search", "--columns=application,name,description,version", query], signal);
  if (!out || out.startsWith("No matches")) return [];
  return out.split("\n").filter(Boolean).map((line) => {
    const [id, name, summary, version] = line.split("\t");
    return { name: id, summary: `${name}: ${summary}`, version, source: "flatpak" as const };
  });
}

const SOURCES: Record<Package["source"], string> = {
  apt: "Debian / Ubuntu (apt)",
  dnf: "Fedora (dnf)",
  pacman: "Arch (pacman)",
  zypper: "openSUSE (zypper)",
  flatpak: "Flathub",
};

function item(p: Package, query: string): Item {
  const exact = p.name === query || p.name.endsWith(`.${query}`);
  const install = INSTALL[p.source](p.name);
  return {
    id: `${p.source}:${p.name}`,
    title: p.name,
    subtitle: p.summary,
    icon: { source: p.source === "flatpak" ? Icons.apps : Icons.package, tint: exact ? "blue" : "gray" },
    section: p.source === "flatpak" ? "Flathub" : "Distribution",
    accessories: [...(p.version ? [{ text: p.version }] : []), { tag: p.source }],
    detail: {
      markdown: `\`${install}\``,
      metadata: [
        meta.text("Package", p.name, { icon: Icons.package }),
        ...(p.version ? [meta.text("Version", p.version)] : []),
        meta.text("From", SOURCES[p.source]),
        meta.link("Page", PAGE[p.source](p.name).replace(/^https:\/\//, ""), PAGE[p.source](p.name)),
      ],
    },
    actions: [
      copy(install, "Copy Install Command"),
      paste(install, "Paste Install Command", { icon: Icons.terminal }),
      open(PAGE[p.source](p.name), "Open Package Page"),
      copy(p.name, "Copy Name", { section: "Copy" }),
    ],
  };
}

export default list({
  placeholder: "Search packages…",
  empty: { title: "Search packages", description: "apt, dnf, pacman or zypper, and Flathub", icon: "bs-package" },
  status: (items) => items.length ? `${items.length} package${items.length === 1 ? "" : "s"}` : "Packages",
  async search(query, { signal }) {
    if (query.trim().length < 2) return [];
    const [sys, flat] = await Promise.all([system(query, signal), flathub(query, signal)]);
    // Exact and prefix matches first.
    const rank = (p: Package) => (p.name === query ? 0 : p.name.startsWith(query) ? 1 : 2);
    return [...sys.sort((a, b) => rank(a) - rank(b)).slice(0, 40), ...flat.slice(0, 20)].map((p) => item(p, query));
  },
});
