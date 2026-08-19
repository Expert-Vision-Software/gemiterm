import type { SessionState } from "./types.ts";

export class GemitermError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GemitermError";
  }
}

export class AuthenticationError extends GemitermError {
  readonly profileName?: string;
  readonly sessionState?: SessionState;
  constructor(message = "Not authenticated. Please run 'gemiterm login' first.", opts: { profileName?: string; sessionState?: SessionState } = {}) {
    super(message);
    this.name = "AuthenticationError";
    this.profileName = opts.profileName;
    this.sessionState = opts.sessionState;
  }
}

export class CookieExpiredError extends GemitermError {
  constructor(message = "Session has expired. Please run 'gemiterm login' again.") {
    super(message);
    this.name = "CookieExpiredError";
  }
}

export class GeminiAPIError extends GemitermError {
  constructor(message: string) {
    super(message);
    this.name = "GeminiAPIError";
  }
}

export class ConversationNotFoundError extends GemitermError {
  constructor(conversationId: string) {
    super(`Conversation '${conversationId}' not found.`);
    this.name = "ConversationNotFoundError";
  }
}

export class ConversationPendingError extends GemitermError {
  constructor(message = "Conversation operation is still pending.") {
    super(message);
    this.name = "ConversationPendingError";
  }
}

export class LockUnavailableError extends GemitermError {
  constructor(lockPath: string, waitedMs: number) {
    super(`Could not acquire profile lock '${lockPath}' after waiting ${waitedMs}ms.`);
    this.name = "LockUnavailableError";
  }
}

export class SessionValidationError extends GemitermError {
  constructor(message = "Stored session is not usable. Run 'gemiterm auth' to authenticate.") {
    super(message);
    this.name = "SessionValidationError";
  }
}

export class LoginTimeoutError extends GemitermError {
  constructor(timeoutMs: number) {
    super(`Authentication timed out after ${timeoutMs}ms. No auth cookies detected.`);
    this.name = "LoginTimeoutError";
  }
}

export class LoginCancelledError extends GemitermError {
  constructor(message = "Authentication cancelled: the headed browser was closed before login completed.") {
    super(message);
    this.name = "LoginCancelledError";
  }
}

export class LoginUnroutableError extends GemitermError {
  constructor(
    message = "Authentication did not produce gemini-routable cookies (no __Secure-1PSID/TS routable to https://gemini.google.com). Re-run 'gemiterm auth' and complete sign-in on the gemini.google.com page.",
  ) {
    super(message);
    this.name = "LoginUnroutableError";
  }
}
