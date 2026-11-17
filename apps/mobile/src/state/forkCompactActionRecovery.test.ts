import { it, expect } from "@effect/vitest";
import { CommandId, EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";
import { recoverRejectedCompactAction } from "./forkCompactActionRecovery";
import { removeThreadOutboxMessage } from "./thread-outbox-removal";
import { setThreadComposerError } from "./thread-composer-error";

vi.mock("./thread-outbox-removal", () => ({ removeThreadOutboxMessage: vi.fn() }));
vi.mock("./thread-composer-error", () => ({ setThreadComposerError: vi.fn() }));
vi.mock("./use-thread-outbox", async () => {
  const { Atom } = await import("effect/reactivity");
  return { editingQueuedMessageIdsAtom: Atom.make({}) };
});

it.effect(
  "exposes failed compact removal as a recoverable Effect error without reporting success",
  () =>
    Effect.gen(function* () {
      vi.mocked(setThreadComposerError).mockClear();
      const cause = new Error("storage unavailable");
      vi.mocked(removeThreadOutboxMessage).mockRejectedValueOnce(cause);
      const failure = yield* recoverRejectedCompactAction(
        {
          environmentId: EnvironmentId.make("local"),
          threadId: ThreadId.make("thread"),
          messageId: MessageId.make("compact"),
          commandId: CommandId.make("compact-command"),
          text: "/compact",
          compactAction: true,
          attachments: [],
          createdAt: "2026-11-16T00:00:00.000Z",
        },
        1,
        "provider disabled",
      ).pipe(Effect.flip);
      expect(failure.cause).toBe(cause);
      expect(setThreadComposerError).not.toHaveBeenCalled();
    }),
);
