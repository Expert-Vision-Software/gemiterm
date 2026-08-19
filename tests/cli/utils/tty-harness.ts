// Shared TTY-toggle helper for integration tests that need to flip
// `process.stdin.isTTY` to drive the prompts facade's interactive/non-
// interactive branching without spawning a real PTY. Used by the
// fix-8 (and earlier fix-2) recovery-ladder scenarios.
export function setStdinTty(value: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", {
    value,
    configurable: true,
    writable: true,
  });
}

export function restoreStdinTty(): void {
  const desc = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  if (desc) Object.defineProperty(process.stdin, "isTTY", desc);
  else Reflect.deleteProperty(process.stdin, "isTTY");
}
