// @effect-diagnostics nodeBuiltinImport:off - filesystem preflights must not use the server's libuv pool.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { selfInvocationArgs } from "@t3tools/shared/nodeRuntime";

// Two active preflights plus room to recover from two uninterruptible checks.
// A timed-out helper still consumes a slot until it actually exits.
const MAX_HELPERS = 4;
const DEADLINE_MS = 5_000;
// Like DocumentText, resolve the CLI entry from this module rather than the host's argv
// (which may belong to an embedding app). SEA dispatches the same private subcommand.
const entrypoint = NodeURL.fileURLToPath(
  new URL(import.meta.url.endsWith(".ts") ? "../bin.ts" : "./bin.mjs", import.meta.url),
);

type AccessError = {
  message: string;
  code?: string;
  errno?: number;
  syscall?: string;
  path?: string;
};
type Job = {
  path: string;
  timer: ReturnType<typeof setTimeout>;
  resolve: () => void;
  reject: (error: Error) => void;
};
type Entry = { helper: NodeChildProcess.ChildProcess; job: Job | undefined; quarantined: boolean };
const helpers = new Set<Entry>();
const idle: Entry[] = [];
const paths = new Map<string, Entry>();
const unavailable = (path: string, code: string) =>
  Object.assign(new Error(`Filesystem preflight ${code}: ${path}`), {
    code,
    preflightUnavailable: true,
    syscall: "access",
    path,
  });

const quarantine = (entry: Entry, error: Error) => {
  if (entry.quarantined) return;
  entry.quarantined = true;
  Object.assign(error, { preflightUnavailable: true });
  const index = idle.indexOf(entry);
  if (index !== -1) idle.splice(index, 1);
  if (entry.job) {
    clearTimeout(entry.job.timer);
    entry.job.reject(error);
  }
  // Killing a process is a request, not proof of exit. Retain its slot and path until
  // exit, and unref both child and IPC so an uninterruptible syscall cannot hold us open.
  entry.helper.kill("SIGKILL");
  entry.helper.unref();
  entry.helper.channel?.unref();
};

const create = (): Entry => {
  const entry: Entry = {
    helper: NodeChildProcess.spawn(
      "/usr/bin/env",
      [
        "--",
        HostProcess.ExecutablePath.defaultValue(),
        ...selfInvocationArgs(
          {
            command: HostProcess.ExecutablePath.defaultValue(),
            entrypoint: HostProcess.IsExecutable.defaultValue() ? undefined : entrypoint,
          },
          ["__fork-access"],
        ),
      ],
      {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: { ...HostProcess.Environment.defaultValue(), ELECTRON_RUN_AS_NODE: "1" },
      },
    ),
    quarantined: false,
    job: undefined,
  };
  helpers.add(entry);
  entry.helper.on("message", ({ error }: { error: AccessError | null }) => {
    if (entry.quarantined || !entry.job) return;
    const job = entry.job;
    clearTimeout(job.timer);
    paths.delete(job.path);
    entry.job = undefined;
    idle.push(entry);
    entry.helper.unref();
    entry.helper.channel?.unref();
    if (error === null) job.resolve();
    else job.reject(Object.assign(new Error(error.message), error));
  });
  entry.helper.on("error", (error) => quarantine(entry, error));
  const release = () => {
    helpers.delete(entry);
    const index = idle.indexOf(entry);
    if (index !== -1) idle.splice(index, 1);
    if (entry.job) {
      clearTimeout(entry.job.timer);
      if (paths.get(entry.job.path) === entry) paths.delete(entry.job.path);
      if (!entry.quarantined) entry.job.reject(unavailable(entry.job.path, "EIO"));
    }
  };
  entry.helper.on("exit", release);
  entry.helper.on("close", release);
  return entry;
};

/** access() with native errno details, isolated from the server's filesystem thread pool. */
export const access = (path: string, mode: number): Promise<void> =>
  new Promise((resolve, reject) => {
    // Do not replace a stuck check on the same path or grow an unbounded helper pool.
    if (paths.has(path) || (idle.length === 0 && helpers.size >= MAX_HELPERS)) {
      reject(unavailable(path, "EAGAIN"));
      return;
    }
    let entry: Entry;
    try {
      entry = idle.pop() ?? create();
    } catch (error) {
      reject(Object.assign(unavailable(path, "EIO"), { cause: error }));
      return;
    }
    entry.job = {
      path,
      resolve,
      reject,
      // @effect-diagnostics-next-line globalTimers:off - The deadline must outlive cancellation of the requesting fiber.
      timer: setTimeout(() => quarantine(entry, unavailable(path, "ETIMEDOUT")), DEADLINE_MS),
    };
    paths.set(path, entry);
    entry.helper.ref();
    entry.helper.channel?.ref();
    try {
      entry.helper.send({ path, mode }, (error) => {
        if (error) quarantine(entry, error);
      });
    } catch (error) {
      quarantine(entry, error instanceof Error ? error : new Error(String(error)));
    }
  });

/** Distinguishes helper/transport failures from native access errno results. */
export const isUnavailable = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "preflightUnavailable" in error &&
  error.preflightUnavailable === true;
