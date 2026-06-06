export interface Query<T = unknown> {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export interface Command<T = unknown> {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export interface QueryHandler<TQuery extends Query<T>, T> {
  readonly queryType: string;
  handle(query: TQuery): Promise<T>;
}

export interface CommandHandler<TCommand extends Command<T>, T> {
  readonly commandType: string;
  handle(command: TCommand): Promise<T>;
}

type HandlerLike<M, R> = {
  type: string;
  handle(message: M): Promise<R>;
};

export class Mediator {
  private queryHandlers = new Map<string, HandlerLike<Query, unknown>>();
  private commandHandlers = new Map<string, HandlerLike<Command, unknown>>();

  registerQueryHandler<TQuery extends Query<T>, T>(
    handler: QueryHandler<TQuery, T>,
  ): void {
    if (this.queryHandlers.has(handler.queryType)) {
      throw new Error(`Query handler already registered for type: ${handler.queryType}`);
    }
    this.queryHandlers.set(handler.queryType, handler as unknown as HandlerLike<Query, unknown>);
  }

  registerCommandHandler<TCommand extends Command<T>, T>(
    handler: CommandHandler<TCommand, T>,
  ): void {
    if (this.commandHandlers.has(handler.commandType)) {
      throw new Error(`Command handler already registered for type: ${handler.commandType}`);
    }
    this.commandHandlers.set(
      handler.commandType,
      handler as unknown as HandlerLike<Command, unknown>,
    );
  }

  async send<T>(message: Query<T> | Command<T>): Promise<T> {
    const handler = this.queryHandlers.get(message.type) ?? this.commandHandlers.get(message.type);
    if (!handler) {
      throw new Error(`No handler registered for message type: ${message.type}`);
    }
    return handler.handle(message) as Promise<T>;
  }
}
