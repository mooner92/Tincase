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
// 그래서 **직전 3주 목록**을 주고(WA-14), 기본으로 가장 최근 것을 펼친다.
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
 * **직전 3주까지만** 본다 (WA-14). 이번이 N주차면 N-1 · N-2 · N-3.
 *
 * 「그 전 건 어차피 안 볼 것 같다」는 판단이고, 맞다 — 참고의 값은 최근일수록 크고
 * 칩이 늘어나면 고르는 일 자체가 일이 된다. 더 뒤는 「내 이력」에서 본다.
 *
 * **「최근 제출 3건」이 아니라 「직전 3주」다.** 한 주 걸렀으면 그 주는 그냥 빈다 —
 * 3주 창이면 한 주쯤 건너뛴 경우는 창 안에서 저절로 흡수되고, 그보다 오래된 것은
 * 애초에 볼 일이 없다.
 */
const WEEKS_BACK = 3;

export const GET = handler(async (req: NextRequest) => {
  const scope = await requireScope(req.headers);
  rateLimit(`my-previous:${scope.user.email}`, 60, 60_000);

  const isoKey = req.nextUrl.searchParams.get('isoKey');
  const pick = req.nextUrl.searchParams.get('submissionId');
  /*
   * **기준 주차가 있어야 「직전 3주」가 정해진다.** 화면은 늘 `isoKey`를 보내지만,
   * 없으면 가장 최근 주차를 기준으로 삼는다 — 여기서 슬롯을 만들지는 않는다.
   * GET이 쓰기를 하면 «보기만 했는데 데이터가 생기는» 경로가 된다.
   */
  const current = isoKey
    ? await prisma.weekSlot.findUnique({ where: { isoKey } })
    : await prisma.weekSlot.findFirst({ orderBy: { opensAt: 'desc' } });

  /*
   * 먼저 **주차를 정하고**, 그 안에서 내 제출을 찾는다. 순서가 중요하다 —
   * 제출을 먼저 3건 집으면 「직전 3주」가 아니라 「최근 제출 3건」이 되어,
   * 두 달 전 것이 딸려 올라온다.
   *
   * 슬롯은 지연 생성이라(WS-11) 아무도 안 들어온 주는 레코드가 없는데, 그 주에는
   * 제출도 있을 수 없으므로 결과가 달라지지 않는다.
   */
  const slots = current
    ? await prisma.weekSlot.findMany({
        where: { opensAt: { lt: current.opensAt } },
        orderBy: { opensAt: 'desc' },
        take: WEEKS_BACK,
        select: { id: true },
      })
    : [];

  const subs = slots.length
    ? await prisma.submission.findMany({
        where: { userId: scope.user.id, isLatest: true, weekSlotId: { in: slots.map((s) => s.id) } },
        include: { weekSlot: true },
        orderBy: { weekSlot: { opensAt: 'desc' } },
      })
    : [];

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
