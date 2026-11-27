import type React from "react";
import { createContext, useContext } from "react";
import type { InkadeClient } from "../client.ts";
import type { InkadeSseConfig } from "../sse.ts";

export interface InkadeSdkSseDefaults
  extends Omit<InkadeSseConfig, "baseUrl" | "token"> {
  readonly baseUrl?: string | undefined;
  readonly token?: string | undefined;
  readonly enabled?: boolean | undefined;
}

export interface InkadeSdkContextValue {
  readonly client: InkadeClient;
  readonly sseConfig?: InkadeSdkSseDefaults | undefined;
}

const InkadeSdkContext = createContext<InkadeSdkContextValue | null>(null);

export interface InkadeSdkProviderProps {
  readonly client: InkadeClient;
  readonly sseConfig?: InkadeSdkSseDefaults | undefined;
  readonly children: React.ReactNode;
}

export function InkadeSdkProvider({
  client,
  sseConfig,
  children,
}: InkadeSdkProviderProps): React.ReactElement {
  return (
    <InkadeSdkContext.Provider value={{ client, sseConfig }}>
      {children}
    </InkadeSdkContext.Provider>
  );
}

export function useOptionalInkadeSdkContext(): InkadeSdkContextValue | null {
  return useContext(InkadeSdkContext);
}

export function useInkadeClient(): InkadeClient {
  const ctx = useContext(InkadeSdkContext);
  if (!ctx) {
    throw new Error("useInkadeClient must be used inside <InkadeSdkProvider>");
  }
  return ctx.client;
}

export function useInkadeSseDefaults(): InkadeSdkSseDefaults | undefined {
  return useContext(InkadeSdkContext)?.sseConfig;
}
