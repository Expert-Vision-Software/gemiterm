import type { Command, CommandHandler } from "./mediator.ts";
import type { AuthResult } from "./types.ts";
import { AuthenticationError } from "./errors.ts";

function extractPayload<T>(command: Command<T>): T {
  return command.payload;
}

export interface AuthenticateCommandPayload {
  profileName?: string;
}

export interface AuthenticateCommandResult {
  success: boolean;
  cookieCount: number;
  expiresAt: string | null;
}

export interface DeleteProfileCommandPayload {
  profileName: string;
}

export interface DeleteProfileCommandResult {
  success: boolean;
}

export interface RenameProfileCommandPayload {
  oldName: string;
  newName: string;
}

export interface RenameProfileCommandResult {
  success: boolean;
}

export interface SetDefaultProfileCommandPayload {
  profileName: string;
}

export interface SetDefaultProfileCommandResult {
  success: boolean;
}

export interface DeleteConversationCommandPayload {
  conversationId: string;
  profileName?: string;
}

export interface DeleteConversationCommandResult {
  success: boolean;
}

export interface SendMessageCommandPayload {
  conversationId: string;
  message: string;
  profileName?: string;
}

export interface SendMessageCommandResult {
  response: string;
}

export interface StartNewChatCommandPayload {
  message: string;
  profileName?: string;
}

export interface StartNewChatCommandResult {
  response: string;
  conversationId: string;
}

export const COMMAND_TYPES = {
  AUTHENTICATE: "authenticate",
  DELETE_PROFILE: "delete-profile",
  RENAME_PROFILE: "rename-profile",
  SET_DEFAULT_PROFILE: "set-default-profile",
  DELETE_CONVERSATION: "delete-conversation",
  SEND_MESSAGE: "send-message",
  START_NEW_CHAT: "start-new-chat",
} as const;

export type CommandType = (typeof COMMAND_TYPES)[keyof typeof COMMAND_TYPES];

export interface IProfileService {
  authenticate(profileName?: string): Promise<AuthResult>;
  deleteProfile(name: string): Promise<void>;
  renameProfile(oldName: string, newName: string): Promise<void>;
  setDefaultProfile(name: string): Promise<void>;
}

export interface IGeminiClientService {
  deleteChat(conversationId: string): Promise<void>;
  sendMessage(conversationId: string, message: string): Promise<string>;
  startNewChat(message: string): Promise<{ response: string; conversationId: string }>;
  profileHasConversation(profileName: string, conversationId: string): Promise<boolean>;
  forProfile(profileName: string): IGeminiClientService;
}

export class AuthenticateCommandHandler
  implements CommandHandler<AuthenticateCommandPayload, AuthenticateCommandResult>
{
  readonly commandType = COMMAND_TYPES.AUTHENTICATE;
  private readonly profileService: IProfileService;

  constructor(profileService: IProfileService) {
    this.profileService = profileService;
  }

  async handle(command: Command<AuthenticateCommandPayload>): Promise<AuthenticateCommandResult> {
    const { profileName } = extractPayload(command);
    try {
      const result = await this.profileService.authenticate(profileName);
      return {
        success: true,
        cookieCount: result.cookies.length,
        expiresAt: result.expiresAt?.toISOString() ?? null,
      };
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return { success: false, cookieCount: 0, expiresAt: null };
      }
      throw error;
    }
  }
}

export class DeleteProfileCommandHandler
  implements CommandHandler<DeleteProfileCommandPayload, DeleteProfileCommandResult>
{
  readonly commandType = COMMAND_TYPES.DELETE_PROFILE;
  private readonly profileService: IProfileService;

  constructor(profileService: IProfileService) {
    this.profileService = profileService;
  }

  async handle(command: Command<DeleteProfileCommandPayload>): Promise<DeleteProfileCommandResult> {
    const { profileName } = extractPayload(command);
    await this.profileService.deleteProfile(profileName);
    return { success: true };
  }
}

export class RenameProfileCommandHandler
  implements CommandHandler<RenameProfileCommandPayload, RenameProfileCommandResult>
{
  readonly commandType = COMMAND_TYPES.RENAME_PROFILE;
  private readonly profileService: IProfileService;

  constructor(profileService: IProfileService) {
    this.profileService = profileService;
  }

  async handle(command: Command<RenameProfileCommandPayload>): Promise<RenameProfileCommandResult> {
    const { oldName, newName } = extractPayload(command);
    await this.profileService.renameProfile(oldName, newName);
    return { success: true };
  }
}

export class SetDefaultProfileCommandHandler
  implements
    CommandHandler<SetDefaultProfileCommandPayload, SetDefaultProfileCommandResult>
{
  readonly commandType = COMMAND_TYPES.SET_DEFAULT_PROFILE;
  private readonly profileService: IProfileService;

  constructor(profileService: IProfileService) {
    this.profileService = profileService;
  }

  async handle(
    command: Command<SetDefaultProfileCommandPayload>,
  ): Promise<SetDefaultProfileCommandResult> {
    const { profileName } = extractPayload(command);
    await this.profileService.setDefaultProfile(profileName);
    return { success: true };
  }
}

export class DeleteConversationCommandHandler
  implements
    CommandHandler<DeleteConversationCommandPayload, DeleteConversationCommandResult>
{
  readonly commandType = COMMAND_TYPES.DELETE_CONVERSATION;
  private readonly geminiClient: IGeminiClientService;

  constructor(geminiClient: IGeminiClientService) {
    this.geminiClient = geminiClient;
  }

  async handle(
    command: Command<DeleteConversationCommandPayload>,
  ): Promise<DeleteConversationCommandResult> {
    const { conversationId, profileName } = extractPayload(command);
    const client = profileName ? this.geminiClient.forProfile(profileName) : this.geminiClient;
    await client.deleteChat(conversationId);
    return { success: true };
  }
}

export class SendMessageCommandHandler
  implements CommandHandler<SendMessageCommandPayload, SendMessageCommandResult>
{
  readonly commandType = COMMAND_TYPES.SEND_MESSAGE;
  private readonly geminiClient: IGeminiClientService;

  constructor(geminiClient: IGeminiClientService) {
    this.geminiClient = geminiClient;
  }

  async handle(command: Command<SendMessageCommandPayload>): Promise<SendMessageCommandResult> {
    const { conversationId, message, profileName } = extractPayload(command);
    const client = profileName ? this.geminiClient.forProfile(profileName) : this.geminiClient;
    const response = await client.sendMessage(conversationId, message);
    return { response };
  }
}

export class StartNewChatCommandHandler
  implements CommandHandler<StartNewChatCommandPayload, StartNewChatCommandResult>
{
  readonly commandType = COMMAND_TYPES.START_NEW_CHAT;
  private readonly geminiClient: IGeminiClientService;

  constructor(geminiClient: IGeminiClientService) {
    this.geminiClient = geminiClient;
  }

  async handle(
    command: Command<StartNewChatCommandPayload>,
  ): Promise<StartNewChatCommandResult> {
    const { message } = extractPayload(command);
    const result = await this.geminiClient.startNewChat(message);
    return { response: result.response, conversationId: result.conversationId };
  }
}
