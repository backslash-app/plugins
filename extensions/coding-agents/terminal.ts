// Running a command in the user's terminal emulator (same detection as the Git Repos extension).

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

/**
 * The shell script a terminal runs to resume a session: go to its folder,
 * start the agent, and keep the window open if anything fails so the user
 * can read why.
 */
export function resumeScript(dir: string | undefined, argv: string[]): string {
  const hold = `printf '\\n[Press Enter to close] '; read -r _`;
  const cd = dir
    ? `cd -- ${shellLine([dir])} || { echo ${shellLine([`${dir} no longer exists`])}; ${hold}; exit 1; }; `
    : "";
  return `${cd}${shellLine(argv)} || { ${hold}; }`;
}

/** Starts `argv` in a new terminal window that outlives the command; returns the terminal used. */
export function runInTerminal(argv: string[], preferred?: string): string {
  for (const term of preferred ? [preferred] : TERMINALS) {
    try {
      const child = new Deno.Command(term, {
        args: terminalArgs(term, argv),
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

/** The shell running the script: the user's bash or zsh (their PATH, nvm…), else sh. */
export function shellArgv(shell: string | undefined, script: string): string[] {
  const name = (shell ?? "").split("/").pop() ?? "";
  return ["bash", "zsh"].includes(name) ? [shell!, "-ic", script] : ["sh", "-c", script];
}
