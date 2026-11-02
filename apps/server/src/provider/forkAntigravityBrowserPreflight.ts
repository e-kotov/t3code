const maxExcerptLength = 200;
const guidance = "Check the Node.js runtime and NODE_OPTIONS in this environment.";

function stderrLines(text: string) {
  return text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

function nodeReport(lines: ReadonlyArray<string>, expectedLine: string) {
  const line = lines.find((candidate) => candidate.trim() !== "" && candidate !== expectedLine);
  if (line === undefined) return "";
  const excerpt = line
    .replace(/\p{Cc}/gu, " ")
    .trim()
    .slice(0, maxExcerptLength);
  return ` Node reported: "${excerpt}".`;
}

/**
 * Node may add diagnostics such as UNDICI-EHPA to stderr, so only the marker line is authoritative.
 * Returns the user-facing failure, or undefined when the helper behaved correctly.
 */
export function antigravityBrowserPreflightFailure(input: {
  readonly exitCode: number;
  readonly stdout: { readonly bytes: number; readonly truncated: boolean };
  readonly stderr: { readonly text: string; readonly truncated: boolean };
  readonly expectedLine: string;
}): string | undefined {
  const lines = stderrLines(input.stderr.text);
  const markers = lines.filter((line) => line === input.expectedLine).length;
  const reason =
    input.exitCode !== 0
      ? `exited with code ${input.exitCode}`
      : input.stdout.bytes !== 0 || input.stdout.truncated
        ? "wrote unexpected output to stdout"
        : input.stderr.truncated
          ? "wrote too much output to stderr"
          : markers !== 1
            ? "did not report the expected sign-in URL"
            : undefined;
  if (reason === undefined) return undefined;
  return `Antigravity's sign-in browser helper ${reason}.${nodeReport(lines, input.expectedLine)} ${guidance}`;
}
