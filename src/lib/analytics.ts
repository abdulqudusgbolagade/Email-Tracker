import { db } from "./db";
import { appSettings } from "./mailbox";
import { fromZonedTime } from "date-fns-tz";
import { AppError } from "./security";

export async function analytics(params = new URLSearchParams()) {
  const settings = await appSettings();
  function boundary(name: string, end: boolean) {
    const value = params.get(name);
    if (!value) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new AppError(400, "Use YYYY-MM-DD date filters.");
    const date = fromZonedTime(
      `${value}T${end ? "23:59:59.999" : "00:00:00"}`,
      settings.timezone,
    );
    if (!Number.isFinite(date.getTime()))
      throw new AppError(400, "Invalid date filter.");
    return date;
  }
  const gte = boundary("from", false);
  const lte = boundary("to", true);
  if (gte && lte && gte > lte)
    throw new AppError(400, "Start date must precede end date.");
  const campaignId = params.get("campaign") || undefined;
  const service = params.get("service") || undefined;
  const cohort = await db.message.findMany({
    where: {
      direction: "Outbound",
      state: "SMTP Accepted",
      campaignId,
      service,
      receivedAt: { gte, lte },
    },
    select: {
      id: true,
      conversationId: true,
      signalCount: true,
      campaignId: true,
    },
  });
  const ids = cohort.map((x) => x.id);
  const replyRows = await db.message.findMany({
    where: {
      direction: "Inbound",
      qualifiedReply: true,
      replyToMessageId: { in: ids },
    },
    select: { replyToMessageId: true },
  });
  const repliedIds = new Set(replyRows.map((x) => x.replyToMessageId));
  const conversationIds = cohort.map((x) => x.conversationId);
  const prospectFilter = { campaignId, service };
  const [
    signals,
    uniqueSignals,
    receivedReplies,
    awaiting,
    due,
    campaigns,
    interested,
    potential,
    won,
  ] = await Promise.all([
    db.trackingEvent.count({
      where: { occurredAt: { gte, lte }, message: { campaignId, service } },
    }),
    db.trackingEvent.findMany({
      where: { occurredAt: { gte, lte }, message: { campaignId, service } },
      distinct: ["messageId"],
      select: { messageId: true },
    }),
    db.message.count({
      where: {
        direction: "Inbound",
        qualifiedReply: true,
        receivedAt: { gte, lte },
        campaignId,
        service,
      },
    }),
    db.prospect.count({
      where: { ...prospectFilter, status: "Awaiting Reply" },
    }),
    db.followUp.count({
      where: {
        state: "Pending",
        dueAt: { lte: new Date() },
        conversation: { prospect: prospectFilter },
      },
    }),
    db.campaign.count({
      where: {
        active: true,
        ...(campaignId ? { id: campaignId } : {}),
        service,
      },
    }),
    db.prospect.count({ where: { ...prospectFilter, status: "Interested" } }),
    db.prospect.count({
      where: {
        ...prospectFilter,
        status: { in: ["Interested", "Meeting Scheduled", "Proposal Sent"] },
      },
    }),
    db.prospect.count({
      where: {
        ...prospectFilter,
        status: "Won",
        ...(gte || lte ? { wonAt: { gte, lte } } : {}),
      },
    }),
  ]);
  const grouped = new Map<
    string,
    { sent: number; replied: number; signals: number; conversions: number }
  >();
  for (const m of cohort) {
    const key = m.campaignId || "Unassigned";
    const row = grouped.get(key) || {
      sent: 0,
      replied: 0,
      signals: 0,
      conversions: 0,
    };
    row.sent++;
    row.replied += repliedIds.has(m.id) ? 1 : 0;
    row.signals += m.signalCount;
    grouped.set(key, row);
  }
  const conversions = await db.prospect.groupBy({
    by: ["campaignId"],
    where: {
      ...prospectFilter,
      status: "Won",
      ...(gte || lte ? { wonAt: { gte, lte } } : {}),
    },
    _count: true,
  });
  for (const c of conversions) {
    const key = c.campaignId || "Unassigned";
    const row = grouped.get(key) || {
      sent: 0,
      replied: 0,
      signals: 0,
      conversions: 0,
    };
    row.conversions = c._count;
    grouped.set(key, row);
  }
  return {
    sent: cohort.length,
    signals,
    uniqueSignals: uniqueSignals.length,
    replies: receivedReplies,
    replyRate: cohort.length
      ? Math.round((repliedIds.size / cohort.length) * 1000) / 10
      : 0,
    awaiting,
    due,
    activeCampaigns: campaigns,
    interested,
    potential,
    won,
    conversations: new Set(conversationIds).size,
    byCampaign: [...grouped].map(([id, value]) => ({ id, ...value })),
  };
}
