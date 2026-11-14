import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Config from "../config.ts";
import * as Environment from "../environment/ServerEnvironment.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as PairingLinks from "../persistence/AuthPairingLinks.ts";
import * as Policy from "../policy/ManagedPolicy.ts";
import * as Secrets from "./ServerSecretStore.ts";
import * as Auth from "./EnvironmentAuth.ts";
import * as Grants from "./PairingGrantStore.ts";

const layer = Auth.layer.pipe(
  Layer.provide(Policy.layerTest()),
  Layer.provideMerge(Sqlite.layerMemory),
  Layer.provide(Secrets.layer),
  Layer.provide(Environment.layerIdentity),
  Layer.provide(Config.layerTest(process.cwd(), { prefix: "t3-greptile-repro-" })),
  Layer.provide(NodeServices.layer),
  Layer.provide(NodeCrypto.layer),
);

it.effect("serializes approval with device revocation so trust cannot be restored", () =>
  Effect.gen(function* () {
    const auth = yield* Auth.EnvironmentAuth;
    const repository = yield* PairingLinks.AuthPairingLinkRepository;
    const grants = yield* Grants.PairingGrantStore;
    const revokeEntered = yield* Deferred.make<void>();
    const originalRevoke = grants.revokeConnectDevice;
    using _revoke = vi
      .spyOn(grants, "revokeConnectDevice")
      .mockImplementation((key) =>
        Deferred.succeed(revokeEntered, undefined).pipe(Effect.andThen(originalRevoke(key))),
      );
    const key = "greptile-review-race-key";
    yield* auth.issueConnectCredential({ proofKeyThumbprint: key, requireApproval: true });
    const request = (yield* auth.listPairingLinks()).find(
      (x) => x.connectDeviceRequest !== undefined,
    )!;
    const read = yield* Deferred.make<void>();
    const resume = yield* Deferred.make<void>();
    const original = repository.getActiveById;
    using _read = vi.spyOn(repository, "getActiveById").mockImplementation((input) =>
      original(input).pipe(
        Effect.tap(() =>
          input.id === request.id
            ? Effect.gen(function* () {
                yield* Deferred.succeed(read, undefined);
                yield* Deferred.await(resume);
              })
            : Effect.void,
        ),
      ),
    );
    const approval = yield* auth.approveConnectDevice(request.id).pipe(Effect.forkChild);
    yield* Deferred.await(read);
    const revocation = yield* auth
      .revokeConnectDevice(key)
      .pipe(Effect.forkChild({ startImmediately: true }));
    const revocationEnteredDuringApproval = yield* Deferred.isDone(revokeEntered);
    yield* Deferred.succeed(resume, undefined);
    expect(yield* Fiber.join(approval)).toBe(true);
    yield* Fiber.join(revocation);
    expect(revocationEnteredDuringApproval).toBe(false);
    expect(yield* auth.listConnectDevices()).toEqual([]);
    const retry = yield* auth.issueConnectCredential({
      proofKeyThumbprint: key,
      requireApproval: true,
    });
    const error = yield* auth
      .exchangeBootstrapCredentialForAccessToken(
        retry.credential,
        undefined,
        { deviceType: "desktop" },
        {
          proofKeyThumbprint: key,
        },
      )
      .pipe(Effect.flip);
    expect(error._tag).toBe("ServerAuthConnectApprovalPendingError");
  }).pipe(Effect.scoped, Effect.provide(layer)),
);
