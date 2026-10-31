// Running mongosh with a script: the connection string travels in an
// environment variable, so it never shows in the process list.

import {
  cleanMongoshError,
  type CollectionRow,
  COLLECTIONS_SCRIPT,
  DATABASES_SCRIPT,
  DOCUMENTS_SCRIPT,
  explainError,
  extractResult,
  type ServerInfo,
  withOption,
} from "./lib.ts";

export class MissingError extends Error {}

export async function mongosh<T>(
  uri: string,
  script: string,
  env: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<T> {
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command("mongosh", {
      args: ["--nodb", "--quiet", "--norc", "--eval", script],
      env: {
        // Fail in seconds, not 30, when the server isn't there.
        BS_MONGO_URI: withOption(withOption(uri, "serverSelectionTimeoutMS", "8000"), "appName", "Backslash"),
        ...env,
        MONGOSH_NO_UPDATE_CHECK: "1",
        DO_NOT_TRACK: "1",
      },
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal,
    }).spawn();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new MissingError("mongosh is not installed");
    }
    throw e;
  }
  const { code, stdout, stderr } = await child.output();
  const out = new TextDecoder().decode(stdout);
  if (code !== 0) {
    const err = new TextDecoder().decode(stderr);
    throw new Error(explainError(cleanMongoshError(`${err}\n${out}`) || `mongosh exited with ${code}`));
  }
  return extractResult<T>(out);
}

export const serverInfo = (uri: string, signal?: AbortSignal) => mongosh<ServerInfo>(uri, DATABASES_SCRIPT, {}, signal);

export const collections = (uri: string, db: string, signal?: AbortSignal) =>
  mongosh<CollectionRow[]>(uri, COLLECTIONS_SCRIPT, { BS_DB: db }, signal);

export const documents = (uri: string, db: string, collection: string, filter: string, signal?: AbortSignal) =>
  mongosh<{ docs: Record<string, unknown>[]; total?: number }>(
    uri,
    DOCUMENTS_SCRIPT,
    { BS_DB: db, BS_COLLECTION: collection, BS_FILTER: filter, BS_LIMIT: "20" },
    signal,
  );
