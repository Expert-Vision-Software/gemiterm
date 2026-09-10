export interface ProfileStatus {
  name: string;
  exists: boolean;
  isActive: boolean;
  expiresAt: string | null;
  lastUsedAt?: string | null;
  isDefault: boolean;
}

export interface ChatInfo {
  id: string;
  title: string;
  isPinned: boolean;
  timestamp: number;
  profile?: string;
}

export interface Message {
  role: "user" | "model";
  content: string;
  conversationId?: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
}

export type SessionState = "live" | "phantom" | "dead";

// gh#25: probe results extend the canonical vocabulary with a transport-level
// verdict — a failed chats probe says nothing about the session itself and
// must never be reported as phantom. Output formatting keys off `state`,
// whose user-facing values stay live/phantom/dead.
export type SessionProbeState = SessionState | "unreachable";

export interface AuthResult {
  cookies: Cookie[];
  expiresAt: Date | null;
}

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}
