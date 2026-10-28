// Reading the files: ~/.ssh/config with its Includes, ~/.ssh/known_hosts.

import { extraKnownHosts, globRegExp, type Host, parseBlocks, parseKnownHosts, resolveHosts } from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";
export const SSH_DIR = `${HOME}/.ssh`;

const read = (path: string) => {
  try {
    return Deno.readTextFileSync(path);
  } catch {
    return undefined; // missing, or outside the extension's permissions
  }
};

/** `~/x`, `config.d/*` (relative to ~/.ssh), absolute paths; globs in the file name. */
export function expand(pattern: string): { file: string; text: string }[] {
  let path = pattern.replace(/^~(?=\/|$)/, HOME);
  if (!path.startsWith("/")) path = `${SSH_DIR}/${path}`;
  const slash = path.lastIndexOf("/");
  const [dir, name] = [path.slice(0, slash), path.slice(slash + 1)];
  if (!/[*?]/.test(name)) {
    const text = read(path);
    return text === undefined ? [] : [{ file: path, text }];
  }
  const re = globRegExp(name);
  try {
    return [...Deno.readDirSync(dir)]
      .filter((e) => !e.isDirectory && re.test(e.name))
      .map((e) => e.name)
      .sort()
      .flatMap((n) => {
        const text = read(`${dir}/${n}`);
        return text === undefined ? [] : [{ file: `${dir}/${n}`, text }];
      });
  } catch {
    return [];
  }
}

export interface Found {
  config: Host[];
  known: Host[];
  hasConfig: boolean;
}

export function loadHosts(): Found {
  const configText = read(`${SSH_DIR}/config`);
  const config = configText === undefined ? [] : resolveHosts(parseBlocks(configText, `${SSH_DIR}/config`, expand));
  const known = parseKnownHosts(
    [read(`${SSH_DIR}/known_hosts`) ?? "", read(`${SSH_DIR}/known_hosts2`) ?? ""].join("\n"),
  );
  return { config, known: extraKnownHosts(config, known), hasConfig: configText !== undefined };
}

export const tilde = (path: string) => (HOME && path.startsWith(HOME) ? `~${path.slice(HOME.length)}` : path);
