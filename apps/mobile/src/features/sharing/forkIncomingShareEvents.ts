import * as Linking from "expo-linking";

import { subscribeAppActive } from "../../lib/appState";

export function subscribeForkIncomingShareEvents(onShare: () => void): () => void {
  const subscription = Linking.addEventListener("url", ({ url }) => {
    try {
      if (new URL(url).hostname === "expo-sharing") onShare();
    } catch {}
  });
  const stopResume = subscribeAppActive(onShare);
  return () => {
    subscription.remove();
    stopResume();
  };
}
