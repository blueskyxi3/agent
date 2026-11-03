import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";

type Claims = {
  user_id: number;
  plugin_id: string;
  method: string;
  uri: string;
  expires_at: number;
};

export function verifyPluginIdentity(request: FastifyRequest, secret: string): Claims | null {
  const token = request.headers["x-aihub-identity"];
  if (typeof token !== "string" || secret.length < 32) return null;
  const parts = token.split(".");
  const [payload, encodedSignature] = parts;
  if (!payload || !encodedSignature || parts.length !== 2 || payload.length > 4096) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const signature = Buffer.from(encodedSignature, "base64url");
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Claims;
    const now = Math.floor(Date.now() / 1000);
    return Number.isInteger(claims.user_id) && claims.user_id > 0 &&
      claims.plugin_id === "agent" && claims.method === request.method &&
      claims.uri === request.raw.url && Number.isInteger(claims.expires_at) &&
      claims.expires_at > now && claims.expires_at <= now + 60 ? claims : null;
  } catch {
    return null;
  }
}
