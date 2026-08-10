import type { RotateCookiesResult } from "./cookie-rotation.ts";

export const SessionState = {
  Fresh: "Fresh",
  Phantom: "Phantom",
  Dead: "Dead",
  Stale: "Stale",
  Declined: "Declined",
} as const;

export type SessionState = (typeof SessionState)[keyof typeof SessionState];

export const RecoveryAction = {
  None: "None",
  TargetedRefresh: "TargetedRefresh",
  AutoExtend: "AutoExtend",
} as const;

export type RecoveryAction = (typeof RecoveryAction)[keyof typeof RecoveryAction];

export interface SessionClassifyParams {
  hasValidCookies: boolean;
  serverProbe: "valid" | "stale" | null;
  rotation: RotateCookiesResult;
  isPhantom: boolean;
}

export function classifySession(params: SessionClassifyParams): SessionState {
  const { hasValidCookies, serverProbe, rotation, isPhantom } = params;

  if (!hasValidCookies) {
    return SessionState.Stale;
  }

  if (serverProbe === "stale") {
    return SessionState.Dead;
  }

  if (rotation.rotated) {
    return SessionState.Fresh;
  }

  if (rotation.sessionInvalid) {
    return isPhantom ? SessionState.Phantom : SessionState.Declined;
  }

  if (rotation.attempted) {
    return isPhantom ? SessionState.Phantom : SessionState.Stale;
  }

  return SessionState.Fresh;
}

export function getRecoveryAction(state: SessionState): RecoveryAction {
  switch (state) {
    case SessionState.Fresh:
      return RecoveryAction.None;
    case SessionState.Phantom:
      return RecoveryAction.TargetedRefresh;
    case SessionState.Dead:
      return RecoveryAction.None;
    case SessionState.Stale:
      return RecoveryAction.AutoExtend;
    case SessionState.Declined:
      return RecoveryAction.None;
  }
}
