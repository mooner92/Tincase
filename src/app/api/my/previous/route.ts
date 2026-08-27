// GET /api/my/previous — **내가 지난번에 낸 내용** (WA-10).
//
// 왜 필요한가: 이번 주 실적은 대개 **지난주 계획에 적은 그 일**이다. 그런데 지금은
// 지난주에 뭘 냈는지 보려면 hwp를 받아 한글로 열어야 한다 — 웹에서 작성하는 사람에게는
// 그게 「한글을 여는 유일한 이유」가 된다. 병합본 드로어를 만든 것과 같은 이유다.
//
// **왜 한 주가 아니라 목록인가 (WA-12).** 처음에는 «바로 전 주» 하나만 돌려줬다.
// 대부분의 업무가 한 주 안에 끝나니 그걸로 충분해 보였는데, 세 경우에 무너진다:
//
//   휴가·출장으로 한 주 걸렀다     → 전 주가 비어 있고, 정작 필요한 건 2주 전 것이다
//   그 달 마지막 주(월간, WS-14)   → 한 달치를 정리하는데 한 주만 보이면 나머지는 한글로 연다
//   상시 반복 업무                 → 몇 주 전에 쓴 표현을 그대로 다시 쓴다
//
// 그래서 **최근 몇 주치 목록**을 주고, 기본으로 가장 최근 것을 펼친다.
// 목록은 슬롯 정보만이라 싸다 — **파일은 고른 한 건만 읽는다.**
//
// 권한: 본인 것만이다. TACP를 건드리지 않는다 — 자기 제출물 열람은 원래 열려 있다(§3.1).
// 남의 것을 보려면 `findAccessibleSubmission`을 거쳐야 하는데 이 경로는 그걸 쓰지 않고
// `userId`를 **신원에서** 박아 조회하므로 애초에 남의 것이 나올 수 없다.
// `submissionId`로 고를 때도 `userId` 조건을 함께 걸어, 남의 id를 넣어도 404다.
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireScope } from '@/server/authz';
import { handler, json, rateLimit } from '@/server/http';
import { readStoredFile } from '@/server/storage';
import { readWorklog } from '@/lib/hwp/reader';
import { toKstIso } from '@/lib/week';

export const dynamic = 'force-dynamic';

/**
 * 몇 주치를 목록에 올릴 것인가. 월간이 한 달(4~5주)을 훑으므로 그보다 넉넉하게 잡되,
 * 칩이 한 줄을 넘기지 않을 만큼만 — 더 뒤는 「내 이력」에서 본다.
 */
const MAX_ITEMS = 6;

export const GET = handler(async (req: NextRequest) => {
  const scope = await requireScope(req.headers);
  rateLimit(`my-previous:${scope.user.email}`, 60, 60_000);

  const isoKey = req.nextUrl.searchParams.get('isoKey');
  const pick = req.nextUrl.searchParams.get('submissionId');
  const current = isoKey ? await prisma.weekSlot.findUnique({ where: { isoKey } }) : null;

  // 이번 주(또는 지정 주차)보다 **앞선** 주차에서 내가 낸 것들, 최근 순
  const subs = await prisma.submission.findMany({
    where: {
      userId: scope.user.id,
      isLatest: true,
      ...(current ? { weekSlot: { opensAt: { lt: current.opensAt } } } : {}),
    },
    include: { weekSlot: true },
    orderBy: { weekSlot: { opensAt: 'desc' } },
    take: MAX_ITEMS,
  });

  if (subs.length === 0) return json({ found: false, items: [] });

  const items = subs.map((s) => ({
    submissionId: s.id,
    isoKey: s.weekSlot.isoKey,
    label: s.weekSlot.label,
    uploadedAtKst: toKstIso(s.uploadedAt).slice(5, 16).replace('T', ' '),
  }));

  // 고른 것이 없으면 가장 최근 것. 남의 id를 넣었으면 subs에 없으므로 자연히 무시된다
  const chosen = (pick && subs.find((s) => s.id === pick)) || subs[0];

  let rows: { achievements: unknown[]; plans: unknown[]; notes: unknown[] } | null = null;
  try {
    rows = readWorklog(await readStoredFile(chosen.filePath)).worklog;
  } catch {
    // 파일을 못 읽어도 «받기»는 되게 한다 — 화면에서 못 보는 것과 아예 없는 것은 다르다
    rows = null;
  }

  return json({
    found: true,
    items,
    submissionId: chosen.id,
    slot: { isoKey: chosen.weekSlot.isoKey, label: chosen.weekSlot.label, year: chosen.weekSlot.year },
    uploadedAtKst: toKstIso(chosen.uploadedAt).slice(5, 16).replace('T', ' '),
    /** 읽지 못했으면 null — 화면이 「받기만 됩니다」로 안내한다 */
    rows,
  });
});
