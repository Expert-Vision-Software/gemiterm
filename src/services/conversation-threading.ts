import type { ChatMetadata } from "./chat-metadata-storage.ts";

const INDEX_CID = 0;
const INDEX_RID = 1;
const INDEX_RCID = 2;
const INDEX_CTX = 9;

export function makeMetadata(cid: string, stored: ChatMetadata): (string | null)[] {
  const arr: (string | null)[] = new Array(10).fill(null);
  arr[INDEX_CID] = cid;
  arr[INDEX_RID] = stored.rid;
  arr[INDEX_RCID] = stored.rcid;
  arr[INDEX_CTX] = stored.ctx ?? "";
  return arr;
}

export function extractMetadata(metadata: (string | null)[] | undefined): ChatMetadata | null {
  if (!metadata) return null;
  const rid = metadata[INDEX_RID];
  const rcid = metadata[INDEX_RCID];
  if (!rid && !rcid) return null;
  const ctx = metadata[INDEX_CTX];
  return { rid: rid ?? "", rcid: rcid ?? "", ctx: ctx === "" ? null : (ctx ?? null) };
}

export function threadOnto(
  cid: string,
  stored: ChatMetadata | null,
): { metadata: (string | null)[]; seeded: boolean } {
  if (stored) {
    return { metadata: makeMetadata(cid, stored), seeded: true };
  }
  return { metadata: makeMetadata(cid, { rid: "", rcid: "", ctx: null }), seeded: false };
}

export function captureFrom(
  output: { metadata?: (string | null)[] },
  cid: string,
): ChatMetadata | null {
  const meta = extractMetadata(output.metadata);
  if (!meta) return null;
  if (meta.rid && meta.rcid) return meta;
  return { ...meta, rid: meta.rid || "", rcid: meta.rcid || "" };
}
