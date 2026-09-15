# Arm-first sessions; a detached refresh-runner so no command blocks on the browser

`ensureSession` always resolves immediately from the on-disk jar — fresh (mtime < 30 min) with zero added latency, stale with a single-flight detached refresh-runner process spawned fire-and-forget (own process group so it survives `bun run` teardown on Windows; output to `gemiterm.log`; cross-process lock file). Commands never wait for a browser on the happy path; they only **await in-flight rotations** on failure paths (e.g. empty list results, pre-auth-failure), via passive `waitForRotation` polling that spawns and writes nothing.

## Consequences

- Stale jars arm without error — jar shape is not a validity signal (ADR-0004/0005); legacy trimmed jars self-upgrade via the detached refresh.
- The empty-list race (list printing "No conversations found" while the rotation it triggered landed seconds later) is solved by awaiting, not by making arms synchronous.
- At most one runner per profile per process, and single-flight across processes via the lock.
