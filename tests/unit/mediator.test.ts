import { describe, test, expect, beforeEach } from "bun:test";
import {
  Mediator,
  type QueryHandler,
  type CommandHandler,
  type Query,
  type Command,
} from "../../src/core/mediator.ts";

describe("Mediator", () => {
  let mediator: Mediator;

  beforeEach(() => {
    mediator = new Mediator();
  });

  describe("registerQueryHandler and send (queries)", () => {
    test("resolves a query via a registered handler", async () => {
      const handler: QueryHandler<string, number> = {
        queryType: "GetLength",
        handle(query: Query<string>) {
          return Promise.resolve(query.payload.length);
        },
      };

      mediator.registerQueryHandler(handler);

      const result = await mediator.send<number>({
        type: "GetLength",
        payload: "hello",
      });

      expect(result).toBe(5);
    });

    test("throws if two handlers are registered for the same query type", () => {
      const handlerA: QueryHandler<void, void> = {
        queryType: "Duplicate",
        handle() {
          return Promise.resolve();
        },
      };
      const handlerB: QueryHandler<void, void> = {
        queryType: "Duplicate",
        handle() {
          return Promise.resolve();
        },
      };

      mediator.registerQueryHandler(handlerA);

      expect(() => mediator.registerQueryHandler(handlerB)).toThrow(
        "Query handler already registered for type: Duplicate",
      );
    });

    test("passes the full query object to the handler", async () => {
      let received: Query<{ key: string }> | undefined;
      const handler: QueryHandler<{ key: string }, string> = {
        queryType: "Inspect",
        handle(query) {
          received = query;
          return Promise.resolve("ok");
        },
      };

      mediator.registerQueryHandler(handler);

      await mediator.send({ type: "Inspect", payload: { key: "val" } });

      expect(received).toBeDefined();
      expect(received!.type).toBe("Inspect");
      expect(received!.payload).toEqual({ key: "val" });
    });
  });

  describe("registerCommandHandler and send (commands)", () => {
    test("resolves a command via a registered handler", async () => {
      const handler: CommandHandler<string, string> = {
        commandType: "Echo",
        handle(cmd: Command<string>) {
          return Promise.resolve(cmd.payload);
        },
      };

      mediator.registerCommandHandler(handler);

      const result = await mediator.send<string>({
        type: "Echo",
        payload: "hello world",
      });

      expect(result).toBe("hello world");
    });

    test("throws if two handlers are registered for the same command type", () => {
      const handlerA: CommandHandler<void, void> = {
        commandType: "Duplicate",
        handle() {
          return Promise.resolve();
        },
      };
      const handlerB: CommandHandler<void, void> = {
        commandType: "Duplicate",
        handle() {
          return Promise.resolve();
        },
      };

      mediator.registerCommandHandler(handlerA);

      expect(() => mediator.registerCommandHandler(handlerB)).toThrow(
        "Command handler already registered for type: Duplicate",
      );
    });
  });

  describe("unknown message type", () => {
    test("throws when sending a message with no registered handler", async () => {
      await expect(
        mediator.send({ type: "NobodyHandlesMe", payload: null }),
      ).rejects.toThrow(
        "No handler registered for message type: NobodyHandlesMe",
      );
    });

    test("does not mix query and command handlers", async () => {
      mediator.registerQueryHandler<void, string>({
        queryType: "OnlyQuery",
        handle() {
          return Promise.resolve("query-result");
        },
      });

      await expect(
        mediator.send({ type: "OnlyQuery", payload: undefined }),
      ).resolves.toBe("query-result");

      const fresh = new Mediator();
      fresh.registerCommandHandler<void, string>({
        commandType: "OnlyCommand",
        handle() {
          return Promise.resolve("command-result");
        },
      });

      await expect(
        fresh.send({ type: "OnlyCommand", payload: undefined }),
      ).resolves.toBe("command-result");
    });
  });
});
