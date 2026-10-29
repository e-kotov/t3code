export function cleanupRepositoryUnavailable(stderr: string): boolean {
  return /not a git repository|gitfile does not point to a valid repository/i.test(stderr);
}
