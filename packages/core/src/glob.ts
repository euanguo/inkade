import picomatch from "picomatch";

/**
 * Evaluates a glob pattern against a file/repository path using picomatch.
 */
export function matchGlob(pattern: string, target: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  const normalizedTarget = target.replace(/\\/g, "/");
  const isMatch = picomatch(trimmed, { dot: true });
  return isMatch(normalizedTarget);
}
