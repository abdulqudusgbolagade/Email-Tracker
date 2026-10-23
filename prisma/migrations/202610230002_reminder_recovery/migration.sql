-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN "wonAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "inReplyTo" TEXT,
    "references" TEXT NOT NULL DEFAULT '[]',
    "subject" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "rawMime" BLOB,
    "state" TEXT NOT NULL,
    "delivery" TEXT NOT NULL DEFAULT 'Unconfirmed',
    "campaignId" TEXT,
    "service" TEXT NOT NULL,
    "trackingHash" TEXT,
    "trackingExpiresAt" DATETIME,
    "firstSignal" DATETIME,
    "latestSignal" DATETIME,
    "signalCount" INTEGER NOT NULL DEFAULT 0,
    "qualifiedReply" BOOLEAN NOT NULL DEFAULT false,
    "followupScheduled" BOOLEAN NOT NULL DEFAULT false,
    "replyToMessageId" TEXT,
    "sentCopySaved" BOOLEAN NOT NULL DEFAULT false,
    "sentCopyState" TEXT NOT NULL DEFAULT 'Pending',
    "automated" BOOLEAN NOT NULL DEFAULT false,
    "bounce" BOOLEAN NOT NULL DEFAULT false,
    "uid" INTEGER,
    "uidValidity" TEXT,
    "folder" TEXT,
    "mailbox" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Message" ("automated", "bounce", "campaignId", "conversationId", "createdAt", "delivery", "direction", "firstSignal", "folder", "from", "html", "id", "inReplyTo", "latestSignal", "mailbox", "messageId", "qualifiedReply", "rawMime", "receivedAt", "references", "replyToMessageId", "sentCopySaved", "sentCopyState", "service", "signalCount", "state", "subject", "text", "to", "trackingExpiresAt", "trackingHash", "uid", "uidValidity") SELECT "automated", "bounce", "campaignId", "conversationId", "createdAt", "delivery", "direction", "firstSignal", "folder", "from", "html", "id", "inReplyTo", "latestSignal", "mailbox", "messageId", "qualifiedReply", "rawMime", "receivedAt", "references", "replyToMessageId", "sentCopySaved", "sentCopyState", "service", "signalCount", "state", "subject", "text", "to", "trackingExpiresAt", "trackingHash", "uid", "uidValidity" FROM "Message";
DROP TABLE "Message";
ALTER TABLE "new_Message" RENAME TO "Message";
CREATE UNIQUE INDEX "Message_trackingHash_key" ON "Message"("trackingHash");
CREATE INDEX "Message_messageId_idx" ON "Message"("messageId");
CREATE INDEX "Message_campaignId_service_receivedAt_idx" ON "Message"("campaignId", "service", "receivedAt");
CREATE UNIQUE INDEX "Message_mailbox_folder_uidValidity_uid_key" ON "Message"("mailbox", "folder", "uidValidity", "uid");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


-- Enforce one active reminder per conversation across processes.
CREATE UNIQUE INDEX "FollowUp_one_pending" ON "FollowUp"("conversationId") WHERE "state" = 'Pending';
