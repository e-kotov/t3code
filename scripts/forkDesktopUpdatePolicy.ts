import { FORK_RELEASE_REPOSITORY } from "@t3tools/shared/forkCliRelease";

// Homebrew owns EK desktop updates; shipping no publish config also omits
// app-update.yml, so the native checker never starts.
export function usesHomebrewUpdates(repository: string): boolean {
  return repository.trim() === FORK_RELEASE_REPOSITORY;
}
