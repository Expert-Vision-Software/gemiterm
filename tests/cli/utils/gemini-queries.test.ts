import { describe, test, expect, mock, afterEach, spyOn } from "bun:test";
import { listChatsForRequest, listChatsOutcomes, fetchChatForRequest } from "../../../src/cli/utils/gemini-queries.ts";
import type { ChatInfo } from "../../../src/core/types.ts";

function makeChat(id: string, timestamp: number): ChatInfo {
  return { id, title: id, isPinned: false, timestamp };
}

describe("listChatsForRequest", () => {
  afterEach(() => {
    mock.restore();
  });

  test("default spans all configured profiles and merges by descending timestamp", async () => {
    const work = { listChats: mock(async () => [makeChat("w1", 100)]) };
    const personal = { listChats: mock(async () => [makeChat("p1", 200)]) };
    const client: any = {
      listChats: mock(async () => []),
      forProfile: mock((name: string) => (name === "work" ? work : personal)),
    };

    const result = await listChatsForRequest(() => client, () => ["work", "personal"], {});

    expect(result.map((c) => c.id)).toEqual(["p1", "w1"]);
    expect(client.forProfile).toHaveBeenCalledWith("work");
    expect(client.forProfile).toHaveBeenCalledWith("personal");
  });

  test("one rejected profile warns and is skipped", async () => {
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const work = { listChats: mock(async () => [makeChat("w1", 100)]) };
      const broken = {
        listChats: mock(async () => {
          throw new Error("unavailable");
        }),
      };
      const client: any = {
        listChats: mock(async () => []),
        forProfile: mock((name: string) => (name === "broken" ? broken : work)),
      };

      const result = await listChatsForRequest(() => client, () => ["work", "broken"], {});

      expect(result.map((c) => c.id)).toEqual(["w1"]);
      expect(stderrSpy.mock.calls.map((c) => c[0]).join("\n")).toContain("broken");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  test("all profiles failing resolves to an empty list", async () => {
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const client: any = {
        listChats: mock(async () => []),
        forProfile: mock((_name: string) => ({
          listChats: mock(async () => {
            throw new Error("down");
          }),
        })),
      };

      const result = await listChatsForRequest(() => client, () => ["a", "b"], {});

      expect(result).toEqual([]);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  test("explicit profile targets exactly that profile without fan-out", async () => {
    const work = { listChats: mock(async () => [makeChat("w1", 100)]) };
    const personal = { listChats: mock(async () => [makeChat("p1", 200)]) };
    const client: any = {
      listChats: mock(async () => []),
      forProfile: mock((name: string) => (name === "work" ? work : personal)),
    };

    const result = await listChatsForRequest(
      () => client,
      () => ["work", "personal"],
      { profile: "work" },
    );

    expect(result.map((c) => c.id)).toEqual(["w1"]);
    expect(client.forProfile).toHaveBeenCalledTimes(1);
    expect(client.forProfile).toHaveBeenCalledWith("work");
    expect(personal.listChats).not.toHaveBeenCalled();
  });

  test("allProfiles flag maps onto the same multi-profile path", async () => {
    const work = { listChats: mock(async () => [makeChat("w1", 100)]) };
    const personal = { listChats: mock(async () => [makeChat("p1", 200)]) };
    const client: any = {
      listChats: mock(async () => []),
      forProfile: mock((name: string) => (name === "work" ? work : personal)),
    };

    const result = await listChatsForRequest(() => client, () => ["work", "personal"], { allProfiles: true });

    expect(result.map((c) => c.id)).toEqual(["p1", "w1"]);
  });
});

describe("listChatsOutcomes", () => {
  afterEach(() => {
    mock.restore();
  });

  test("returns one outcome per profile, distinguishing chats from rejections", async () => {
    const work = { listChats: mock(async () => [makeChat("w1", 100)]) };
    const broken = {
      listChats: mock(async () => {
        throw new Error("unavailable");
      }),
    };
    const client: any = {
      listChats: mock(async () => []),
      forProfile: mock((name: string) => (name === "work" ? work : broken)),
    };

    const outcomes = await listChatsOutcomes(() => client, () => ["work", "broken"], {});

    expect(outcomes).toHaveLength(2);
    const workOutcome = outcomes.find((o) => o.profile === "work");
    const brokenOutcome = outcomes.find((o) => o.profile === "broken");
    expect(workOutcome?.chats?.map((c) => c.id)).toEqual(["w1"]);
    expect(workOutcome?.error).toBeUndefined();
    expect(brokenOutcome?.error).toBeInstanceOf(Error);
    expect(brokenOutcome?.error?.message).toBe("unavailable");
    expect(brokenOutcome?.chats).toBeUndefined();
  });

  test("explicit profile targets exactly that profile without fan-out", async () => {
    const work = { listChats: mock(async () => [makeChat("w1", 100)]) };
    const personal = { listChats: mock(async () => [makeChat("p1", 200)]) };
    const client: any = {
      listChats: mock(async () => []),
      forProfile: mock((name: string) => (name === "work" ? work : personal)),
    };

    const outcomes = await listChatsOutcomes(
      () => client,
      () => ["work", "personal"],
      { profile: "work" },
    );

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].profile).toBe("work");
    expect(outcomes[0].chats?.map((c) => c.id)).toEqual(["w1"]);
  });
});

describe("fetchChatForRequest", () => {
  afterEach(() => {
    mock.restore();
  });

  test("routes through forProfile when a profile name is supplied", async () => {
    const client: any = {
      fetchChat: mock(async () => []),
      forProfile: mock(() => ({ fetchChat: mock(async () => [{ role: "user", content: "hi" }]) })),
    };

    const result = await fetchChatForRequest(() => client, "conv-1", "work");

    expect(client.forProfile).toHaveBeenCalledWith("work");
    expect(result).toEqual([{ role: "user", content: "hi" }]);
  });

  test("uses the default client when no profile name is supplied", async () => {
    const client: any = {
      fetchChat: mock(async () => [{ role: "model", content: "yo" }]),
      forProfile: mock(() => client),
    };

    const result = await fetchChatForRequest(() => client, "conv-1");

    expect(client.forProfile).not.toHaveBeenCalled();
    expect(result).toEqual([{ role: "model", content: "yo" }]);
  });
});
