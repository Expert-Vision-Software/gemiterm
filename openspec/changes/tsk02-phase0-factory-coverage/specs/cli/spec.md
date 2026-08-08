## ADDED Requirements

### Requirement: Command handlers forward profile name to client factory

When a `ListChatsQueryHandler`, `DeleteConversationCommandHandler`, `SendMessageCommandHandler`, or `StartNewChatCommandHandler` handles a message whose payload includes a profile name field (`profile` for ListChats, `profileName` for the three commands), the handler MUST call `IGeminiClientService.forProfile(name)` on the injected client before invoking the target operation. When the payload does NOT include a profile name, the handler MUST invoke the operation on the base client directly (no `forProfile` call).

The `ListChatsQueryHandler` MUST:
- Accept a `getGeminiClient: () => Promise<IGeminiClientService>` factory function via constructor injection
- Call `getGeminiClient()` exactly once per `handle()` invocation
- When `profile` is present in the query payload, call `client.forProfile(profile).listChats(options)`
- When `profile` is absent and `allProfiles` is absent, call `client.listChats(options)` directly

The `DeleteConversationCommandHandler`, `SendMessageCommandHandler`, and `StartNewChatCommandHandler` MUST:
- Accept an `IGeminiClientService` instance via constructor injection
- When `profileName` is present in the command payload, call `this.geminiClient.forProfile(profileName)` and invoke the target operation on the returned scoped client
- When `profileName` is absent, invoke the target operation on `this.geminiClient` directly

#### Scenario: ListChats with profile forwards to forProfile

- **WHEN** a `ListChatsQueryHandler` is constructed with a spy `getGeminiClient` factory that returns a client whose `forProfile` and `listChats` are tracked
- **AND** `handler.handle({ type: "list-chats", payload: { profile: "work" } })` is called
- **THEN** `getGeminiClient` is called exactly once
- **AND** `baseClient.forProfile` was called with `"work"`
- **AND** `scopedClient.listChats` was called on the forProfile result

#### Scenario: ListChats without profile does not call forProfile

- **WHEN** a `ListChatsQueryHandler` is constructed with a spy factory
- **AND** `handler.handle({ type: "list-chats", payload: {} })` is called
- **THEN** `baseClient.forProfile` is NOT called
- **AND** `baseClient.listChats` is called directly

#### Scenario: DeleteConversation with profileName forwards to forProfile

- **WHEN** a `DeleteConversationCommandHandler` is constructed with a client stub whose `forProfile` returns a scoped stub and `.deleteChat()` is tracked
- **AND** `handler.handle({ type: "delete-conversation", payload: { conversationId: "c1", profileName: "work" } })` is called
- **THEN** `baseClient.forProfile` was called with `"work"`
- **AND** `scopedClient.deleteChat` was called with `"c1"`

#### Scenario: DeleteConversation without profileName does not call forProfile

- **WHEN** `handler.handle({ type: "delete-conversation", payload: { conversationId: "c1" } })` is called
- **THEN** `baseClient.forProfile` is NOT called
- **AND** `baseClient.deleteChat` was called with `"c1"`

#### Scenario: SendMessage with profileName forwards to forProfile

- **WHEN** a `SendMessageCommandHandler` is constructed with a client stub
- **AND** `handler.handle({ type: "send-message", payload: { conversationId: "c1", message: "hi", profileName: "work" } })` is called
- **THEN** `baseClient.forProfile` was called with `"work"`
- **AND** `scopedClient.sendMessage` was called with `("c1", "hi")`

#### Scenario: StartNewChat with profileName forwards to forProfile

- **WHEN** a `StartNewChatCommandHandler` is constructed with a client stub
- **AND** `handler.handle({ type: "start-new-chat", payload: { message: "hi", profileName: "work" } })` is called
- **THEN** `baseClient.forProfile` was called with `"work"`
- **AND** `scopedClient.startNewChat` was called with `"hi"`
