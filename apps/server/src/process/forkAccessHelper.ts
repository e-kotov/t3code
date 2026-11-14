// @effect-diagnostics nodeBuiltinImport:off - isolated CLI helper; never runs in the server process.
import * as NodeFS from "node:fs";

export function runAccessHelper(): void {
  process.on("disconnect", () => process.exit(0));
  process.on("message", (message: { path: string; mode: number }) => {
    let error = null;
    try {
      NodeFS.accessSync(message.path, message.mode);
    } catch (cause) {
      const failure = cause as NodeJS.ErrnoException;
      error = {
        message: failure.message,
        code: failure.code,
        errno: failure.errno,
        syscall: failure.syscall,
        path: failure.path,
      };
    }
    process.send?.({ error }, (failure) => {
      if (failure) process.exit(0);
    });
  });
}
