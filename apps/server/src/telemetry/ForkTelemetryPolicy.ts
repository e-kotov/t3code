import * as Config from "effect/Config";

// The EK fork never sends product analytics or agent feedback; no setting turns them on.
export const enabled = Config.succeed(false);
