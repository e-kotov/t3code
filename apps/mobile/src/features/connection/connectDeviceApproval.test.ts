import type { AuthPairingLink } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  type DialogAnswer,
  connectDeviceApprovalPrompts,
  createApprovalPromptQueue,
  createConnectDeviceDialogQueue,
} from "./connectDeviceApproval";

const link = (id: string, createdAtMs: number, request?: AuthPairingLink["connectDeviceRequest"]) =>
  ({
    id,
    scopes: [],
    subject: "cloud-connect",
    createdAt: DateTime.makeUnsafe(createdAtMs),
    expiresAt: DateTime.makeUnsafe(createdAtMs + 600_000),
    ...(request ? { connectDeviceRequest: request } : {}),
  }) as unknown as AuthPairingLink;

describe("connectDeviceApprovalPrompts", () => {
  it("prompts once per waiting device, oldest first, and skips ordinary pairing links", () => {
    const pairingLinks = [
      link("newer", 2_000, { verificationCode: "WXYZ-2345" }),
      link("plain", 500),
      link("older", 1_000, {
        verificationCode: "ABCD-EFGH",
        client: { deviceType: "desktop", browser: "Chrome", os: "macOS" },
      }),
    ];

    const prompts = connectDeviceApprovalPrompts({
      environmentLabel: "Mac mini",
      pairingLinks,
      shownIds: new Set(["newer"]),
    });

    expect(prompts.map((prompt) => prompt.pairingLinkId)).toEqual(["older"]);
    expect(prompts[0]?.message).toContain("Chrome on macOS wants to connect to Mac mini");
    expect(prompts[0]?.message).toContain("ABCD-EFGH");
  });
});

describe("createApprovalPromptQueue", () => {
  it("shows one prompt at a time and offers a failed one again before the rest", () => {
    const shown: string[] = [];
    const answers: Array<(outcome: "done" | "retry" | "later") => void> = [];
    const queue = createApprovalPromptQueue<{ pairingLinkId: string }>((prompt, answer) => {
      shown.push(prompt.pairingLinkId);
      answers.push(answer);
    });

    queue.offer([{ pairingLinkId: "a" }, { pairingLinkId: "b" }]);
    queue.offer([{ pairingLinkId: "a" }]);
    expect(shown).toEqual(["a"]);

    answers.at(-1)!("retry");
    expect(shown).toEqual(["a", "a"]);
    answers.at(-1)!("done");
    expect(shown).toEqual(["a", "a", "b"]);
  });

  it("waits for the next offer when another dialog replaced the prompt", () => {
    const shown: string[] = [];
    const answers: Array<(outcome: "done" | "retry" | "later") => void> = [];
    const queue = createApprovalPromptQueue<{ pairingLinkId: string }>((prompt, answer) => {
      shown.push(prompt.pairingLinkId);
      answers.push(answer);
    });

    queue.offer([{ pairingLinkId: "a" }]);
    answers.at(-1)!("later");
    expect(shown).toEqual(["a"]);
    queue.offer([]);
    expect(shown).toEqual(["a", "a"]);
  });

  it("offers a dropped host's on-screen prompt again once the host is back", () => {
    const shown: string[] = [];
    const answers: Array<(outcome: "done" | "retry" | "later") => void> = [];
    const queue = createApprovalPromptQueue<{ pairingLinkId: string; host: string }>(
      (prompt, answer) => {
        shown.push(prompt.pairingLinkId);
        answers.push(answer);
      },
    );

    queue.offer([{ pairingLinkId: "a", host: "mini" }]);
    queue.drop((prompt) => prompt.host === "mini");
    answers.at(-1)!("retry");
    expect(shown).toEqual(["a"]);
    queue.offer([{ pairingLinkId: "a", host: "mini" }]);
    expect(shown).toEqual(["a", "a"]);
  });

  it("drops a host's waiting prompts so they cannot hold up other hosts", () => {
    const shown: string[] = [];
    const answers: Array<(outcome: "done" | "retry" | "later") => void> = [];
    const queue = createApprovalPromptQueue<{ pairingLinkId: string; host: string }>(
      (prompt, answer) => {
        shown.push(prompt.pairingLinkId);
        answers.push(answer);
      },
    );

    queue.offer([
      { pairingLinkId: "a", host: "mini" },
      { pairingLinkId: "b", host: "mini" },
      { pairingLinkId: "c", host: "laptop" },
    ]);
    queue.drop((prompt) => prompt.host === "mini");
    answers.at(-1)!("done");
    expect(shown).toEqual(["a", "c"]);
    // A dropped host's request can be offered again once the host is back.
    expect(queue.known.has("b")).toBe(false);
  });
});

describe("createConnectDeviceDialogQueue", () => {
  it("keeps one machine's approval visible when another machine signs in", () => {
    const shown: string[] = [];
    const pending: DialogAnswer[] = [];
    const queue = createConnectDeviceDialogQueue((prompt, answer) => {
      shown.push(prompt.pairingLinkId);
      pending.push(answer);
    });

    queue.offer([{ kind: "approval", pairingLinkId: "mini:approval" }]);
    queue.offer([{ kind: "notice", pairingLinkId: "laptop:notice" }]);
    expect(shown).toEqual(["mini:approval"]);

    pending.shift()!("done");
    expect(shown).toEqual(["mini:approval", "laptop:notice"]);
  });

  it("shows waiting approvals before notices without replacing the current dialog", () => {
    const shown: string[] = [];
    const pending: DialogAnswer[] = [];
    const queue = createConnectDeviceDialogQueue((prompt, answer) => {
      shown.push(prompt.pairingLinkId);
      pending.push(answer);
    });

    queue.offer([{ kind: "notice", pairingLinkId: "mini:notice-1" }]);
    queue.offer([{ kind: "notice", pairingLinkId: "mini:notice-2" }]);
    queue.offer([{ kind: "approval", pairingLinkId: "laptop:approval" }]);
    expect(shown).toEqual(["mini:notice-1"]);

    pending.shift()!("done");
    expect(shown).toEqual(["mini:notice-1", "laptop:approval"]);
    pending.shift()!("done");
    expect(shown).toEqual(["mini:notice-1", "laptop:approval", "mini:notice-2"]);
  });
});
