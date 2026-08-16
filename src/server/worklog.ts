// 도메인 서비스 — 슬롯 보장(WS-11), 업로드(DM-05/12, ST-10), 현황(DM-08).
import type { Division, Submission, User, WeekSlot } from '@prisma/client';
import { prisma } from './db';
import { audit } from './audit';
import { logger } from './logger';
import { currentWeek, deadlineFor, isLocked } from '@/lib/week';
import { validateHwpUpload, UploadValidationError } from '@/lib/hwp/reader';
import { env } from './env';
import { HttpError } from './authz';
import { sha256, submissionRelPath, writeFileAtomic } from './storage';

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
  offRoster: Pick<User, 'id' | 'name'>[];
  summary: { roster: number; submitted: number; missing: number };
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

  const members: MemberStatusRow[] = users
    .filter((u) => u.onRoster)
    .map((u) => {
      const list = byUser.get(u.id) ?? [];
      const latest = list.find((s) => s.isLatest) ?? null;
      return {
        user: { id: u.id, name: u.name, sortOrder: u.sortOrder },
        status: latest ? 'submitted' : 'missing',
        latest,
        versionCount: list.length,
      };
    });

  return {
    members,
    offRoster: users.filter((u) => !u.onRoster).map((u) => ({ id: u.id, name: u.name })),
    summary: {
      roster: members.length,
      submitted: members.filter((m) => m.status === 'submitted').length,
      missing: members.filter((m) => m.status === 'missing').length,
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
