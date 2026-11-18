import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { runSteps } from "./check-changed.ts";
import { forkVitestSteps } from "./fork-vitest-batches.ts";

const browserFile = (index: number) =>
  `apps/web/src/fixture${String(index).padStart(3, "0")}.browser.test.tsx`;

function plan(files: ReadonlyArray<string>) {
  const commands: Array<{ name: string; args: ReadonlyArray<string> }> = [];
  const steps = forkVitestSteps(files, (name, args) => {
    commands.push({ name, args });
    return { name, run: Effect.succeed({ ok: true, output: "" }) };
  });
  return { commands, steps };
}

describe("fork browser process batches", () => {
  it("does not launch an empty command that would select the whole suite", () => {
    assert.deepStrictEqual(plan([]), { commands: [], steps: [] });
  });

  it.each([1, 20, 21, 40, 41])(
    "covers %s browser files once in bounded fresh commands",
    (count) => {
      const files = Array.from({ length: count }, (_, index) => browserFile(index));
      const { commands, steps } = plan(files.toReversed());
      assert.strictEqual(commands.length, Math.ceil(count / 20));
      assert.deepStrictEqual(
        commands.flatMap(({ args }) => args.slice(3)),
        files,
      );
      assert.isTrue(commands.every(({ args }) => args.length > 3 && args.length <= 23));
      assert.isTrue(steps.every((step) => step.serial === true));
      for (const { args } of commands) {
        assert.deepStrictEqual(args.slice(0, 3), ["test", "run", "--passWithNoTests"]);
      }
    },
  );

  it("keeps the complete selection deterministic and follows the browser project paths", () => {
    const other = [
      "apps/web/src/a.test.ts",
      "apps/server/src/a.browser.test.ts",
      "scripts/browser.test.ts",
      "apps/web/test/a.browser.test.tsx",
      "apps/web/src/a.browser.test.mjs",
    ];
    const browser = [browserFile(1), "apps/web/src/a.browser.test.ts"];
    const selected = [...browser, ...other];
    const first = plan(selected);
    const second = plan([...selected.toReversed(), browserFile(1)]);
    assert.deepStrictEqual(first.commands.slice(1), second.commands.slice(1));
    assert.deepStrictEqual(first.commands[0]!.args.slice(3), other);
    assert.deepStrictEqual(first.commands[1]!.args.slice(3), browser.toSorted());
    assert.deepStrictEqual(
      first.commands.flatMap(({ args }) => args.slice(3)).toSorted(),
      selected.toSorted(),
    );
  });

  it("rejects substring-ambiguous filters before launching any command", () => {
    assert.throws(
      () => plan(["apps/web/src/a.browser.test.ts", "apps/web/src/a.browser.test.tsx"]),
      /overlapping test filters/,
    );
    assert.throws(
      () => plan(["apps/web/src/A.browser.test.tsx", "apps/web/src/a.browser.test.tsx"]),
      /overlapping test filters/,
    );
  });

  it("keeps safe non-browser overlaps together in their original order", () => {
    const files = ["apps/mobile/src/home.test.tsx", "apps/mobile/src/home.test.ts"];
    const { commands } = plan(files);
    assert.strictEqual(commands.length, 1);
    assert.deepStrictEqual(commands[0]!.args.slice(3), files);
  });

  it("rejects an overlapping path that would span browser and non-browser commands", () => {
    assert.throws(
      () => plan(["apps/web/src/a.browser.test.tsx", "other/apps/web/src/a.browser.test.tsx"]),
      /overlapping test filters/,
    );
  });

  it("recognizes Windows paths without rewriting literal command arguments", () => {
    const file = "apps\\web\\src\\a.browser.test.tsx";
    const { commands } = plan([file]);
    assert.include(commands[0]!.name, "browser batch");
    assert.deepStrictEqual(commands[0]!.args.slice(3), [file]);
  });

  it.effect("preserves a failed batch and executes every remaining batch once", () =>
    Effect.gen(function* () {
      const files = [
        "apps/web/src/a.test.ts",
        ...Array.from({ length: 41 }, (_, index) => browserFile(index)),
      ];
      const calls: Array<ReadonlyArray<string>> = [];
      const steps = forkVitestSteps(files, (name, args) => ({
        name,
        run: Effect.sync(() => {
          calls.push(args);
          return { ok: !args.includes(browserFile(20)), output: "batch result" };
        }),
      }));
      const results = yield* runSteps(steps, { concurrency: 1, timeoutSeconds: 30 });
      assert.deepStrictEqual(
        results.map((result) => result.outcome),
        ["pass", "pass", "FAIL", "pass"],
      );
      assert.isTrue(results.some((result) => result.outcome !== "pass"));
      assert.strictEqual(calls.length, 4);
      assert.deepStrictEqual(calls.flatMap((args) => args.slice(3)).toSorted(), files.toSorted());
    }),
  );
  it.effect("retains timeout failure, interrupts the process, and runs the next batch once", () =>
    Effect.gen(function* () {
      const calls: Array<string> = [];
      let interrupted = false;
      const steps = forkVitestSteps(
        Array.from({ length: 21 }, (_, index) => browserFile(index)),
        (name, args) => ({
          name,
          run: Effect.gen(function* () {
            calls.push(name);
            if (args.includes(browserFile(0))) {
              return yield* Effect.never.pipe(
                Effect.onInterrupt(() => Effect.sync(() => (interrupted = true))),
              );
            }
            return { ok: true, output: "" };
          }),
        }),
      );
      const fiber = yield* runSteps(steps, { concurrency: 3, timeoutSeconds: 10 }).pipe(
        Effect.forkChild,
      );
      yield* TestClock.adjust("10 seconds");
      const results = yield* Fiber.join(fiber);
      assert.isTrue(interrupted);
      assert.deepStrictEqual(
        results.map(({ outcome }) => outcome),
        ["TIMEOUT", "pass"],
      );
      assert.deepStrictEqual(
        calls,
        steps.map(({ name }) => name),
      );
    }),
  );

  it.effect("serializes all generated commands even with a larger worker budget", () =>
    Effect.gen(function* () {
      let active = 0;
      let maxActive = 0;
      const calls: Array<string> = [];
      const steps = forkVitestSteps(
        ["apps/web/src/a.test.ts", ...Array.from({ length: 41 }, (_, index) => browserFile(index))],
        (name) => ({
          name,
          run: Effect.gen(function* () {
            calls.push(name);
            maxActive = Math.max(maxActive, ++active);
            yield* Effect.sleep("1 second");
            active--;
            return { ok: true, output: "" };
          }),
        }),
      );
      const fiber = yield* runSteps(steps, { concurrency: 3, timeoutSeconds: 10 }).pipe(
        Effect.forkChild,
      );
      yield* TestClock.adjust("10 seconds");
      const results = yield* Fiber.join(fiber);
      assert.strictEqual(maxActive, 1);
      assert.strictEqual(active, 0);
      assert.deepStrictEqual(
        calls,
        steps.map(({ name }) => name),
      );
      assert.isTrue(results.every(({ outcome }) => outcome === "pass"));
    }),
  );
});
