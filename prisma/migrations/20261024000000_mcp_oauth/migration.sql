CREATE TABLE "McpOAuthClient" (
  "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL,
  "redirectUris" TEXT NOT NULL, "authMethod" TEXT NOT NULL, "secretHash" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "McpOAuthRequest" (
  "id" TEXT NOT NULL PRIMARY KEY, "clientId" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL, "state" TEXT, "challenge" TEXT NOT NULL,
  "resource" TEXT NOT NULL, "scope" TEXT NOT NULL, "expiresAt" DATETIME NOT NULL,
  "decidedAt" DATETIME, "ownerId" TEXT, "codeHash" TEXT, "codeExpiresAt" DATETIME,
  "consumedAt" DATETIME, "grantId" TEXT,
  CONSTRAINT "McpOAuthRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "McpOAuthClient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "McpOAuthRequest_codeHash_key" ON "McpOAuthRequest"("codeHash");
CREATE INDEX "McpOAuthRequest_expiresAt_idx" ON "McpOAuthRequest"("expiresAt");
CREATE TABLE "McpOAuthGrant" (
  "id" TEXT NOT NULL PRIMARY KEY, "ownerId" TEXT NOT NULL, "clientId" TEXT NOT NULL,
  "resource" TEXT NOT NULL, "scope" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME NOT NULL, "revokedAt" DATETIME,
  CONSTRAINT "McpOAuthGrant_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "McpOAuthGrant_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "McpOAuthClient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "McpOAuthGrant_ownerId_revokedAt_idx" ON "McpOAuthGrant"("ownerId", "revokedAt");
CREATE TABLE "McpOAuthToken" (
  "hash" TEXT NOT NULL PRIMARY KEY, "grantId" TEXT NOT NULL, "kind" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL, "usedAt" DATETIME,
  CONSTRAINT "McpOAuthToken_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "McpOAuthGrant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "McpOAuthToken_expiresAt_idx" ON "McpOAuthToken"("expiresAt");
