import type { ExpoConfig } from "expo/config";

export function withForkAppIdentity(config: ExpoConfig, forkBuild: boolean, version?: string): ExpoConfig {
  return forkBuild ? { ...config, scheme: "t3code-ek", version: version ?? "0.0.45" } : config;
}
