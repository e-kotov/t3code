import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { UtilitySnapshot } from "@t3tools/contracts";
import * as DesktopIpc from "../ipc/DesktopIpc.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { DeviceUtilitiesRuntime } from "./DeviceUtilitiesRuntime.ts";

export const installDeviceUtilities = Effect.fn("desktop.utilities.install")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const runtime = new DeviceUtilitiesRuntime(environment.homeDirectory);
  const call = <A>(operation: () => Promise<A>) =>
    Effect.tryPromise({ try: operation, catch: (cause) => new Error(String(cause)) });
  yield* Effect.addFinalizer(() => Effect.sync(() => runtime.dispose()));
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: "desktop:utilities-snapshot",
      payload: Schema.Void,
      result: UtilitySnapshot,
      handler: () => call(() => runtime.snapshot()),
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: "desktop:utilities-reload",
      payload: Schema.Void,
      result: UtilitySnapshot,
      handler: () => call(() => runtime.reload()),
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: "desktop:utilities-check",
      payload: Schema.Void,
      result: Schema.Void,
      handler: () => call(() => runtime.check()),
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: "desktop:utilities-active",
      payload: Schema.Struct({ clientId: Schema.String, active: Schema.Boolean }),
      result: Schema.Void,
      handler: ({ clientId, active }) => call(() => runtime.active(clientId, active)),
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: "desktop:utilities-action",
      payload: Schema.Struct({
        serviceId: Schema.String,
        actionId: Schema.String,
        revision: Schema.Int,
      }),
      result: Schema.Void,
      handler: ({ serviceId, actionId, revision }) =>
        call(() => runtime.action(serviceId, actionId, revision)),
    }),
  );
});
