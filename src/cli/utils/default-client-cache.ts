// Default-process-client cache revalidation (fix-8, gap 4). The SDK client
// bakes cookies at construction (gemini-client-wrapper.ts:96-99) and `init()`
// caches — so a process-cached instance built on a stale PSIDTS cannot read
// with a refreshed jar. This module keeps the cache semantics `forProfile`
// has (construct-per-call) for the default-path client, with one bounded
// exception: when the armed PSIDTS is unchanged across calls, the cached
// instance is returned (zero added latency, zero added init). One SDK init
// GET pays per PSIDTS change — exactly the cost the retry needs anyway.
//
// The seam stays generic over T (not pinned to GeminiClientService) so the
// auth-regression suite can drive the revalidation invariant with a
// lightweight fake instead of a full SDK-shaped client mock.
import type { ArmedSession } from "../../auth/cookie-session.ts";

export interface DefaultClientCacheOptions<T> {
  loadArmed: (profile: string) => Promise<ArmedSession>;
  construct: (armed: ArmedSession, profile: string) => T;
  resolveProfile: () => Promise<string>;
}

export interface DefaultClientCache<T> {
  get(): Promise<T>;
}

export function createDefaultClientCache<T>(
  opts: DefaultClientCacheOptions<T>,
): DefaultClientCache<T> {
  let cached: T | null = null;
  let cachedPsidts: string | null | undefined = undefined;

  return {
    async get(): Promise<T> {
      const profile = await opts.resolveProfile();
      const armed = await opts.loadArmed(profile);
      if (cached !== null && cachedPsidts === armed.secure_1psidts) {
        return cached;
      }
      cached = opts.construct(armed, profile);
      cachedPsidts = armed.secure_1psidts;
      return cached;
    },
  };
}
