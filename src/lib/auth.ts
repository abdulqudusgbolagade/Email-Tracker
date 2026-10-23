import { hash, verify } from "@node-rs/argon2";
import { db } from "./db";
import {
  AppError,
  assertOrigin,
  csrfFor,
  digest,
  equal,
  token,
} from "./security";

export const SESSION_COOKIE = "grant_session";
export const hashPassword = (password: string) =>
  hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export async function rateLimit(id: string, limit: number, windowMs: number) {
  const now = new Date();
  // One SQL statement keeps limits valid under concurrent requests and processes.
  await db.$executeRaw`INSERT INTO RateLimit (id, count, resetAt) VALUES (${id}, 1, ${new Date(now.getTime() + windowMs)}) ON CONFLICT(id) DO UPDATE SET count = CASE WHEN resetAt <= ${now} THEN 1 ELSE count + 1 END, resetAt = CASE WHEN resetAt <= ${now} THEN ${new Date(now.getTime() + windowMs)} ELSE resetAt END`;
  const row = await db.rateLimit.findUniqueOrThrow({ where: { id } });
  if (row.count > limit)
    throw new AppError(429, "Too many requests. Please try again later.");
}
export async function login(email: string, password: string) {
  await rateLimit("login:global", 10, 15 * 60_000);
  const owner = await db.owner.findUnique({
    where: { email: email.trim().toLowerCase() },
  });
  // Always perform a password hash even if no account matches.
  const valid = owner
    ? await verify(owner.passwordHash, password).catch(() => false)
    : (await hashPassword(password), false);
  if (!owner || !valid) throw new AppError(401, "Invalid email or password.");
  const raw = token();
  await db.session.create({
    data: {
      id: digest(raw),
      ownerId: owner.id,
      expiresAt: new Date(Date.now() + 12 * 3600_000),
    },
  });
  return raw;
}
export function sessionFromRequest(request: Request) {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1) || ""
  );
}
export async function session(raw: string) {
  if (!raw) return null;
  const row = await db.session.findUnique({
    where: { id: digest(raw) },
    include: { owner: { select: { id: true, email: true } } },
  });
  return row && row.expiresAt > new Date() ? row : null;
}
export async function authorize(request: Request) {
  const raw = sessionFromRequest(request);
  const user = await session(raw);
  if (!user) throw new AppError(401, "Sign in to continue.");
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    assertOrigin(request);
    if (!equal(request.headers.get("x-csrf-token") || "", csrfFor(raw)))
      throw new AppError(403, "CSRF token rejected. Refresh the page.");
  }
  const settings = await db.appSettings.findUnique({
    where: { id: "singleton" },
  });
  await rateLimit(
    `request:${user.ownerId}`,
    settings?.requestLimit || 120,
    60_000,
  );
  return { owner: user.owner, csrf: csrfFor(raw) };
}
