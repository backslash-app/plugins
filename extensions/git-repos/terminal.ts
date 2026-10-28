// Running a command in the user's terminal emulator (copied from the SSH Hosts extension, plus a working directory).

/** Tried in this order when no terminal is set in the preferences. */
export const TERMINALS = [
  "kitty",
  "alacritty",
  "wezterm",
  "foot",
  "ghostty",
  "ptyxis",
  "kgx",
  "gnome-terminal",
  "konsole",
  "xfce4-terminal",
  "tilix",
  "xterm",
];

const quote = (arg: string) => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;

/** A command line as a shell would read it back. */
export const shellLine = (argv: string[]) => argv.map(quote).join(" ");

/** The arguments that make `terminal` run `argv` instead of a shell. */
export function terminalArgs(terminal: string, argv: string[]): string[] {
  switch (terminal) {
    case "wezterm":
      return ["start", "--", ...argv];
    case "kitty":
    case "foot":
      return argv;
    case "ptyxis":
    case "kgx":
    case "gnome-terminal":
      return ["--", ...argv];
    case "xfce4-terminal":
      return ["-x", ...argv];
    case "tilix":
      return ["-e", shellLine(argv)];
    default: // alacritty, ghostty, konsole, xterm and most others
      return ["-e", ...argv];
  }
}

/** The arguments that open `terminal` on a shell in `dir` (most terminals start where they are launched). */
export function shellArgs(terminal: string, dir: string): string[] {
  switch (terminal) {
    case "wezterm":
      return ["start", "--cwd", dir];
    case "kitty":
      return ["--directory", dir];
    case "ptyxis":
      return ["--new-window", "--working-directory", dir];
    case "kgx":
    case "gnome-terminal":
    case "xfce4-terminal":
    case "tilix":
      return [`--working-directory=${dir}`];
    case "konsole":
      return ["--workdir", dir];
    case "foot":
      return [`--working-directory=${dir}`];
    default: // alacritty, ghostty, xterm: the launch directory
      return [];
  }
}

/** Opens a shell in `dir` in a new terminal window; returns the terminal used. */
export function openTerminalAt(dir: string, preferred?: string): string {
  return spawnFirst(preferred, (term) => shellArgs(term, dir), dir);
}

/** Starts `argv` in a new terminal window that outlives the command. */
export function runInTerminal(argv: string[], preferred?: string, cwd?: string): string {
  return spawnFirst(preferred, (term) => terminalArgs(term, argv), cwd);
}

function spawnFirst(preferred: string | undefined, args: (term: string) => string[], cwd?: string): string {
  for (const term of preferred ? [preferred] : TERMINALS) {
    try {
      const child = new Deno.Command(term, {
        args: args(term),
        cwd,
        stdin: "null",
        stdout: "null",
        stderr: "null",
      }).spawn();
      child.unref();
      return term;
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }
  throw new Error(
    preferred
      ? `Terminal "${preferred}" not found: change it in the extension's preferences`
      : "No terminal found: set one in the extension's preferences",
  );
}

/** Starts a desktop program that outlives the command; false when it is not installed. */
export function launch(program: string, args: string[] = []): boolean {
  try {
    new Deno.Command(program, { args, stdin: "null", stdout: "null", stderr: "null" }).spawn().unref();
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}
