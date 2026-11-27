import type { Workspace, WorkspaceId } from "@inkade/core";
import { InkadeError } from "@inkade/core";
import {
  seedDefaultWorkspace,
  type SeedRepositories,
  type WorkspaceRepo,
} from "@inkade/db";
import type { WorkspaceSpacesCache } from "../cache/workspace-spaces-cache.ts";
import type { InkadeAuth } from "../auth/better-auth.ts";

export interface BootstrapStatusResult {
  readonly initialized: boolean;
  readonly hasUsers: boolean;
  readonly allowSignup: boolean;
  readonly authMode: "local-auto" | "better-auth";
  readonly workspace: Workspace | null;
}

export interface SetupOwnerInput {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

export interface BootstrapServiceDeps {
  readonly workspaceRepo: WorkspaceRepo;
  readonly seedRepos: SeedRepositories;
  readonly auth: InkadeAuth;
  readonly defaultWorkspaceId: WorkspaceId;
  readonly localAutoAuth: boolean;
  readonly allowSignup?: boolean | undefined;
  readonly spacesCache?: WorkspaceSpacesCache | undefined;
}

export class BootstrapService {
  constructor(private readonly deps: BootstrapServiceDeps) {}

  async checkDbHealth(): Promise<void> {
    await this.deps.workspaceRepo.hasRegisteredUsers();
  }

  async getStatus(): Promise<BootstrapStatusResult> {
    const [hasUsers, workspace] = await Promise.all([
      this.deps.workspaceRepo.hasRegisteredUsers(),
      this.deps.workspaceRepo.getWorkspaceById(this.deps.defaultWorkspaceId),
    ]);
    return {
      initialized: hasUsers || this.deps.localAutoAuth,
      hasUsers,
      allowSignup: !hasUsers || this.deps.allowSignup === true,
      authMode: this.deps.localAutoAuth ? "local-auto" : "better-auth",
      workspace,
    };
  }

  async setupOwner(input: SetupOwnerInput, rawHeaders: Headers): Promise<Response> {
    const hasUsers = await this.deps.workspaceRepo.hasRegisteredUsers();
    if (hasUsers) {
      throw new InkadeError("CONFLICT", "Workspace owner account is already initialized");
    }

    const authResponse = await this.deps.auth.api.signUpEmail({
      body: {
        name: input.name,
        email: input.email,
        password: input.password,
      },
      headers: rawHeaders,
      asResponse: true,
    });

    if (!authResponse.ok) {
      const errBody = await authResponse.text();
      return new Response(errBody, {
        status: authResponse.status,
        headers: authResponse.headers,
      });
    }

    const payload = (await authResponse.json()) as {
      user: { id: string; name: string; email: string };
      token?: string | null;
    };

    await this.deps.workspaceRepo.claimWorkspaceOwnerIfUnset(
      this.deps.defaultWorkspaceId,
      payload.user.id,
    );
    const seeded = await seedDefaultWorkspace(this.deps.seedRepos, {
      ownerUserId: payload.user.id,
    });
    this.deps.spacesCache?.invalidate(seeded.workspace.id);

    const headers = new Headers();
    const setCookies = authResponse.headers.getSetCookie?.() ?? [];
    for (const cookie of setCookies) {
      headers.append("set-cookie", cookie);
    }
    if (setCookies.length === 0) {
      const singleCookie = authResponse.headers.get("set-cookie");
      if (singleCookie) headers.set("set-cookie", singleCookie);
    }
    headers.set("content-type", "application/json");

    return new Response(
      JSON.stringify({
        initialized: true,
        user: payload.user,
        workspace: seeded.workspace,
      }),
      { status: 201, headers },
    );
  }
}
