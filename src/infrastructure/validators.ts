import { GemitermError } from "../core/errors.ts";

const VALID_PROFILE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export function validateConversationId(id: string): void {
  if (!id || id.trim().length === 0) {
    throw new GemitermError("Conversation ID must not be empty.");
  }
}

export function parseIsoDate(dateStr: string, fieldName: string): number {
  const parsed = Date.parse(dateStr);
  if (Number.isNaN(parsed)) {
    throw new GemitermError(`Invalid ISO date for '${fieldName}': '${dateStr}'.`);
  }
  return parsed;
}

export function validateProfileName(name: string): void {
  if (!name || name.trim().length === 0) {
    throw new GemitermError("Profile name must not be empty.");
  }
  if (!VALID_PROFILE_NAME_RE.test(name)) {
    throw new GemitermError(
      `Profile name '${name}' contains invalid characters. Only alphanumeric characters, hyphens, and underscores are allowed.`,
    );
  }
}
