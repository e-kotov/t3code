import { subscribeAppActive } from "../../lib/appState";

export function subscribeForkIncomingShareEvents(onShare: () => void): () => void {
  return subscribeAppActive(onShare);
}
