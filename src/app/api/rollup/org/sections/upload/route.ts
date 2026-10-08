// RU-60 — 총괄이 취합게시판으로 받은 섹션 파일을 올린다 / 취소한다 (총괄·운영자 — TACP-21).
// 남의 부서를 「대신 제출」하는 것이 아니다 — 게시판으로 이미 받은 파일을 전사 조립의 입력으로 놓는 것이다.
//
// 올리기(POST)는 hwp 스위치(WA-30)를 따른다 — 웹만 받는 서버에서는 410. 문 순서: 취합의 문(밖이면 404, 존재 은닉)
// → 스위치 → 파일 읽기. 취소(DELETE)와 받기(`[id]` GET)는 스위치와 상관없다 — 이미 올라온 것을 치우고 꺼내는 일이다.
import { NextRequest } from 'next/server';
import { requireOrgRollup, HttpError } from '@/server/authz';
import { handler, json, rateLimit } from '@/server/http';
import { env } from '@/server/env';
import { assertHwpUploadOpen } from '@/server/submit-mode';
import { rollupSlot } from '@/server/rollup/slot';
import { uploadSectionFile, withdrawSectionFile } from '@/server/rollup/sections';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: NextRequest) => {
  const scope = await requireOrgRollup(req.headers);
  assertHwpUploadOpen();
  rateLimit(`org-upload:${scope.user.email}`, 40, 60_000);
  const fd = await req.formData().catch(() => null);
  const file = fd?.get('file');
  const sectionId = String(fd?.get('sectionId') ?? '');
  if (!(file instanceof File) || !sectionId) throw new HttpError(422, 'invalid_request', '섹션과 파일을 함께 보내 주세요.');
  if (file.size > env.MAX_UPLOAD_BYTES) throw new HttpError(422, 'invalid_file', '파일이 너무 큽니다.');
  const slot = await rollupSlot(String(fd?.get('isoKey') ?? '') || null);
  const row = await uploadSectionFile(scope, sectionId, slot, Buffer.from(await file.arrayBuffer()), file.name);
  return json({ ok: true, id: row.id });
});

export const DELETE = handler(async (req: NextRequest) => {
  const scope = await requireOrgRollup(req.headers);
  const id = req.nextUrl.searchParams.get('id');
  if (!id) throw new HttpError(422, 'invalid_request', '취소할 파일을 지정하세요.');
  await withdrawSectionFile(scope, id);
  return json({ ok: true });
});
