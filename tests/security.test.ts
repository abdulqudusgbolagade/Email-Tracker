import { describe, it, expect } from "vitest";
import { db } from "../src/lib/db";
import {
  encrypt,
  decrypt,
  token,
  csrfFor,
  assertOrigin,
} from "../src/lib/security";
import { authorize, hashPassword, login, session } from "../src/lib/auth";
import { GET, POST } from "../src/app/api/[...path]/route";

describe("owner authentication and authorization", () => {
  it("encrypts credentials with randomized authenticated encryption", () => {
    const a = encrypt("not-a-live-password");
    const b = encrypt("not-a-live-password");
    expect(a).not.toEqual(b);
    expect(a).not.toContain("not-a-live-password");
    expect(decrypt(a)).toBe("not-a-live-password");
    const parts = a.split(".");
    parts[2] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("creates opaque hashed sessions, checks CSRF, revokes and expires access", async () => {
    await db.owner.create({
      data: {
        email: "owner@example.test",
        passwordHash: await hashPassword("fixture-password-123"),
      },
    });
    const raw = await login("owner@example.test", "fixture-password-123");
    const row = await db.session.findFirstOrThrow();
    expect(row.id).not.toBe(raw);
    expect((await session(raw))?.owner.email).toBe("owner@example.test");
    const headers = {
      cookie: `grant_session=${raw}`,
      origin: "http://localhost:3000",
      "x-csrf-token": csrfFor(raw),
    };
    await expect(
      authorize(
        new Request("http://localhost:3000/api/prospects", {
          method: "POST",
          headers,
        }),
      ),
    ).resolves.toHaveProperty("owner");
    await expect(
      authorize(
        new Request("http://localhost:3000/api/prospects", {
          method: "POST",
          headers: { ...headers, "x-csrf-token": "bad" },
        }),
      ),
    ).rejects.toThrow("CSRF");
    await db.session.update({
      where: { id: row.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await session(raw)).toBeNull();
  });
  it("rejects unauthenticated reads, exports and mutations", async () => {
    for (const path of [["data"], ["exports", "prospects"], ["settings"]]) {
      const response = await GET(
        new Request(`http://localhost:3000/api/${path.join("/")}`),
        { params: Promise.resolve({ path }) },
      );
      expect(response.status).toBe(401);
    }
    const result = await POST(
      new Request("http://localhost:3000/api/send", {
        method: "POST",
        body: "{}",
      }),
      { params: Promise.resolve({ path: ["send"] }) },
    );
    expect(result.status).toBe(401);
  });
  it("rejects foreign origins and incorrect passwords", async () => {
    expect(() =>
      assertOrigin(
        new Request("http://localhost:3000/api/send", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toThrow("origin");
    await db.owner.create({
      data: {
        email: "owner@example.test",
        passwordHash: await hashPassword("correct-fixture-123"),
      },
    });
    await expect(login("owner@example.test", "wrong")).rejects.toThrow(
      "Invalid email or password",
    );
  });
  it("throttles repeated login attempts without account enumeration", async () => {
    for (let i = 0; i < 10; i++)
      await expect(login("missing@example.test", "fixture")).rejects.toThrow(
        "Invalid email or password",
      );
    await expect(login("missing@example.test", "fixture")).rejects.toThrow(
      "Too many requests",
    );
  });
  it("rejects expired session tokens and keeps CSRF session-specific", async () => {
    expect(await session(token())).toBeNull();
    expect(csrfFor(token())).not.toBe(csrfFor(token()));
  });
});
