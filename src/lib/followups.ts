import { addDays, format } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { db } from "./db";
import { appSettings } from "./mailbox";

export function nextDue(base: Date, days: number, timezone: string) {
  const local = toZonedTime(base, timezone);
  const target = format(addDays(local, days), "yyyy-MM-dd");
  return fromZonedTime(`${target}T09:00:00`, timezone);
}
export async function scheduleFollowup(
  conversationId: string,
  acceptedAt = new Date(),
  sourceMessageId?: string,
) {
  const settings = await appSettings();
  const intervals = settings.intervals.split(",").map(Number);
  await db.$transaction(async (tx) => {
    if (sourceMessageId) {
      const claim = await tx.message.updateMany({
        where: { id: sourceMessageId, followupScheduled: false },
        data: { followupScheduled: true },
      });
      if (!claim.count) return;
    }
    const conversation = await tx.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: { prospect: true },
    });
    const replied = await tx.message.count({
      where: {
        conversationId,
        qualifiedReply: true,
        receivedAt: { gte: acceptedAt },
      },
    });
    if (
      ["Do Not Contact", "Not Interested", "Lost", "Won"].includes(
        conversation.prospect.status,
      ) ||
      (await tx.suppression.findUnique({
        where: { email: conversation.prospect.email },
      })) ||
      (replied > 0 && !settings.keepReminders)
    )
      return;
    const previous = await tx.followUp.findFirst({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
    });
    const step = previous ? previous.step + 1 : 0;
    await tx.followUp.updateMany({
      where: { conversationId, state: "Pending" },
      data: { state: "Completed" },
    });
    const convo = await tx.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    if (step >= intervals.length) {
      await tx.prospect.update({
        where: { id: convo.prospectId },
        data: { followUpDate: null },
      });
      return;
    }
    const dueAt = nextDue(acceptedAt, intervals[step], settings.timezone);
    await tx.followUp.create({ data: { conversationId, step, dueAt } });
    await tx.prospect.update({
      where: { id: convo.prospectId },
      data: { followUpDate: dueAt },
    });
  });
}
