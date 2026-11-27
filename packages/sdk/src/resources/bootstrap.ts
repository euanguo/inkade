import type {
  ApiTokenId,
  EmbedCommandInput,
  EmbedShellEventInput,
  EmbedTicketExchangeResponse,
  EmbedTicketResponse,
  ScopeEffectiveSummary,
  Space,
  TokenScope,
  UserId,
  Workspace,
  WorkspaceId,
} from "@inkade/core";
import type { InkadeHttpTransport } from "../http-transport.ts";

export interface HealthResponse {
  readonly ok: boolean;
  readonly service: string;
  readonly dialect: string;
  readonly timestamp: string;
}

export interface BootstrapResponse {
  readonly initialized: boolean;
  readonly hasUsers: boolean;
  readonly allowSignup?: boolean | undefined;
  readonly authMode: "local-auto" | "better-auth";
  readonly workspace: Workspace | null;
}

export interface SetupOwnerInput {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

export interface SetupOwnerResponse {
  readonly initialized: boolean;
  readonly user: {
    readonly id: UserId;
    readonly name: string;
    readonly email: string;
  };
  readonly workspace: Workspace;
}

export interface WhoAmIScopeResponse {
  readonly workspaceId: WorkspaceId;
  readonly principalKind: "token" | "user";
  readonly tokenId: ApiTokenId | null;
  readonly tokenName: string;
  readonly userId: UserId | null;
  readonly scope: TokenScope;
  readonly visibleSpaces: readonly Space[];
  readonly effectiveSummary: ScopeEffectiveSummary;
}

export interface BootstrapResource {
  health(): Promise<HealthResponse>;
  status(): Promise<BootstrapResponse>;
  setupOwner(input: SetupOwnerInput): Promise<SetupOwnerResponse>;
}

export interface EmbedChannelAckResponse {
  readonly ok: boolean;
  readonly eventId: string;
  readonly seq: number;
  readonly embedSessionId: string | null;
}

export interface AuthResource {
  whoami(): Promise<WhoAmIScopeResponse>;
  createEmbedTicket(): Promise<EmbedTicketResponse>;
  exchangeEmbedTicket(ticket: string): Promise<EmbedTicketExchangeResponse>;
  sendEmbedCommand(input: EmbedCommandInput): Promise<EmbedChannelAckResponse>;
  emitEmbedShellEvent(input: EmbedShellEventInput): Promise<EmbedChannelAckResponse>;
}

export function createBootstrapResource(transport: InkadeHttpTransport): BootstrapResource {
  return {
    health: () => transport.requestJson<HealthResponse>("/api/v1/health"),
    status: () => transport.requestJson<BootstrapResponse>("/api/v1/bootstrap"),
    setupOwner: (input) =>
      transport.requestJson<SetupOwnerResponse>("/api/v1/bootstrap/setup", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  };
}

export function createAuthResource(transport: InkadeHttpTransport): AuthResource {
  return {
    whoami: () => transport.requestJson<WhoAmIScopeResponse>("/api/v1/whoami"),
    createEmbedTicket: () =>
      transport.requestJson<EmbedTicketResponse>("/api/v1/auth/embed-ticket", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    exchangeEmbedTicket: (ticket) =>
      transport.requestJson<EmbedTicketExchangeResponse>("/api/v1/auth/embed-ticket/exchange", {
        method: "POST",
        body: JSON.stringify({ ticket }),
      }),
    sendEmbedCommand: (input) =>
      transport.requestJson<EmbedChannelAckResponse>("/api/v1/embed/command", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    emitEmbedShellEvent: (input) =>
      transport.requestJson<EmbedChannelAckResponse>("/api/v1/embed/shell-event", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  };
}
