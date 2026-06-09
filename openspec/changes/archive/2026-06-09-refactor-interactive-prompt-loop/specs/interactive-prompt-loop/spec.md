## ADDED Requirements

### Requirement: Interactive prompt loop SHALL support continuous chat sessions
The interactive prompt loop utility SHALL provide a reusable mechanism for chat commands to engage in continuous back-and-forth conversations with the user until explicitly terminated.

#### Scenario: User sends multiple messages in a session
- **WHEN** user starts an interactive session and enters a message
- **THEN** the system processes the message and displays the response
- **AND** the system prompts for the next message

#### Scenario: User can exit the session
- **WHEN** user types "/exit" or "/quit"
- **THEN** the system displays "Goodbye." and terminates the session

#### Scenario: Empty input is handled gracefully
- **WHEN** user presses Enter without typing anything
- **THEN** the system re-prompts without sending an empty message

#### Scenario: Errors during message processing do not terminate the session
- **WHEN** user enters a message but processing throws an error
- **THEN** the system displays the error message
- **AND** the system re-prompts for the next message

### Requirement: Interactive prompt loop SHALL support command-specific message handling
The utility SHALL accept a callback function that handles each message, allowing different commands to process messages differently.

#### Scenario: New chat command creates new conversation
- **WHEN** the new command uses the interactive loop with a message handler
- **AND** user enters a message
- **THEN** the system starts a new conversation and displays the response

#### Scenario: Continue command sends to existing conversation
- **WHEN** the continue command uses the interactive loop with a message handler
- **AND** user enters a message
- **THEN** the system sends the message to the existing conversation ID