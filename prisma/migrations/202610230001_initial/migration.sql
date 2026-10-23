-- CreateTable
CREATE TABLE "Owner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "Session_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "signature" TEXT NOT NULL DEFAULT 'Grant Publishing Co.',
    "intervals" TEXT NOT NULL DEFAULT '4,7,10',
    "keepReminders" BOOLEAN NOT NULL DEFAULT false,
    "outreachEnabled" BOOLEAN NOT NULL DEFAULT false,
    "testRecipients" TEXT NOT NULL DEFAULT '',
    "hourlyLimit" INTEGER NOT NULL DEFAULT 20,
    "dailyLimit" INTEGER NOT NULL DEFAULT 100,
    "requestLimit" INTEGER NOT NULL DEFAULT 120,
    "fromName" TEXT NOT NULL DEFAULT 'Grant Publishing Co.',
    "mailboxUser" TEXT NOT NULL DEFAULT 'support@grantpublishingco.com',
    "encryptedPassword" TEXT,
    "smtpHost" TEXT NOT NULL DEFAULT 'smtp.hostinger.com',
    "smtpPort" INTEGER NOT NULL DEFAULT 465,
    "smtpSecurity" TEXT NOT NULL DEFAULT 'TLS',
    "imapHost" TEXT NOT NULL DEFAULT 'imap.hostinger.com',
    "imapPort" INTEGER NOT NULL DEFAULT 993,
    "sentFolder" TEXT,
    "lastSmtpTest" DATETIME,
    "lastImapTest" DATETIME
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "trackingDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Prospect" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "website" TEXT NOT NULL DEFAULT '',
    "bookTitle" TEXT NOT NULL DEFAULT '',
    "bookGenre" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "publishingPlatform" TEXT NOT NULL DEFAULT '',
    "service" TEXT NOT NULL DEFAULT 'Book Publicity',
    "leadSource" TEXT NOT NULL DEFAULT '',
    "campaignId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'New',
    "notes" TEXT NOT NULL DEFAULT '',
    "lastContacted" DATETIME,
    "lastReply" DATETIME,
    "followUpDate" DATETIME,
    "optoutHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Prospect_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prospectId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Conversation_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prospectId" TEXT NOT NULL,
    "conversationId" TEXT,
    "campaignId" TEXT,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "tracking" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Draft_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
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

-- CreateTable
CREATE TABLE "SendAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "idempotencyKey" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "messageId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'Queued',
    "error" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SendAttempt_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SendAttempt_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 0,
    "dueAt" DATETIME NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'Pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FollowUp_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Suppression" (
    "email" TEXT NOT NULL PRIMARY KEY,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TrackingEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "category" TEXT NOT NULL,
    CONSTRAINT "TrackingEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RemoteToken" (
    "hash" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "prospectId" TEXT,
    "messageId" TEXT,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncCheckpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "uidValidity" TEXT,
    "lastUid" INTEGER NOT NULL DEFAULT 0,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "JobState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner" TEXT,
    "leaseUntil" DATETIME,
    "requested" BOOLEAN NOT NULL DEFAULT false,
    "heartbeat" DATETIME,
    "lastRun" DATETIME,
    "error" TEXT
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "entityId" TEXT,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL DEFAULT 1,
    "resetAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Owner_email_key" ON "Owner"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_email_key" ON "Prospect"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_optoutHash_key" ON "Prospect"("optoutHash");

-- CreateIndex
CREATE UNIQUE INDEX "Message_trackingHash_key" ON "Message"("trackingHash");

-- CreateIndex
CREATE INDEX "Message_messageId_idx" ON "Message"("messageId");

-- CreateIndex
CREATE INDEX "Message_campaignId_service_receivedAt_idx" ON "Message"("campaignId", "service", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_mailbox_folder_uidValidity_uid_key" ON "Message"("mailbox", "folder", "uidValidity", "uid");

-- CreateIndex
CREATE UNIQUE INDEX "SendAttempt_idempotencyKey_key" ON "SendAttempt"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SendAttempt_messageId_key" ON "SendAttempt"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "SendAttempt_draftId_revision_key" ON "SendAttempt"("draftId", "revision");

-- CreateIndex
CREATE INDEX "FollowUp_state_dueAt_idx" ON "FollowUp"("state", "dueAt");

-- CreateIndex
CREATE INDEX "TrackingEvent_occurredAt_idx" ON "TrackingEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

