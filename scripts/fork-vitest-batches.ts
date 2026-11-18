import type { Step } from "./check-changed.ts";

const BROWSER_BATCH_SIZE = 20;

/**
 * Keep the existing selection, but bound the lifetime of browser contexts and mock routes.
 * Vitest isolates browser files in new iframes, not fresh browser processes. Each serial
 * command below starts a new process; a failed batch remains failed and is never retried.
 */
export function forkVitestSteps<R>(
  tests: ReadonlyArray<string>,
  command: (name: string, args: ReadonlyArray<string>) => Step<R>,
): Array<Step<R>> {
  // Mirrors apps/web/vite.config.ts's browser include, not every file named "browser".
  // Render-metrics scenarios are a separate opt-in project, not check:changed tests.
  const isBrowser = (file: string) =>
    /^apps\/web\/src\/.*\.browser\.test\.tsx?$/.test(file.replaceAll("\\", "/"));
  const selected = [...new Set(tests)];
  const browser = selected.filter(isBrowser).toSorted();
  // Vitest CLI paths are case-insensitive substring filters, not exact selectors.
  // Check the whole input. Same-command non-browser overlaps are safe (Vitest dedupes
  // discovered files); reject any ambiguity involving separately batched browser files.
  const filters = selected.map((file) => file.replaceAll("\\", "/").toLowerCase());
  for (const [index, filter] of filters.entries()) {
    if (
      filters.some(
        (candidate, other) =>
          other !== index &&
          candidate.includes(filter) &&
          (isBrowser(selected[index]!) || isBrowser(selected[other]!)),
      )
    ) {
      throw new Error(`Cannot batch overlapping test filters: ${selected[index]}`);
    }
  }
  const other = selected.filter((file) => !isBrowser(file));
  const steps: Array<Step<R>> = [];
  const add = (name: string, files: ReadonlyArray<string>) => {
    steps.push({ ...command(name, ["test", "run", "--passWithNoTests", ...files]), serial: true });
  };
  if (other.length > 0) add(`test (${other.length} non-browser files)`, other);
  const count = Math.ceil(browser.length / BROWSER_BATCH_SIZE);
  for (let offset = 0; offset < browser.length; offset += BROWSER_BATCH_SIZE) {
    const files = browser.slice(offset, offset + BROWSER_BATCH_SIZE);
    add(
      `test (browser batch ${offset / BROWSER_BATCH_SIZE + 1}/${count}; ${files.length} files)`,
      files,
    );
  }
  return steps;
}
