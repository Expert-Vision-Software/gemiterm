import { describe, test, expect } from "bun:test";
import {
  classifySession,
  getRecoveryAction,
  SessionState,
  RecoveryAction,
} from "../../src/services/session-state.ts";
import type { RotateCookiesResult } from "../../src/services/cookie-rotation.ts";

const noRotation: RotateCookiesResult = { rotated: false, attempted: false };
const throttled: RotateCookiesResult = { rotated: false, attempted: false };
const attempted: RotateCookiesResult = { rotated: false, attempted: true };
const rotated: RotateCookiesResult = { rotated: true, attempted: true };
const declined: RotateCookiesResult = { rotated: false, attempted: false, sessionInvalid: true };

describe("classifySession", () => {
  test("no valid cookies → Stale", () => {
    expect(classifySession({ hasValidCookies: false, serverProbe: null, rotation: noRotation, isPhantom: false }))
      .toBe(SessionState.Stale);
  });

  test("valid cookies + server probe stale → Dead", () => {
    expect(classifySession({ hasValidCookies: true, serverProbe: "stale", rotation: noRotation, isPhantom: false }))
      .toBe(SessionState.Dead);
  });

  test("valid cookies + server probe valid + rotation successful → Fresh", () => {
    expect(classifySession({ hasValidCookies: true, serverProbe: "valid", rotation: rotated, isPhantom: false }))
      .toBe(SessionState.Fresh);
  });

  test("valid cookies + probe null + rotation successful → Fresh", () => {
    expect(classifySession({ hasValidCookies: true, serverProbe: null, rotation: rotated, isPhantom: false }))
      .toBe(SessionState.Fresh);
  });

  test("valid cookies + probe valid + rotation attempted but not rotated + not phantom → Stale", () => {
    expect(classifySession({ hasValidCookies: true, serverProbe: "valid", rotation: attempted, isPhantom: false }))
      .toBe(SessionState.Stale);
  });

  test("valid cookies + probe valid + rotation attempted + phantom → Phantom", () => {
    expect(classifySession({ hasValidCookies: true, serverProbe: "valid", rotation: attempted, isPhantom: true }))
      .toBe(SessionState.Phantom);
  });

  test("valid cookies + probe valid + rotation sessionInvalid + phantom → Phantom", () => {
    expect(classifySession({ hasValidCookies: true, serverProbe: "valid", rotation: declined, isPhantom: true }))
      .toBe(SessionState.Phantom);
  });

  test("valid cookies + probe valid + rotation sessionInvalid + not phantom → Declined", () => {
    expect(classifySession({ hasValidCookies: true, serverProbe: "valid", rotation: declined, isPhantom: false }))
      .toBe(SessionState.Declined);
  });

  test("valid cookies + probe valid + throttled rotation → Fresh", () => {
    expect(classifySession({ hasValidCookies: true, serverProbe: "valid", rotation: throttled, isPhantom: false }))
      .toBe(SessionState.Fresh);
  });

  test("server probe stale overrides rotation success → Dead", () => {
    expect(classifySession({ hasValidCookies: true, serverProbe: "stale", rotation: rotated, isPhantom: false }))
      .toBe(SessionState.Dead);
  });
});

describe("getRecoveryAction", () => {
  test("Fresh → None", () => {
    expect(getRecoveryAction(SessionState.Fresh)).toBe(RecoveryAction.None);
  });

  test("Phantom → TargetedRefresh", () => {
    expect(getRecoveryAction(SessionState.Phantom)).toBe(RecoveryAction.TargetedRefresh);
  });

  test("Dead → None (full L2 removed — corrupted cookies, see phantom-bug-synthesis.md Session 3a)", () => {
    expect(getRecoveryAction(SessionState.Dead)).toBe(RecoveryAction.None);
  });

  test("Stale → AutoExtend", () => {
    expect(getRecoveryAction(SessionState.Stale)).toBe(RecoveryAction.AutoExtend);
  });

  test("Declined → None", () => {
    expect(getRecoveryAction(SessionState.Declined)).toBe(RecoveryAction.None);
  });
});
