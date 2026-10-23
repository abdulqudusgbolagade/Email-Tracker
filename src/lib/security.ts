import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const token = () => randomBytes(32).toString("base64url");
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function encryptionKey() {
  const key = Buffer.from(process.env.CREDENTIAL_ENCRYPTION_KEY || "", "hex");
  if (key.length !== 32)
    throw new AppError(
      503,
      "Run npm run setup to configure the encryption key.",
    );
  return key;
}
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((x) => x.toString("base64url"))
    .join(".");
}
export function decrypt(value: string) {
  const [iv, tag, data] = value
    .split(".")
    .map((x) => Buffer.from(x, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
export function equal(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function csrfFor(rawSession: string) {
  return createHmac("sha256", rawSession).update("grant-csrf-v1").digest("hex");
}
export function assertOrigin(request: Request) {
  const expected = new URL(process.env.APP_URL || "http://localhost:3000")
    .origin;
  if (request.headers.get("origin") !== expected)
    throw new AppError(403, "Request origin rejected.");
}
export function safeError(error: unknown) {
  if (error instanceof AppError) return error.message;
  if (typeof error === "object" && error && "code" in error) {
    const code = String(error.code);
    const messages: Record<string, string> = {
      EAUTH: "Mailbox authentication failed. Check credentials in Settings.",
      ECONNECTION: "Could not connect to the mailbox server.",
      ETIMEDOUT:
        "Mailbox connection timed out. The send outcome may be uncertain.",
      ESOCKET: "Mailbox TLS or socket connection failed.",
      EENVELOPE: "SMTP rejected the sender or recipient.",
      EMESSAGE: "SMTP rejected the message.",
    };
    if (messages[code]) return messages[code];
  }
  return "Operation failed. Check configuration and the troubleshooting guide; no automatic resend was performed.";
}
