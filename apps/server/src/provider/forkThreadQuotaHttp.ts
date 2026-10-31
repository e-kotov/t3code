import { AuthOrchestrationReadScope, EnvironmentHttpApi } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { requireEnvironmentScope } from "../auth/http.ts";
import * as ForkThreadQuota from "./ForkThreadQuota.ts";

export const layer = HttpApiBuilder.group(EnvironmentHttpApi, "threadQuota",
  Effect.fnUntraced(function* (handlers) {
    const quota = yield* ForkThreadQuota.ForkThreadQuota;
    return handlers.handle("read", Effect.fn("environment.threadQuota.read")(function* (args) {
      yield* requireEnvironmentScope(AuthOrchestrationReadScope);
      return yield* quota.read(args.params.threadId);
    }));
  }),
);
