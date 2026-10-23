import { db } from "./db";
import { analytics } from "./analytics";
import { appSettings } from "./mailbox";
import { trackingConfigured } from "./tracking";
import { AppError } from "./security";

export async function snapshot(params = new URLSearchParams()) {
  const settings = await appSettings();
  const { encryptedPassword: _password, ...publicSettings } = settings;
  void _password;
  const page = Math.max(1, Math.min(100000, Number(params.get("page")) || 1));
  const search = (params.get("q") || "").slice(0, 200);
  const prospectWhere = {
    ...(params.get("campaign") ? { campaignId: params.get("campaign")! } : {}),
    ...(params.get("service") ? { service: params.get("service")! } : {}),
    ...(search
      ? {
          OR: [
            { fullName: { contains: search } },
            { email: { contains: search } },
            { bookTitle: { contains: search } },
          ],
        }
      : {}),
  };
  const [
    prospects,
    prospectCount,
    campaigns,
    messages,
    followups,
    drafts,
    jobs,
    checkpoints,
    audit,
    metrics,
  ] = await Promise.all([
    db.prospect.findMany({
      where: prospectWhere,
      orderBy: { updatedAt: "desc" },
      take: 100,
      skip: (page - 1) * 100,
      include: { campaign: true },
    }),
    db.prospect.count({ where: prospectWhere }),
    db.campaign.findMany({ orderBy: { createdAt: "desc" } }),
    db.message.findMany({
      where: {
        direction: params.get("view") === "inbox" ? "Inbound" : "Outbound",
        ...(params.get("campaign")
          ? { campaignId: params.get("campaign")! }
          : {}),
        ...(params.get("service") ? { service: params.get("service")! } : {}),
      },
      orderBy: { receivedAt: "desc" },
      take: 100,
      select: {
        id: true,
        conversationId: true,
        direction: true,
        messageId: true,
        subject: true,
        from: true,
        to: true,
        state: true,
        delivery: true,
        receivedAt: true,
        signalCount: true,
        firstSignal: true,
        latestSignal: true,
        qualifiedReply: true,
        bounce: true,
        automated: true,
        sentCopySaved: true,
        sentCopyState: true,
        campaignId: true,
        service: true,
        trackingHash: true,
        conversation: {
          select: {
            prospect: { select: { id: true, fullName: true, email: true } },
          },
        },
        attempts: { select: { id: true, state: true, error: true } },
      },
    }),
    db.followUp.findMany({
      where: { state: "Pending", conversation: { prospect: prospectWhere } },
      orderBy: { dueAt: "asc" },
      take: 200,
      include: { conversation: { include: { prospect: true } } },
    }),
    db.draft.findMany({
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { prospect: { select: { fullName: true, email: true } } },
    }),
    db.jobState.findMany(),
    db.syncCheckpoint.findMany(),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    analytics(params),
  ]);
  const focusDraft = params.get("draft");
  if (focusDraft && !drafts.some((d) => d.id === focusDraft)) {
    const draft = await db.draft.findUnique({
      where: { id: focusDraft },
      include: { prospect: { select: { fullName: true, email: true } } },
    });
    if (!draft) throw new AppError(404, "Draft not found.");
    drafts.push(draft);
  }
  const focus =
    params.get("focus") || drafts.find((d) => d.id === focusDraft)?.prospectId;
  if (focus && !prospects.some((p) => p.id === focus)) {
    const prospect = await db.prospect.findUnique({
      where: { id: focus },
      include: { campaign: true },
    });
    if (prospect) prospects.push(prospect);
  }
  return {
    serverTime: new Date(),
    settings: publicSettings,
    mailboxConfigured: Boolean(
      process.env.MAILBOX_PASSWORD || settings.encryptedPassword,
    ),
    environmentMailbox: Boolean(process.env.MAILBOX_PASSWORD),
    trackingConfigured: trackingConfigured(),
    prospects,
    prospectCount,
    page,
    campaigns,
    messages,
    followups,
    drafts,
    jobs,
    checkpoints,
    audit,
    metrics,
  };
}
type Serialized<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;
export type Snapshot = Serialized<Awaited<ReturnType<typeof snapshot>>>;
export async function prospectHistory(id: string) {
  const prospect = await db.prospect.findUniqueOrThrow({ where: { id } });
  const conversations = await db.conversation.findMany({
    where: { prospectId: id },
    orderBy: { createdAt: "desc" },
    include: {
      messages: {
        orderBy: { receivedAt: "asc" },
        select: {
          id: true,
          direction: true,
          subject: true,
          html: true,
          text: true,
          state: true,
          messageId: true,
          inReplyTo: true,
          references: true,
          receivedAt: true,
          automated: true,
          bounce: true,
          signalCount: true,
          firstSignal: true,
          latestSignal: true,
          trackingHash: true,
          events: { orderBy: { occurredAt: "desc" }, take: 100 },
        },
      },
      followups: true,
    },
  });
  const messageIds = conversations.flatMap((c) => c.messages.map((m) => m.id));
  const attempts = await db.sendAttempt.findMany({
    where: { messageId: { in: messageIds } },
    select: { id: true },
  });
  const entityIds = [
    id,
    ...conversations.map((c) => c.id),
    ...messageIds,
    ...attempts.map((a) => a.id),
    ...conversations.flatMap((c) => c.followups.map((f) => f.id)),
  ];
  const activity = await db.auditLog.findMany({
    where: { entityId: { in: entityIds } },
    orderBy: { createdAt: "desc" },
  });
  return { prospect, conversations, activity };
}
export type History = Serialized<Awaited<ReturnType<typeof prospectHistory>>>;
