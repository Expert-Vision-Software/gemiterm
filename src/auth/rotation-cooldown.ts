// Shared in-process rotation floor (fix-3b D1): the facade's manual refresh() and the
// session-keepalive loop both consult this seam, so a rotation recorded by either
// consumer suppresses the other within the floor window. Cross-process coordination
// stays with the cookie store's lock + CAS; this is per-process only.

const DEFAULT_ROTATION_FLOOR_MS = 60 * 1000;

export interface RotationCooldownDeps {
  floorMs?: number;
  now?: () => number;
}

export type RotationCooldownSeam = Pick<RotationCooldown, "canRotate" | "record">;

export class RotationCooldown {
  private readonly floorMs: number;
  private readonly now: () => number;
  private readonly lastRotation = new Map<string, number>();

  constructor(deps: RotationCooldownDeps = {}) {
    this.floorMs = deps.floorMs ?? DEFAULT_ROTATION_FLOOR_MS;
    this.now = deps.now ?? (() => Date.now());
  }

  canRotate(profile: string, now: number = this.now()): boolean {
    const last = this.lastRotation.get(profile);
    return last === undefined || now - last >= this.floorMs;
  }

  record(profile: string, now: number = this.now()): void {
    this.lastRotation.set(profile, now);
  }
}
