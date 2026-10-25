import { Platform } from "react-native";
import { builtInTailnetAvailable, useBuiltInTailnet } from "./builtInTailnet";
import { forkConnectionRows } from "./forkConnectionRows";

export function useForkConnectionRows(rows: Parameters<typeof forkConnectionRows>[0]) {
  const { enabled, signedIn, position } = useBuiltInTailnet();
  return forkConnectionRows(rows, {
    android: Platform.OS === "android",
    available: builtInTailnetAvailable(),
    enabled,
    signedIn,
    position,
  });
}
