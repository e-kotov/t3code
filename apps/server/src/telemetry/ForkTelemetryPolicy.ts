import * as Config from "effect/Config";

// Product analytics are opt-in in the EK fork, including local development.
export const enabled = Config.Boolean("T3CODE_TELEMETRY_ENABLED").pipe(Config.withDefault(false));
