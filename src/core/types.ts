export interface ProfileStatus {
  name: string;
  exists: boolean;
  isActive: boolean;
  expiresAt: string | null;
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
