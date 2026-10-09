// 도메인 서비스 — 슬롯 보장(WS-11), 업로드(DM-05/12, ST-10), 현황(DM-08).
import type { Division, Submission, User, WeekSlot } from '@prisma/client';
import { prisma } from './db';
import { audit } from './audit';
import { logger } from './logger';
import { currentWeek, deadlineFor, toKstIso } from '@/lib/week';
import { validateHwpUpload, UploadValidationError } from '@/lib/hwp/reader';
import { env } from './env';
import { HttpError } from './authz';
import { openingOf } from './deadline';
import { isSubmissionLocked } from '@/lib/deadline';
import { resolveInRoot, sha256, submissionRelPath, writeFileAtomic } from './storage';
import { unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/** WS-11 — 크론 없이 지연 생성. upsert라 동시 요청 안전 */
export async function ensureCurrentSlot(now = new Date()): Promise<WeekSlot> {
  const w = currentWeek(now);
  return prisma.weekSlot.upsert({
    where: { isoKey: w.isoKey },
    update: {},
    create: {
      isoKey: w.isoKey,
      label: w.label,
      year: w.year,
      month: w.month,
      weekOfMonth: w.weekOfMonth,
      opensAt: w.opensAt,
    },
  });
}

export interface UploadInput {
  user: User;
  division: Division;
  fileName: string;
  bytes: Buffer;
  fromIp?: string | null;
  /** WA-04 — 웹 작성으로 만들어진 것인지. 처리 경로는 완전히 동일하다 */
  origin?: 'upload' | 'web';
}

export interface UploadResult {
  submission: Submission;
  replacedVersion: number | null;
  sameAsPrevious: boolean;
}

/** API-09~14 — 업로드 전체 절차. 순서: 잠금 → 크기 → 확장자 → 매직·구조 → TX → 파일 */
export async function uploadSubmission(input: UploadInput, now = new Date()): Promise<UploadResult> {
  const { user, division, bytes } = input;

  // DM-16 — 명단(onRoster)은 **집계 대상**이지 제출 권한이 아니다. 여기서 막지 않는다.
  // 병합은 원래 낸 사람 전부를 담고(isLatest 기준), 현황은 명단 밖 제출을
  // '추가 제출'로 따로 보여준다(DM-17). 그래서 유령 제출물이 생기지 않는다.

  const slot = await ensureCurrentSlot(now);

  /*
   * API-11 — 마감은 서버가 최종 판정.
   *
   * DM-20 — 예외는 **하나뿐이다**: 담당자가 그 주차를 잠시 열어 둔 경우.
   * 그때도 내는 사람은 본인이고 시각이 지나면 저절로 닫힌다 — 「예외 없음」이
   * 「담당자가 이름을 걸고 연 30분」으로 바뀐 것이지 사라진 게 아니다.
   */
  const open = await openingOf(division.id, slot.id);
  if (isSubmissionLocked(slot, division, open, now)) {
    await audit(user.email, 'reject', division.id, `slot:${slot.isoKey}`, { reason: 'slot_locked' });
    throw new HttpError(409, 'slot_locked', '마감되어 제출되지 않았습니다. 다음 주차에 제출해 주세요.');
  }

  // ST-04 — 크기
  if (bytes.length > env.MAX_UPLOAD_BYTES) {
    throw new HttpError(422, 'invalid_file', `파일이 너무 큽니다 (최대 ${Math.floor(env.MAX_UPLOAD_BYTES / 1024 / 1024)}MB).`);
  }
  if (bytes.length === 0) {
    throw new HttpError(422, 'invalid_file', '빈 파일입니다.');
  }

  // ST-05 — 확장자 .hwp 전용
  if (!/\.hwp$/i.test(input.fileName)) {
    const isHwpx = /\.hwpx$/i.test(input.fileName);
    throw new HttpError(
      422,
      'invalid_file',
      isHwpx
        ? '.hwpx 형식은 받지 않습니다. 한글에서 [다른 이름으로 저장] → 파일 형식 [한글 문서(*.hwp)]로 저장한 뒤 다시 올려주세요.'
        : '한글(.hwp) 파일만 올릴 수 있습니다.',
    );
  }

  // ST-06/07 — 매직 + 구조 + 표 파싱 (드로어·병합의 전제 보장)
  try {
    validateHwpUpload(bytes);
  } catch (e) {
    if (e instanceof UploadValidationError) throw new HttpError(422, 'invalid_file', e.message);
    throw e;
  }

  const hash = sha256(bytes);

  // DM-05 — 버전 부여·isLatest 전환은 단일 트랜잭션. 유니크 제약이 경합 방어
  const { submission, replacedVersion, sameAsPrevious, relPath } = await prisma.$transaction(async (tx) => {
    const last = await tx.submission.findFirst({
      where: { userId: user.id, weekSlotId: slot.id },
      orderBy: { version: 'desc' },
    });
    await tx.submission.updateMany({
      where: { userId: user.id, weekSlotId: slot.id, isLatest: true },
      data: { isLatest: false },
    });
    const version = (last?.version ?? 0) + 1;
    const rel = submissionRelPath(division.slug, slot.year, slot.label, user, version); // ST-02a — 이름 + 사람 꼬리
    const created = await tx.submission.create({
      data: {
        divisionId: division.id, // DM-12: 서버가 채운다. 요청 값 아님
        userId: user.id,
        weekSlotId: slot.id,
        version,
        isLatest: true,
        filePath: rel,
        originalName: input.fileName,
        byteSize: bytes.length,
        sha256: hash,
        uploadedFrom: input.fromIp ?? null,
        origin: input.origin ?? 'upload',
      },
    });
    return {
      submission: created,
      replacedVersion: last?.version ?? null,
      sameAsPrevious: last?.sha256 === hash,
      relPath: rel,
    };
  });

  // ST-10 — DB 커밋 후 파일 이동 (감지 가능한 실패 방향). 실패 시 치명 로그 → health 정합성에서 발견
  try {
    await writeFileAtomic(relPath, bytes);
  } catch (e) {
    logger.error({ err: String(e), submissionId: submission.id, relPath }, 'CRITICAL: file write failed after DB commit');
    throw new HttpError(500, 'internal', '파일 저장에 실패했습니다. 다시 시도해 주세요.');
  }

  await audit(user.email, 'upload', division.id, `submission:${submission.id}`, {
    slot: slot.isoKey,
    version: submission.version,
    bytes: bytes.length,
  });
  return { submission, replacedVersion, sameAsPrevious };
}

/**
 * TACP-22 · WA-20 — 담당자가 부서원 제출물을 **새 판으로** 고친다.
 *
 * 업로드와 같은 트랜잭션 규칙(DM-05: 버전 부여·isLatest 전환을 한 번에)을 쓰되,
 * 주인은 **그 부서원**, 주차는 **고친 제출물의 주차**다(지난 주차를 고칠 수도 있다).
 * 마감은 보지 않는다 — 게이트(`requireRevisableSubmission`)가 이미 판정했다.
 *
 * **파일을 먼저 쓰고 DB를 커밋한다** (업로드 ST-10과 반대 순서). 커밋 뒤에 쓰기가 실패하면
 * 그 사람의 **최신 판이 파일 없는 판**이 된다 — 원래 판은 isLatest를 잃었고, 받기·병합이 500으로 터진다.
 * 업로드는 본인이 곧 다시 올리지만, 첨삭은 남의 판을 내려 버린다. 남아도 되는 쪽은
 * 「참조 없는 파일」이지 「파일 없는 레코드」가 아니다 (`deleteSubmission`과 같은 원칙).
 * 경로에 고유 꼬리를 붙여 동시 요청이 서로의 파일을 덮거나 지우지 않게 한다.
 */
export async function reviseSubmission(input: {
  editor: Pick<User, 'id' | 'email' | 'name'>;
  target: Submission & { user: User; weekSlot: WeekSlot; division: Division };
  bytes: Buffer;
  fileName: string;
}, now = new Date()): Promise<Submission> {
  const { editor, target, bytes } = input;
  try {
    validateHwpUpload(bytes);
  } catch (e) {
    if (e instanceof UploadValidationError) throw new HttpError(422, 'invalid_file', e.message);
    throw e;
  }
  const hash = sha256(bytes);
  // 게이트가 최신 판임을 확인했다 → 새 판은 target.version + 1. 트랜잭션 안에서 다시 확인한다
  const version = target.version + 1;
  const rel = submissionRelPath(
    target.division.slug,
    target.weekSlot.year,
    target.weekSlot.label,
    target.user, // ST-02a — 주인(그 부서원)의 꼬리. 고친 사람이 아니다
    version,
    `e${randomUUID().slice(0, 8)}`,
  );
  try {
    await writeFileAtomic(rel, bytes);
  } catch (e) {
    logger.error({ err: String(e), target: target.id, relPath: rel }, 'revise: file write failed before DB commit');
    throw new HttpError(500, 'internal', '파일 저장에 실패했습니다. 다시 시도해 주세요.');
  }

  let created: Submission;
  try {
    created = await prisma.$transaction(async (tx) => {
      const last = await tx.submission.findFirst({
        where: { userId: target.userId, weekSlotId: target.weekSlotId },
        orderBy: { version: 'desc' },
      });
      // 게이트를 지난 뒤 그 사람이 새로 냈거나(다른 판) 지웠다면(없음) — 우리가 고친 것이 그 사이의 일을 덮으면 안 된다
      if (!last || last.id !== target.id) {
        throw new HttpError(409, 'not_latest', '그 사이 새 판이 올라왔습니다. 다시 열어 최신 판을 고쳐 주세요.');
      }
      await tx.submission.updateMany({
        where: { userId: target.userId, weekSlotId: target.weekSlotId, isLatest: true },
        data: { isLatest: false },
      });
      return tx.submission.create({
        data: {
          divisionId: target.divisionId, // DM-12 — 그 제출물의 부서 그대로
          userId: target.userId, // 주인은 그 부서원이다
          weekSlotId: target.weekSlotId,
          version,
          isLatest: true,
          filePath: rel,
          originalName: input.fileName,
          byteSize: bytes.length,
          sha256: hash,
          origin: 'lead_edit',
          // 「언제 냈나」는 그 사람이 낸 시각 그대로 — 고친 시각이 제출 시각으로 보이면 늦게 낸 사람이 된다
          uploadedAt: target.uploadedAt,
          editedById: editor.id, // 누가 손댔나
          editedAt: now, // 언제 손댔나
        },
      });
    });
  } catch (e) {
    // 커밋되지 않았다 — 먼저 쓴 파일은 아무도 가리키지 않는다. 지운다 (실패해도 고아 파일일 뿐이다)
    await unlink(resolveInRoot(rel)).catch(() => undefined);
    throw e;
  }
  await audit(editor.email, 'submission_revise', target.divisionId, `submission:${created.id}`, {
    owner: target.user.name,
    slot: target.weekSlot.isoKey,
    from: target.version,
    to: created.version,
  });
  return created;
}

// ── 현황 (DM-08) ────────────────────────────────────────────
export interface MemberStatusRow {
  user: Pick<User, 'id' | 'name' | 'sortOrder'>;
  status: 'submitted' | 'missing';
  latest: Submission | null;
  versionCount: number;
  /** NT-31 — 이 주차에 마감 알림을 받았는가 (받은 시각 KST "13:00"). 안 받았으면 null */
  notifiedAtKst: string | null;
}

export async function divisionStatus(divisionId: string, slotId: string): Promise<{
  members: MemberStatusRow[];
  /** DM-17 — 명단 밖인데 **낸 사람**. 분모에는 안 들어가지만 묻히면 안 된다 */
  extras: MemberStatusRow[];
  offRoster: { id: string; name: string; note: string | null }[];
  summary: { roster: number; submitted: number; missing: number; extras: number };
}> {
  const users = await prisma.user.findMany({
    where: { divisionId, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], // API-21
  });
  const subs = await prisma.submission.findMany({
    where: { divisionId, weekSlotId: slotId }, // 격리 축: divisionId 첫 조건 (DM-12)
    orderBy: { version: 'desc' },
  });
  const byUser = new Map<string, Submission[]>();
  for (const s of subs) {
    const arr = byUser.get(s.userId) ?? [];
    arr.push(s);
    byUser.set(s.userId, arr);
  }

  /*
   * NT-31 — 알림을 받은 사람. 담당자가 «독촉했는데도 안 냈나, 아직 안 알렸나»를
   * 구분할 수 있어야 다음 행동이 정해진다. 발송 기록은 사번 목록으로 남으므로
   * 사번 → 사용자로 되짚는다.
   */
  const notified = new Map<string, string>();
  // NT-31 — 「알림 받음」은 **마감 재촉 알림**만 센다. 승인 알림(NT-46)·병합 안내·3단계 알림까지 세면
  // 그것을 받은 담당자가 「재촉받은 사람」으로 보인다 (2026-10-07 리뷰).
  // `deadline_day`(당일 아침, NT-45)는 2026-10-08에 걷었지만 지난 주차에는 그 기록이 있다 — 그 주를 열면 여전히 센다
  const logs = await prisma.notifyLog.findMany({
    where: { divisionId, weekSlotId: slotId, kind: { in: ['deadline_1d', 'deadline_day', 'deadline_1h', 'deadline_10m'] } },
  });
  if (logs.length > 0) {
    const byEmpNo = new Map(users.filter((u) => u.employeeNo).map((u) => [u.employeeNo!, u.id]));
    for (const log of logs) {
      const at = toKstIso(log.sentAt).slice(11, 16);
      for (const empNo of JSON.parse(log.recipients) as string[]) {
        const uid = byEmpNo.get(empNo);
        if (uid) notified.set(uid, at);
      }
    }
  }

  const toRow = (u: (typeof users)[number]): MemberStatusRow => {
    const list = byUser.get(u.id) ?? [];
    return {
      user: { id: u.id, name: u.name, sortOrder: u.sortOrder },
      status: list.some((s) => s.isLatest) ? 'submitted' : 'missing',
      latest: list.find((s) => s.isLatest) ?? null,
      versionCount: list.length,
      notifiedAtKst: notified.get(u.id) ?? null,
    };
  };

  const members = users.filter((u) => u.onRoster).map(toRow);
  // 명단 밖이어도 **낸 사람은 보여준다** (DM-17). 안 낸 사람은 원래 기대치가 없으니 조용히 둔다
  const extras = users.filter((u) => !u.onRoster && byUser.has(u.id)).map(toRow);

  return {
    members,
    extras,
    offRoster: users
      .filter((u) => !u.onRoster)
      .map((u) => ({ id: u.id, name: u.name, note: u.rosterNote })),
    summary: {
      roster: members.length,
      submitted: members.filter((m) => m.status === 'submitted').length,
      missing: members.filter((m) => m.status === 'missing').length,
      extras: extras.length,
    },
  };
}

/**
 * PG-72 — 수합 관리의 주차 목록. **근거 있는 주만, 상한 없이.**
 *
 *   들어가는 주: (이 부서에 제출이 있는 주 ∪ 성공 병합본이 있는 주) ∪ 이번 주 ∪ 지금 보는 주. 최신이 위
 *   수: 분자는 명단 안(onRoster ∧ isActive) 사람의 최신 제출, 분모는 지금 명단 수 — 제출 현황(PG-18)과 같은 기준
 *
 * 예전(`divisionSlots`)은 서버의 최근 26주를 그대로 늘어놓고 명단 밖 제출까지 세서, 쓰지 않은 주가 끼고
 * 「12/11」이 나왔으며 반년이 지나면 옛 주가 목록에서 소리 없이 빠졌다.
 */
export async function divisionWeeks(divisionId: string, viewingSlotId?: string, now = new Date()) {
  const current = currentWeek(now);
  const [slots, any, counted, merged, roster] = await Promise.all([
    prisma.weekSlot.findMany({ where: { opensAt: { lte: current.opensAt } }, orderBy: { opensAt: 'desc' } }),
    prisma.submission.groupBy({ by: ['weekSlotId'], where: { divisionId, isLatest: true } }),
    prisma.submission.groupBy({
      by: ['weekSlotId'],
      where: { divisionId, isLatest: true, user: { onRoster: true, isActive: true } },
      _count: { _all: true },
    }),
    prisma.mergeRun.groupBy({ by: ['weekSlotId'], where: { divisionId, status: 'succeeded', outputPath: { not: null } } }),
    prisma.user.count({ where: { divisionId, isActive: true, onRoster: true } }),
  ]);
  const evidence = new Set([...any.map((r) => r.weekSlotId), ...merged.map((r) => r.weekSlotId)]);
  const byId = new Map(counted.map((c) => [c.weekSlotId, c._count._all]));
  return {
    slots: slots.filter((s) => evidence.has(s.id) || s.isoKey === current.isoKey || s.id === viewingSlotId),
    roster,
    submittedOf: (slotId: string) => byId.get(slotId) ?? 0,
  };
}

export function effectiveDeadline(slot: WeekSlot, division: Division): Date {
  // WS-18 — 슬롯을 **통째로** 넘긴다. `{ opensAt }`으로 깎으면 그 주차의 마감 예외가 사라진다
  return deadlineFor(slot, division);
}

// ── 제출 취소 (ST-30~33 · TACP-14 · ADR-0007) ────────────────
export interface DeleteResult {
  removedVersions: number;
  slotLabel: string;
  ownerName: string;
}

/**
 * ST-30 — 그 사람의 **그 주차 제출물 전체**를 지운다. 부분 삭제는 없다 (ADR-0007).
 *
 * 권한 판정은 이 함수가 하지 않는다 — `requireDeletableSubmission`이 이미 끝냈고,
 * 판정이 두 곳에 있으면 갈라진다 (TACP-12). 여기는 **실행만** 한다.
 *
 * 순서가 업로드와 반대다. 업로드는 DB 커밋 후 파일을 쓰지만(ST-10),
 * 삭제는 **DB를 먼저 지우고 파일을 지운다.** 어느 쪽이든 중간에 죽을 수 있는데,
 * 남아도 되는 쪽은 "참조 없는 파일"이지 "파일 없는 레코드"가 아니다.
 * 전자는 디스크만 먹지만 후자는 받기·병합이 500으로 터진다.
 */
export async function deleteSubmission(
  sub: Submission & { user: User; weekSlot: WeekSlot; division: Division },
  actorEmail: string,
): Promise<DeleteResult> {
  const siblings = await prisma.submission.findMany({
    where: { userId: sub.userId, weekSlotId: sub.weekSlotId },
    orderBy: { version: 'asc' },
  });

  // 감사 로그는 파일이 사라지기 **전에** 내용을 붙잡아 둔다.
  // 복구는 못 해도 "무엇이 있었는지"는 남는다 (ADR-0007에서 치르기로 한 대가)
  await audit(actorEmail, 'delete', sub.divisionId, `submission:${sub.id}`, {
    slot: sub.weekSlot.isoKey,
    owner: sub.user.email,
    versions: siblings.map((s) => ({
      version: s.version,
      originalName: s.originalName,
      byteSize: s.byteSize,
      sha256: s.sha256,
    })),
    bySelf: actorEmail === sub.user.email, // 본인 취소인지 운영자 삭제인지
  });

  await prisma.submission.deleteMany({
    where: { userId: sub.userId, weekSlotId: sub.weekSlotId },
  });

  for (const s of siblings) {
    /*
     * ST-34 (2026-10-10) — **그 제출물만 가리키는 파일만** 지운다. 꼬리(ST-02a) 전의 경로는 이름만이라, 같은 부서의 동명이인이
     * 같은 주에 내면 두 행이 한 파일을 가리켰다. 그때 한 사람이 취소하면 다른 사람의 파일이 지워졌다 — 남은 행이 가리키면 둔다.
     */
    if ((await prisma.submission.count({ where: { filePath: s.filePath } })) > 0) {
      logger.warn({ submissionId: s.id, relPath: s.filePath }, 'delete: 다른 제출물이 같은 파일을 가리켜 파일은 남긴다 (ST-34)');
      continue;
    }
    try {
      await unlink(resolveInRoot(s.filePath));
    } catch (e) {
      // 파일이 이미 없어도 삭제는 성공이다 — 목표 상태(없음)에 도달했다
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        logger.error({ err: String(e), submissionId: s.id, relPath: s.filePath }, 'orphan file after delete');
      }
    }
  }

  return {
    removedVersions: siblings.length,
    slotLabel: sub.weekSlot.label,
    ownerName: sub.user.name,
  };
}
