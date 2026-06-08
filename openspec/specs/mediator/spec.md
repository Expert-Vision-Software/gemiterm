## Purpose

A lightweight, in-process CQRS mediator that decouples request senders (CLI command handlers, services) from request handlers (query and command handlers). The mediator maintains two separate handler maps keyed by message `type`, enforces single-handler-per-type registration, and routes `send()` calls to the correct handler.

## Requirements

### Requirement: Message Types
The system MUST export a `Query<TPayload = unknown>` interface and a `Command<TPayload = unknown>` interface. Each interface MUST have a readonly `type: string` field and a readonly `payload: TPayload` field. `Query` and `Command` MUST be structurally distinct interfaces (the same `{ type, payload }` shape can be sent as either, but each handler type is registered separately).

#### Scenario: Constructing a query
- **WHEN** a caller creates `{ type: "GetX", payload: { id: 1 } }` typed as `Query<{ id: number }>`
- **THEN** the resulting object has `type === "GetX"` and `payload.id === 1`

#### Scenario: Constructing a command
- **WHEN** a caller creates `{ type: "DoX", payload: "data" }` typed as `Command<string>`
- **THEN** the resulting object has `type === "DoX"` and `payload === "data"`

### Requirement: Handler Interfaces
The system MUST export a `QueryHandler<TPayload, TResult>` interface and a `CommandHandler<TPayload, TResult>` interface. `QueryHandler` MUST expose a readonly `queryType: string` and an async `handle(query: Query<TPayload>): Promise<TResult>` method. `CommandHandler` MUST expose a readonly `commandType: string` and an async `handle(command: Command<TPayload>): Promise<TResult>` method.

#### Scenario: Defining a query handler
- **WHEN** an object is declared as `QueryHandler<string, number>` with `queryType: "Len"` and a `handle` that returns the payload length
- **THEN** the handler object satisfies the `QueryHandler` shape and is accepted by `registerQueryHandler`

#### Scenario: Defining a command handler
- **WHEN** an object is declared as `CommandHandler<string, string>` with `commandType: "Echo"` and a `handle` that returns the payload
- **THEN** the handler object satisfies the `CommandHandler` shape and is accepted by `registerCommandHandler`

### Requirement: Mediator Handler Registration
The `Mediator` class MUST provide `registerQueryHandler(handler)` and `registerCommandHandler(handler)` methods. Each method MUST store the handler in a separate internal map keyed by `queryType` / `commandType`. If a handler is already registered for the same `type`, the registration MUST throw an `Error` whose message names the duplicate type.

#### Scenario: Registering a query handler
- **WHEN** `registerQueryHandler(handler)` is called with `handler.queryType === "GetLength"`
- **THEN** the mediator stores the handler and a subsequent `send` of `{ type: "GetLength", payload: ... }` resolves through this handler

#### Scenario: Duplicate query registration throws
- **WHEN** two `QueryHandler` objects with the same `queryType` are both passed to `registerQueryHandler`
- **THEN** the second call throws an error whose message is `Query handler already registered for type: <type>`

#### Scenario: Duplicate command registration throws
- **WHEN** two `CommandHandler` objects with the same `commandType` are both passed to `registerCommandHandler`
- **THEN** the second call throws an error whose message is `Command handler already registered for type: <type>`

### Requirement: Send Dispatches by Type
`Mediator.send<TResult>(message)` MUST look up the registered handler whose `type` matches `message.type` (query map first, then command map) and MUST invoke that handler's `handle()` method with the full `message` object. The returned promise MUST resolve to the handler's result. If no handler is registered for the given `type`, `send()` MUST reject with an `Error` whose message is `No handler registered for message type: <type>`.

#### Scenario: Query send dispatches to query handler
- **WHEN** a query handler for `"GetLength"` returns `payload.length` and `send({ type: "GetLength", payload: "hello" })` is called
- **THEN** the returned promise resolves to `5`

#### Scenario: Command send dispatches to command handler
- **WHEN** a command handler for `"Echo"` returns its payload and `send({ type: "Echo", payload: "hi" })` is called
- **THEN** the returned promise resolves to `"hi"`

#### Scenario: Send with no registered handler rejects
- **WHEN** `send({ type: "Nobody", payload: null })` is called on a mediator with no handler for that type
- **THEN** the returned promise rejects with an `Error` whose message is `No handler registered for message type: Nobody`

#### Scenario: Full message object is forwarded to the handler
- **WHEN** a query handler captures the `query` argument and `send({ type: "Inspect", payload: { key: "val" } })` is called
- **THEN** the handler observes `received.type === "Inspect"` and `received.payload === { key: "val" }`

### Requirement: Query and Command Maps Are Independent
The mediator MUST maintain two separate internal maps: one for query handlers, one for command handlers. A handler registered as a query MUST NOT satisfy a `send()` call for a type that is only registered as a command, and vice versa.

#### Scenario: Query handler is not reachable via command map
- **WHEN** a query handler is registered for `"Q"` and no command handler is registered for `"Q"`
- **THEN** `send({ type: "Q", payload: undefined })` is dispatched to the query handler and resolves with the query's result (the mediator also accepts the call as falling through to the command map, but the query handler — being first — handles it)

#### Scenario: Command handler is not visible to query registration
- **WHEN** a command handler is registered for `"C"` on a fresh mediator and a query handler is registered for a different type
- **THEN** `send({ type: "C", payload: undefined })` resolves to the command handler's result and is unaffected by the presence of the unrelated query handler
