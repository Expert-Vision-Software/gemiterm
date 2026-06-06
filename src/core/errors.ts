export class GemitermError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GemitermError";
  }
}

export class AuthenticationError extends GemitermError {
  constructor(message = "Not authenticated. Please run 'gemiterm login' first.") {
    super(message);
    this.name = "AuthenticationError";
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
