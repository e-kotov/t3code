import Constants from "expo-constants";

type ObserveClient = Pick<
  typeof import("expo-observe").Observe,
  "configure" | "dispatchEvents" | "reportError"
>;

const projectId: unknown = Constants.expoConfig?.extra?.eas?.projectId;
export const forkObserveAvailable = typeof projectId === "string" && projectId.trim() !== "";

// Requiring Expo Observe initializes native code that throws without an EAS project ID.
export const Observe: ObserveClient = forkObserveAvailable
  ? (require("expo-observe") as typeof import("expo-observe")).Observe
  : {
      configure: () => {},
      dispatchEvents: async () => {},
      reportError: () => {},
    };
