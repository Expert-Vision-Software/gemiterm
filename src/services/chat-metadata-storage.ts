import type { Logger } from "../infrastructure/logger.ts";
import { existsFile, readJsonFile, writeJsonFile } from "../infrastructure/io.ts";
import { getProfileChatMetadataPath } from "../infrastructure/path-utils.ts";

export interface ChatMetadata {
  rid: string;
  rcid: string;
  ctx: string | null;
}

interface ChatMetadataFile {
  version: number;
  entries: Record<string, ChatMetadata>;
}

const CURRENT_VERSION = 1;

export class ChatMetadataStorage {
  private readonly logger: Logger;
  private memoryCache = new Map<string, Map<string, ChatMetadata>>();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  load(profileName: string): Record<string, ChatMetadata> {
    const cacheKey = profileName;
    if (!this.memoryCache.has(cacheKey)) {
      this.memoryCache.set(cacheKey, new Map());
    }

    const profileCache = this.memoryCache.get(cacheKey)!;
    if (profileCache.size > 0) {
      return Object.fromEntries(profileCache);
    }

    const filePath = getProfileChatMetadataPath(profileName);
    if (!existsFile(filePath)) {
      return {};
    }

    try {
      const data = readJsonFile<ChatMetadataFile>(filePath);
      if (!data || typeof data !== "object" || data === null || !("entries" in data)) {
        this.logger.debug(`chat-metadata.json: invalid format for profile '${profileName}', treating as empty`);
        return {};
      }
      if (typeof data.entries !== "object" || data.entries === null || Array.isArray(data.entries)) {
        this.logger.debug(`chat-metadata.json: invalid format for profile '${profileName}', treating as empty`);
        return {};
      }
      if (typeof data.version !== "number") {
        this.logger.debug(`chat-metadata.json: unknown version ${data.version} for profile '${profileName}', treating as empty`);
        return {};
      }
      if (data.version !== CURRENT_VERSION) {
        this.logger.debug(`chat-metadata.json: unknown version ${data.version} for profile '${profileName}', treating as empty`);
        return {};
      }
      const entries = data.entries ?? {};
      for (const [cid, meta] of Object.entries(entries)) {
        if (typeof cid === "string" && meta && typeof meta === "object") {
          profileCache.set(cid, meta);
        }
      }
      return entries;
    } catch (e) {
      this.logger.debug(`chat-metadata.json: corrupt file for profile '${profileName}', treating as empty: ${e}`);
      return {};
    }
  }

  lookup(profileName: string, cid: string): ChatMetadata | null {
    let profileCache = this.memoryCache.get(profileName);
    if (!profileCache) {
      this.load(profileName);
      profileCache = this.memoryCache.get(profileName);
    }
    return profileCache?.get(cid) ?? null;
  }

  save(profileName: string, cid: string, metadata: ChatMetadata): void {
    let profileCache = this.memoryCache.get(profileName);
    if (!profileCache) {
      profileCache = new Map();
      this.memoryCache.set(profileName, profileCache);
    }
    profileCache.set(cid, metadata);

    try {
      const filePath = getProfileChatMetadataPath(profileName);
      let fileData: ChatMetadataFile;
      if (existsFile(filePath)) {
        const existing = readJsonFile<ChatMetadataFile>(filePath);
        if (existing && typeof existing === "object" && "entries" in existing && typeof existing.entries === "object") {
          fileData = { version: existing.version ?? CURRENT_VERSION, entries: { ...existing.entries } };
        } else {
          fileData = { version: CURRENT_VERSION, entries: {} };
        }
      } else {
        fileData = { version: CURRENT_VERSION, entries: {} };
      }
      fileData.version = CURRENT_VERSION;
      fileData.entries[cid] = metadata;
      writeJsonFile(filePath, fileData);
    } catch (e) {
      this.logger.debug(`chat-metadata save failed for profile '${profileName}' cid '${cid}': ${e}`);
    }
  }

  delete(profileName: string, cid: string): void {
    const profileCache = this.memoryCache.get(profileName);
    if (profileCache) {
      profileCache.delete(cid);
    }

    try {
      const filePath = getProfileChatMetadataPath(profileName);
      if (!existsFile(filePath)) {
        return;
      }
      const existing = readJsonFile<ChatMetadataFile>(filePath);
      if (!existing || typeof existing !== "object" || !("entries" in existing)) {
        return;
      }
      const entries = { ...existing.entries };
      delete entries[cid];
      const updated: ChatMetadataFile = { version: existing.version, entries };
      writeJsonFile(filePath, updated);
    } catch (e) {
      this.logger.debug(`chat-metadata delete failed for profile '${profileName}' cid '${cid}': ${e}`);
    }
  }

  listCids(profileName: string): string[] {
    const profileCache = this.memoryCache.get(profileName);
    if (profileCache) {
      return Array.from(profileCache.keys());
    }
    const entries = this.load(profileName);
    return Object.keys(entries);
  }
}
