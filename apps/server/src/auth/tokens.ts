import { randomBytes } from "node:crypto";

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function generateRawApiToken(): { readonly rawToken: string; readonly tokenPrefix: string } {
  const secretPart = randomBytes(24).toString("base64url");
  const rawToken = `ink_${secretPart}`;
  const tokenPrefix = rawToken.slice(0, 12);
  return { rawToken, tokenPrefix };
}
