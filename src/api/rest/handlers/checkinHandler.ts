import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../../../infra/prisma";
import { Errors } from "../../common/errors";
import { childLogger } from "../../../infra/logger";
import { captureException } from "../../../infra/sentry";
import {
  CHECKIN_TIME_OPTIONS,
  CHECKIN_TIME_LABELS,
  upsertCheckinReminderDb,
  removeCheckinReminderDb,
  type CheckinTime,
} from "../../../engagement/checkin/handler";

const SetupCheckinSchema = z.object({
  time: z.union([z.enum(CHECKIN_TIME_OPTIONS), z.literal("off")]),
});

export async function handleGetCheckin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "getCheckin" });
  const userId = request.userId!;
  try {
    const reminder = await prisma.userReminder.findFirst({
      where: { userId, isActive: true },
      select: { time: true },
    });
    if (!reminder) {
      reply.code(200).send({ active: false, time: null, label: null });
      return;
    }
    reply.code(200).send({
      active: true,
      time: reminder.time,
      label: CHECKIN_TIME_LABELS[reminder.time as CheckinTime] ?? reminder.time,
    });
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "getCheckin" });
    log.error({ err }, "getCheckin failed");
    reply.code(500).send(Errors.internal());
  }
}

export async function handleSetupCheckin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const log = childLogger({ requestId: request.id, handler: "setupCheckin" });
  const userId = request.userId!;
  try {
    const parsed = SetupCheckinSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send(Errors.validation(parsed.error.issues[0].message));
      return;
    }
    const { time } = parsed.data;

    if (time === "off") {
      await removeCheckinReminderDb(userId);
      log.info({ userId }, "checkin turned off");
      reply.code(200).send({ active: false, time: null, label: null });
    } else {
      await upsertCheckinReminderDb(userId, time as CheckinTime);
      log.info({ userId, time }, "checkin set");
      reply.code(200).send({
        active: true,
        time,
        label: CHECKIN_TIME_LABELS[time as CheckinTime],
      });
    }
  } catch (err) {
    captureException(err, { requestId: request.id, handler: "setupCheckin" });
    log.error({ err }, "setupCheckin failed");
    reply.code(500).send(Errors.internal());
  }
}
