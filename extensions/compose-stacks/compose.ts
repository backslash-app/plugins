// Calling docker / podman: which engine, listing the stacks, running compose.

import { exec, storage } from "@backslash/api";
import {
  buildStacks,
  composeCommand,
  type Engine,
  forgetStack,
  parseComposeLs,
  parseDockerPs,
  parsePodmanPs,
  remember,
  type Remembered,
  type Stack,
} from "./lib.ts";

const KEY = "stacks";

export class MissingError extends Error {}

/** The engine set in the preferences, or Docker when its compose plugin answers, Podman otherwise. */
export async function engine(preferred: unknown, signal?: AbortSignal): Promise<Engine> {
  const p = String(preferred ?? "").trim().toLowerCase();
  if (p === "docker" || p === "podman") return p;
  if (p) throw new MissingError(`Engine “${preferred}” is not docker or podman: change it in Settings`);
  for (const program of ["docker", "podman"] as const) {
    try {
      await exec(program, ["compose", "version"], { signal });
      return program;
    } catch (e) {
      if (signal?.aborted) throw e;
      // Not installed, or no compose: try the next one.
    }
  }
  throw new MissingError("Neither docker compose nor podman compose is available");
}

async function rememberedStacks(): Promise<Remembered[]> {
  const saved = await storage.get(KEY).catch(() => undefined);
  return Array.isArray(saved) ? saved as unknown as Remembered[] : [];
}

/** Every stack of the engine, problems first, with the ones brought down since the last visit. */
export async function loadStacks(e: Engine, signal?: AbortSignal): Promise<Stack[]> {
  const [listed, services, old] = await Promise.all([
    // podman compose may hand over to podman-compose, which has no `ls`: containers' labels are enough.
    e === "docker"
      ? exec("docker", ["compose", "ls", "--all", "--format", "json"], { signal }).then(parseComposeLs)
      : Promise.resolve([]),
    e === "docker"
      ? exec("docker", ["ps", "-a", "--filter", "label=com.docker.compose.project", "--format", "json"], { signal })
        .then(parseDockerPs)
      : exec("podman", ["ps", "-a", "--format", "json"], { signal }).then(parsePodmanPs),
    rememberedStacks(),
  ]);
  const stacks = buildStacks(e, listed, services, old);
  storage.set(KEY, remember(old, stacks) as unknown as Parameters<typeof storage.set>[1]).catch(() => {});
  return stacks;
}

export async function forget(stack: Stack): Promise<void> {
  await storage.set(KEY, forgetStack(await rememberedStacks(), stack) as unknown as Parameters<typeof storage.set>[1]);
}

/** Runs `<engine> compose -p … -f … <args>` and returns its output. */
export function compose(stack: Stack, ...args: string[]): Promise<string> {
  const argv = composeCommand(stack, ...args);
  return exec(argv[0], argv.slice(1));
}
