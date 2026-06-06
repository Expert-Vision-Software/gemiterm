export interface Query<TPayload = unknown> {
  readonly type: string;
  readonly payload: TPayload;
}

export interface Command<TPayload = unknown> {
  readonly type: string;
  readonly payload: TPayload;
}

export interface QueryHandler<TPayload, TResult> {
  readonly queryType: string;
  handle(query: Query<TPayload>): Promise<TResult>;
}

export interface CommandHandler<TPayload, TResult> {
  readonly commandType: string;
  handle(command: Command<TPayload>): Promise<TResult>;
}

type HandlerLike = {
  type: string;
  handle(message: Query | Command): Promise<unknown>;
};

export class Mediator {
  private queryHandlers = new Map<string, HandlerLike>();
  private commandHandlers = new Map<string, HandlerLike>();

  registerQueryHandler<TPayload, TResult>(
    handler: QueryHandler<TPayload, TResult>,
  ): void {
    if (this.queryHandlers.has(handler.queryType)) {
      throw new Error(`Query handler already registered for type: ${handler.queryType}`);
    }
    this.queryHandlers.set(handler.queryType, handler as unknown as HandlerLike);
  }

  registerCommandHandler<TPayload, TResult>(
    handler: CommandHandler<TPayload, TResult>,
  ): void {
    if (this.commandHandlers.has(handler.commandType)) {
      throw new Error(`Command handler already registered for type: ${handler.commandType}`);
    }
    this.commandHandlers.set(
      handler.commandType,
      handler as unknown as HandlerLike,
    );
  }

  async send<TResult>(message: Query | Command): Promise<TResult> {
    const handler = this.queryHandlers.get(message.type) ?? this.commandHandlers.get(message.type);
    if (!handler) {
      throw new Error(`No handler registered for message type: ${message.type}`);
    }
    return handler.handle(message) as Promise<TResult>;
  }
}
