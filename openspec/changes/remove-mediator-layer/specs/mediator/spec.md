## REMOVED Requirements

### Requirement: Message Types
The `Query<TPayload>` and `Command<TPayload>` interfaces, their readonly `type`/`payload` fields, and the structural distinction between them are removed. No message-object types remain.

### Requirement: Handler Interfaces
The `QueryHandler<TPayload, TResult>` and `CommandHandler<TPayload, TResult>` interfaces are removed.

### Requirement: Mediator Handler Registration
The `Mediator` class and its `registerQueryHandler` / `registerCommandHandler` methods, duplicate-registration errors, and handler maps are removed.

### Requirement: Send Dispatches by Type
The `Mediator.send()` method, its type-based dispatch (query map then command map), and the "No handler registered for message type" error are removed.

### Requirement: Query and Command Maps Are Independent
The two-map separation behavior is removed along with the `Mediator` class.
