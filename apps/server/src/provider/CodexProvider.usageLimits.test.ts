import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, assert } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { CodexSettings } from "@t3tools/contracts";

import { checkCodexProviderStatus, type CodexAppServerProviderSnapshot } from "./CodexProvider.ts";

const defaultCodexSettings: CodexSettings = Schema.decodeSync(CodexSettings)({});

function makeCodexProbeSnapshot(
  input: Partial<CodexAppServerProviderSnapshot> = {},
): CodexAppServerProviderSnapshot {
  return {
    version: "1.0.0",
    account: {
      account: null,
      requiresOpenaiAuth: false,
    },
    models: [],
    skills: [],
    ...input,
  };
}

it.layer(NodeServices.layer)("CodexProvider usageLimits", (it) => {
  it.effect(
    "marks usage limits unsupported when app-server does not require OpenAI auth (custom provider / LiteLLM)",
    () =>
      Effect.gen(function* () {
        const status = yield* checkCodexProviderStatus(defaultCodexSettings, () =>
          Effect.succeed(
            makeCodexProbeSnapshot({
              account: {
                account: null,
                requiresOpenaiAuth: false,
              },
            }),
          ),
        );

        assert.strictEqual(status.status, "ready");
        assert.strictEqual(status.auth.status, "unknown");
        assert.deepStrictEqual(status.usageLimits?.unavailable, {
          reason: "unsupported",
        });
      }),
  );

  it.effect(
    "marks usage limits unsupported when app-server uses an OpenAI API key (which reports requiresOpenaiAuth: true)",
    () =>
      Effect.gen(function* () {
        const status = yield* checkCodexProviderStatus(defaultCodexSettings, () =>
          Effect.succeed(
            makeCodexProbeSnapshot({
              account: {
                account: {
                  type: "apiKey",
                },
                requiresOpenaiAuth: true,
              },
            }),
          ),
        );

        assert.strictEqual(status.status, "ready");
        assert.deepStrictEqual(status.usageLimits?.unavailable, {
          reason: "unsupported",
        });
      }),
  );

  it.effect("marks usage limits unsupported for non-ChatGPT accounts (e.g. Amazon Bedrock)", () =>
    Effect.gen(function* () {
      const status = yield* checkCodexProviderStatus(defaultCodexSettings, () =>
        Effect.succeed(
          makeCodexProbeSnapshot({
            account: {
              account: {
                type: "amazonBedrock",
              },
              requiresOpenaiAuth: false,
            },
          }),
        ),
      );

      assert.strictEqual(status.status, "ready");
      assert.deepStrictEqual(status.usageLimits?.unavailable, {
        reason: "unsupported",
      });
    }),
  );

  it.effect(
    "reports probeFailed with sign-in guidance when CLI requires OpenAI auth and is signed out",
    () =>
      Effect.gen(function* () {
        const status = yield* checkCodexProviderStatus(defaultCodexSettings, () =>
          Effect.succeed(
            makeCodexProbeSnapshot({
              account: {
                account: null,
                requiresOpenaiAuth: true,
              },
            }),
          ),
        );

        assert.strictEqual(status.status, "error");
        assert.strictEqual(status.auth.status, "unauthenticated");
        assert.deepStrictEqual(status.usageLimits?.unavailable, {
          reason: "probeFailed",
          message: "Codex CLI is not authenticated. Run `codex login` and try again.",
        });
      }),
  );

  it.effect(
    "still reports probeFailed when a ChatGPT account's usage read fails",
    () =>
      Effect.gen(function* () {
        const status = yield* checkCodexProviderStatus(defaultCodexSettings, () =>
          Effect.succeed(
            makeCodexProbeSnapshot({
              account: {
                account: { type: "chatgpt", email: "test@example.com", planType: "pro" },
                requiresOpenaiAuth: true,
              },
              rateLimits: { failure: "Codex did not answer the usage request." },
            }),
          ),
        );

        assert.deepStrictEqual(status.usageLimits?.unavailable, {
          reason: "probeFailed",
          message: "Codex did not answer the usage request.",
        });
      }),
  );
});
