// 도메인 서비스 — 슬롯 보장(WS-11), 업로드(DM-05/12, ST-10), 현황(DM-08).
import type { Division, Submission, User, WeekSlot } from '@prisma/client';
import { prisma } from './db';
import { audit } from './audit';
import { logger } from './logger';
import { currentWeek, deadlineFor, isLocked } from '@/lib/week';
import { validateHwpUpload, UploadValidationError } from '@/lib/hwp/reader';
import { env } from './env';
import { HttpError } from './authz';
import { resolveInRoot, sha256, submissionRelPath, writeFileAtomic } from './storage';
import { unlink } from 'node:fs/promises';

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

  // API-11 — 마감은 서버가 최종 판정. 예외 경로 없음
  if (isLocked({ opensAt: slot.opensAt }, division, now)) {
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
    const rel = submissionRelPath(division.slug, slot.year, slot.label, user.name, version);
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

// ── 현황 (DM-08) ────────────────────────────────────────────
export interface MemberStatusRow {
  user: Pick<User, 'id' | 'name' | 'sortOrder'>;
  status: 'submitted' | 'missing';
  latest: Submission | null;
  versionCount: number;
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

  const toRow = (u: (typeof users)[number]): MemberStatusRow => {
    const list = byUser.get(u.id) ?? [];
    return {
      user: { id: u.id, name: u.name, sortOrder: u.sortOrder },
      status: list.some((s) => s.isLatest) ? 'submitted' : 'missing',
      latest: list.find((s) => s.isLatest) ?? null,
      versionCount: list.length,
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

/** 부서 관점 주차 목록 (API-30 상당) */
export async function divisionSlots(divisionId: string, limit = 26) {
  const slots = await prisma.weekSlot.findMany({ orderBy: { opensAt: 'desc' }, take: limit });
  const counts = await prisma.submission.groupBy({
    by: ['weekSlotId'],
    where: { divisionId, isLatest: true, weekSlotId: { in: slots.map((s) => s.id) } },
    _count: { _all: true },
  });
  const roster = await prisma.user.count({ where: { divisionId, isActive: true, onRoster: true } });
  const byId = new Map(counts.map((c) => [c.weekSlotId, c._count._all]));
  return { slots, roster, submittedOf: (slotId: string) => byId.get(slotId) ?? 0 };
}

export function effectiveDeadline(slot: WeekSlot, division: Division): Date {
  return deadlineFor({ opensAt: slot.opensAt }, division);
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
