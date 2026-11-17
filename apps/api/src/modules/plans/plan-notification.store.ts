import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@ascenda/db';
import type { PlanPriceNotice } from './plan-price.domain';
import { getRequestContext } from '../../common/context/request-context';

export type PlanStoreClient = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;
export interface PlanNoticeEvent {
  id: string;
  actorId: string;
  planId: string;
  notificationPayload: PlanPriceNotice;
  audienceOrganisationIds: string[];
  fanoutCursor: number;
}
export interface ClaimedPlanEmail {
  id: string;
  organisationId: string;
  recipientUserId: string;
  payload: PlanPriceNotice;
  attempts: number;
}

/** Parameterised SQL lets the additive outbox deploy without replacing a live Windows Prisma engine. */
@Injectable()
export class PlanNotificationStore {
  audience(tx: PlanStoreClient, planId: string) {
    return tx.$queryRaw<
      { organisationId: string }[]
    >`SELECT * FROM plan_price_notice_audience(${planId})`;
  }

  async append(
    tx: PlanStoreClient,
    input: {
      actorId: string;
      planId: string;
      action: string;
      details: Record<string, unknown>;
      notice?: PlanPriceNotice | null;
      audience?: string[];
    },
  ) {
    const id = randomUUID();
    const audience = input.audience ?? [];
    const ctx = getRequestContext();
    const details = {
      ...input.details,
      requestId: ctx?.requestId ?? null,
      ipAddress: ctx?.ipAddress ?? null,
      userAgent: ctx?.userAgent ?? null,
    };
    await tx.$executeRaw`INSERT INTO platform_plan_events
      (id,"actorId","planId",action,details,"notificationPayload","audienceOrganisationIds","fanoutCompletedAt")
      VALUES (${id},${input.actorId},${input.planId},${input.action},${JSON.stringify(details)}::jsonb,
        ${input.notice ? JSON.stringify(input.notice) : null}::jsonb,${audience}::text[],${input.notice && audience.length ? null : new Date()})`;
    return { id, organisationCount: audience.length };
  }

  pending(system: PlanStoreClient) {
    return system.$queryRaw<
      PlanNoticeEvent[]
    >`SELECT id,"actorId","planId","notificationPayload","audienceOrganisationIds","fanoutCursor"
      FROM platform_plan_events WHERE "fanoutCompletedAt" IS NULL ORDER BY "createdAt",id LIMIT 5`;
  }

  advance(system: PlanStoreClient, event: PlanNoticeEvent, cursor: number, skipped: number) {
    return system.$executeRaw`UPDATE platform_plan_events SET "fanoutCursor"=${cursor},"fanoutSkipped"="fanoutSkipped"+${skipped},
      "fanoutCompletedAt"=${cursor >= event.audienceOrganisationIds.length ? new Date() : null}
      WHERE id=${event.id} AND "fanoutCursor"=${event.fanoutCursor}`;
  }

  enqueue(tx: PlanStoreClient, event: PlanNoticeEvent, organisationId: string, userId: string) {
    return tx.$executeRaw`INSERT INTO plan_price_emails (id,"eventId","organisationId","recipientUserId",payload)
      VALUES (${randomUUID()},${event.id},${organisationId},${userId},${JSON.stringify(event.notificationPayload)}::jsonb)
      ON CONFLICT ("eventId","organisationId","recipientUserId") DO NOTHING`;
  }

  claim(tx: PlanStoreClient, organisationId: string, token: string) {
    return tx.$queryRaw<ClaimedPlanEmail[]>`WITH due AS (
      SELECT q.id FROM plan_price_emails q WHERE q."organisationId"=${organisationId} AND q."nextAttemptAt" <= now()
        AND (q.status='PENDING' OR (q.status='SENDING' AND q."claimedAt" < now()-interval '15 minutes'))
        AND NOT EXISTS (SELECT 1 FROM plan_price_emails older WHERE older."organisationId"=q."organisationId"
          AND older."recipientUserId"=q."recipientUserId" AND older.payload->>'planId'=q.payload->>'planId'
          AND older.status IN ('PENDING','SENDING') AND (older."createdAt",older.id)<(q."createdAt",q.id))
      ORDER BY q."createdAt",q.id LIMIT 10 FOR UPDATE SKIP LOCKED
    ) UPDATE plan_price_emails q SET status='SENDING',"claimedAt"=now(),"claimToken"=${token},attempts=attempts+1,"updatedAt"=now()
      FROM due WHERE q.id=due.id RETURNING q.id,q."organisationId",q."recipientUserId",q.payload,q.attempts`;
  }

  finish(
    tx: PlanStoreClient,
    row: ClaimedPlanEmail,
    token: string,
    status: 'SENT' | 'SKIPPED' | 'PENDING',
    nextAttempt: Date,
  ) {
    return tx.$executeRaw`UPDATE plan_price_emails SET status=${status},"sentAt"=${status === 'SENT' ? new Date() : null},
      "nextAttemptAt"=${nextAttempt},"lastErrorCode"=${status === 'PENDING' ? 'EMAIL_NOT_ACCEPTED' : null},
      "claimToken"=NULL,"claimedAt"=NULL,"updatedAt"=now()
      WHERE id=${row.id} AND "organisationId"=${row.organisationId} AND status='SENDING' AND "claimToken"=${token}`;
  }

  async history(tx: PlanStoreClient, page: number, pageSize: number) {
    const rows = await tx.$queryRaw<
      Record<string, unknown>[]
    >`SELECT id,"planId",action,details,"createdAt",
      cardinality("audienceOrganisationIds") AS "organisationCount","fanoutCursor","fanoutSkipped","fanoutCompletedAt"
      FROM platform_plan_events ORDER BY "createdAt" DESC,id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
    const [count] = await tx.$queryRaw<
      { total: bigint }[]
    >`SELECT COUNT(*) AS total FROM platform_plan_events`;
    return { data: rows, meta: { page, pageSize, total: Number(count?.total ?? 0) } };
  }
}
