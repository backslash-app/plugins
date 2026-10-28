// Running a command in the user's terminal emulator (same detection as the Code Projects extension).

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

/** Starts `argv` in a new terminal window that outlives the command. */
export function runInTerminal(argv: string[], preferred?: string, cwd?: string): string {
  for (const term of preferred ? [preferred] : TERMINALS) {
    try {
      const child = new Deno.Command(term, {
        args: terminalArgs(term, argv),
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
