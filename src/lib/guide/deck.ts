// PG-57 — 사용 안내의 **단계 목록 하나.** 발표 모드(/guide/present)와 혼자 보기(/guide)가 이것 하나를 쓴다.
//
// 장의 순서는 기능 목록이 아니라 **한 주의 이야기**다: 부서원이 적어 내고 → 담당자가 모으고 → 실·팀장이 승인하고 →
// 본부가 이어 붙이고 → 총괄이 전사본을 만든다. 강당에서 처음 보는 사람에게는 「버튼이 무엇을 하나」보다
// 「내 일이 이 흐름의 어디인가」가 먼저 들어가야 한다. 기능별로 나누면 흐름이 안 보인다.
//
// 2026-10-08 — **게임 튜토리얼처럼** 바꿨다(사용자: 「거창한 설명보다, 게임에서 누를 버튼만 빼고 검은 필터를 씌우고
// 옆에 『인벤토리: 습득한 아이템은 여기서 확인할 수 있어요』처럼」). 그래서 단계의 글은 두 토막뿐이다:
//   label  화면에 보이는 **그 이름** — 말풍선의 굵은 머리(「제출」·「업무 내용」). 16자까지 — 8자가 넘으면 말풍선에서
//          제 줄에 놓이고 문장은 그 밑으로 간다(「미제출 2명 이름 복사: 복사해서 / 메신저에…」처럼 이름과 문장이 섞여 끊기지 않게)
//   say    한 문장, 해요체 — 32자까지, **생각 하나**. 「제출: 다 적었으면 여기를 눌러요」처럼 이름 뒤에 바로 이어 읽힌다.
//          「—」로 두 생각을 잇지 않는다 — 둘째 생각은 혼자 보기의 「자세히」(`more`)로 간다
// 예전의 24자 제목 + 본문 2–3줄은 강당에서 「발표 자료」처럼 읽혔다 — 글을 읽느라 화면을 안 본다.
// 혼자 볼 때 더 알 것이 있으면 `more` 한 줄(「자세히」 밑), 발표자가 말할 것은 `notes`(발표자 창에만).
//
// 이름은 **지금 화면 그대로** 적는다 — 화면과 다른 낱말은 대조를 시킨다(「[승인]」이라고 적으면 강당에서는 화면의
// 「고칠 것 없음 · 승인」과 다른 버튼을 찾는다). 「계획 2줄을 이번 주 실적으로」처럼 긴 버튼도 줄이지 않는다 — 줄여 쓴 이름은
// 화면에 없다. 구멍은 **누르는 그것 하나**다: 표·카드 전체를 밝히면 「어디를 누르라는 건가」를 다시 찾게 된다(2026-10-08 검토 —
// 서른 단계 중 열둘이 패널을 밝혀 화면의 절반 넘게 뚫려 있었다). 그래서 로그인은 [로그인] 버튼, 작성은 실적 표 첫 칸,
// 병합본은 「준비됨」 칩, 전사는 「제출 19 / 26명」 합계만 밝힌다.
// 역할 이름도 화면을 따른다: 이름표로 쓸 때는 「부서담당자」, 화면이 「부서장」이라 부르는 사람은 장 제목이 「실·팀장」이어도
// 장 카드에 「부서장」을 밝힌다. 문서 이름은 「전사본」.
//
// 그림은 데이터가 아니라 산출물이다: `node scripts/guide-capture.cjs`가 가짜 DB로 앱을 몰아 `anchor`(구멍)와
// `frame`(카메라)의 사각형을 재고 `public/guide/deck/<id>.webp`와 `manifest.json`을 만든다(PG-62). 그래서 여기에는
// 좌표가 없다 — 화면이 바뀌면 다시 찍으면 되고, 앵커(`data-guide`)가 사라지면 테스트가 먼저 깨진다(PG-63).
// 단계 순서는 **누르면 다음 화면**이 되게 놓았다: 구멍(누를 곳)을 누르면 다음 단계 = 그 버튼을 누른 뒤의 화면이다.

/**
 * 이 단계를 **쓰는 사람**. 혼자 보기는 이 사람이 쓰는 단계만 그린다(TACP-9). 누가 무엇을 갖는지는
 * `authz.ts`의 `guideCaps`가 정한다(TACP-12) — 여기서는 이름만 붙인다.
 */
export type GuideCap =
  | 'all' // 누구나 — 표지·왜·부서원·마무리
  | 'manager' // 부서 문서를 다루는 사람 (lead·head, TACP-16)
  | 'head' // 병합본 승인 (isReviewer, HM-47)
  | 'report' // 위로 제출 (canSendReport + 3단계 켜짐, TACP-21)
  | 'hq' // 본부 취합 (hasHqDesk)
  | 'org' // 「전사」 화면 (orgPageView.open)
  | 'orgDesk' // 전사 취합 (canOpenOrgDesk)
  | 'schedule'; // 주차 마감 바꾸기 (canScheduleDeadlines, TACP-20)

export type ChapterId = 'intro' | 'why' | 'member' | 'lead' | 'head' | 'hq' | 'org' | 'outro';

/** 장 순서 — 이야기 순서다. 테스트가 이 순서를 고정한다(PG-T84) */
export const CHAPTER_ORDER: readonly ChapterId[] = ['intro', 'why', 'member', 'lead', 'head', 'hq', 'org', 'outro'];

interface StepBase {
  /** 그림 파일 이름이자 manifest의 키 — 바꾸면 다시 찍어야 한다 */
  id: string;
  /**
   * 말풍선의 굵은 머리 — **화면에 보이는 이름 그대로**, 16자까지(PG-T84 — 긴 버튼 이름을 줄이지 않는다). 8자가 넘으면
   * 말풍선에서 제 줄에 놓인다(`LABEL_OWN_LINE`). 글자 슬라이드(표지·왜·정리·주소)에서는 큰 제목이다 — 24자까지
   */
  label: string;
  /** 한 문장, 해요체 — 32자까지, 생각 하나(「—」로 잇지 않는다, PG-T84). 말풍선에서 「label: say」로 이어 읽힌다 */
  say: string;
  /** 혼자 보기의 「자세히」 한 줄 — 없어도 된다. 발표 무대에는 그리지 않는다 */
  more?: string;
  /** 발표자 메모 — 발표자 창에만 */
  notes: string;
  /** 없으면 장의 `who` */
  who?: GuideCap;
  /** 발표에서만 — 혼자 보기에는 뜻이 없는 단계(표지·주소: 혼자 보기는 페이지 머리가 표지다) */
  presentOnly?: boolean;
  /**
   * 혼자 보기에서만 — 발표에서 빼는 단계. 강당에서는 한 주의 끝(전사본 받기)이 장의 마지막 무게여야 하는데,
   * 드문 일(연휴 마감)을 미리보기 표까지 넘기면 이야기의 끝이 흐려진다. 발표는 「이럴 때 여기서 바꾼다」 한 장만 두고,
   * 세부는 그 일을 하는 사람이 혼자 보기에서 본다. 바로 다음 단계와 **같은 화면**을 보이는 현황 카드(「제출 현황」·
   * 「산하 제출」)도 발표에서는 뺀다 — 강당에서 같은 화면이 두 장 이어지면 넘긴 줄 모른다(2026-10-08 검토)
   */
  selfOnly?: boolean;
  /**
   * 혼자 보기에서 이 단계를 둘 장 — 이야기 순서와 **하는 사람**이 다를 때.
   * 「위로 제출」은 실·팀장 승인 뒤에 일어나지만(발표는 그 순서) 누르는 사람은 부서담당자다. 혼자 보기에서
   * 담당자가 「실·팀장」 장을 열어야 자기 일이 보이면, 그 장을 「내 역할」로 착각한다(예전 화면이 그랬다)
   */
  selfHome?: ChapterId;
}

/**
 * 프레임 자르기 (그림 좌표 CSS px, 앵커 사각형 기준). 카드 하나를 통째로 카메라 사각형으로 삼으면 카메라가 덜 다가간다 —
 * 누를 곳 둘레 700px 남짓만 담는다(PG-58). `y`는 위에서 건너뛸 높이, `right`면 오른쪽 끝에서 `w`만큼(버튼이 줄 끝에 있는 카드)
 */
export interface FrameClip {
  y?: number;
  w?: number;
  h?: number;
  right?: boolean;
}

export type GuideStep =
  | (StepBase & {
      kind: 'shot';
      /** 구멍 — 누를 곳의 `data-guide` 값 (CP-104) */
      anchor: string;
      /** 카메라가 함께 담을 곳(누를 곳의 앞뒤) — 없으면 구멍 둘레 */
      frame?: string;
      /** 카메라 사각형을 줄인다 — 찍을 때 적용해 manifest에 남는다 */
      frameClip?: FrameClip;
      /** 구멍 사각형을 줄인다 — 앵커가 창보다 큰 표·드로어 본문일 때 보이는 윗부분만 뚫는다 */
      focusClip?: FrameClip;
      /**
       * 무엇을 보이는 단계인가 — 누르는 것(`button` — 버튼·고쳐 적는 칸)인가, 보기만 하는 것(`area` — 칩·합계·적는 칸 묶음)인가.
       * `button`이면 누르라는 손이 붙고 말풍선 꼬리말이 「버튼을 눌러 계속」, `area`면 손 없이 「밝은 곳을 눌러 계속」이다.
       * 테스트가 이 기준으로 카메라를 잰다(PG-T88 — 버튼은 더 다가간다)
       */
      target: 'button' | 'area';
      /** 같은 화면의 연속 단계 — 카메라만 옮긴다 (CP-101) */
      screen?: string;
    })
  | (StepBase & { kind: 'cover' })
  /** 큰 제목 한 줄 + 한 줄 (왜 바꾸나) */
  | (StepBase & { kind: 'card' })
  | (StepBase & { kind: 'flow'; flow: { who: string; what: string }[] })
  | (StepBase & {
      kind: 'message';
      /** 사내 메신저 알림 모양 — `{week}`는 그림을 찍은 주차로 바뀐다(manifest.week). 이 카드가 구멍이다 */
      message: { from: string; subject: string; lines: string[] };
    })
  | (StepBase & {
      kind: 'buttons';
      /** 역할마다 누르는 버튼 — 화면의 글자 그대로(대괄호 없이). `or`면 둘 중 하나, 아니면 순서 */
      rows: { who: string; buttons: string[]; or?: boolean }[];
    })
  | (StepBase & { kind: 'address' });

export interface GuideChapter {
  id: ChapterId;
  /** 목차·구석 알약의 이름 — 「부서담당자 3/5」 */
  title: string;
  /** 장 카드의 한 줄(「이번엔 ○○ 차례예요」 밑). 없으면 장 카드를 두지 않는다(표지·왜·마무리) */
  lede?: string;
  /** 장 카드의 발표자 메모 — 앞 장에서 이 장으로 넘어가는 말 */
  notes?: string;
  who: GuideCap;
  steps: GuideStep[];
}

/** 장 카드의 큰 줄 — 「이번엔 부서담당자 차례예요」 */
export const chapterHeadline = (c: Pick<GuideChapter, 'title'>) => `이번엔 ${c.title} 차례예요`;

export const DECK: readonly GuideChapter[] = [
  {
    id: 'intro',
    title: '표지',
    who: 'all',
    steps: [
      {
        id: 'intro-cover',
        kind: 'cover',
        presentOnly: true,
        label: '업무일지, 이제 웹에서 써요',
        say: '한 주의 흐름대로 따라가 볼게요',
        notes:
          '오늘은 매주 쓰는 업무일지를 Tincase로 내고 모으는 방법을 보여 드립니다. 기능을 하나씩 짚지 않고, 한 주가 흘러가는 순서대로 갑니다 — 부서원, 부서담당자, 실·팀장, 본부, 총괄. 화면에 나오는 이름과 업무는 모두 지어낸 것입니다.',
      },
    ],
  },
  {
    id: 'why',
    title: '왜 바꾸나',
    who: 'all',
    steps: [
      {
        id: 'why-before',
        kind: 'card',
        label: '지금은 hwp를 메일로 주고받아요',
        say: '모으고 합치는 건 모두 손으로 했어요',
        notes:
          '지금까지는 매주 목요일마다 hwp 파일이 메일로 오갔습니다. 담당자는 파일을 하나씩 열어 복사해 붙였고, 본부와 기획조정실은 그걸 또 합쳤습니다. 누가 안 냈는지 세는 일, 늦게 온 파일을 다시 끼워 넣는 일도 모두 사람 몫이었습니다.',
      },
      {
        id: 'why-after',
        kind: 'flow',
        label: '적는 건 웹, 모으는 건 Tincase',
        say: '마감이 지나면 버튼 하나씩 위로 올라가요',
        flow: [
          { who: '부서원', what: '적고 제출' },
          { who: '부서담당자', what: '병합본 다듬기' },
          { who: '실·팀장', what: '검토·승인' },
          { who: '본부', what: '이어 붙여 제출' },
          { who: '총괄', what: '전사본 만들기' },
        ],
        notes:
          '바뀌는 것은 적는 곳 하나입니다. 부서원은 웹에서 표에 적고 제출을 누릅니다. 마감이 지나면 부서 병합본이 저절로 만들어지고, 부서담당자가 다듬습니다. 실·팀장이 고쳐 저장하면 그게 승인입니다. 그다음은 본부, 총괄로 버튼 하나씩 올라갑니다. 이제 이 순서대로 화면을 보겠습니다.',
      },
    ],
  },
  {
    id: 'member',
    title: '부서원',
    lede: '웹에서 적고 제출만 누르면 돼요',
    notes: '먼저 부서원입니다. 모든 분이 하시는 일이고, 한 주에 버튼 두 번이면 끝납니다.',
    who: 'all',
    steps: [
      {
        id: 'member-login',
        kind: 'shot',
        anchor: 'login-submit',
        frame: 'login-form',
        target: 'button',
        label: '로그인',
        say: 'KEI 이메일과 받은 비밀번호로 들어와요',
        more: '처음 들어오면 새 비밀번호로 바꿔요 · 잊었으면 [비밀번호를 잊으셨나요?]',
        notes:
          '주소는 마지막 장에 크게 보여 드립니다. 아이디는 KEI 이메일입니다. 처음 받은 비밀번호로 들어오면 바로 새 비밀번호로 바꾸게 되어 있습니다. 비밀번호를 잊으면 로그인 화면 아래 링크로 메신저에 재설정 링크를 받습니다.',
      },
      {
        id: 'member-week',
        kind: 'shot',
        anchor: 'compose-open',
        frame: 'week-card',
        target: 'button',
        label: '작성하기',
        say: '이번 주 일지를 여기서 써요',
        more: '마감은 매주 목요일 14:00 — 맨 위에 남은 시간이 보여요',
        notes:
          '로그인하면 바로 이 화면입니다. 맨 위가 이번 주 주차와 마감, 남은 시간입니다. 할 일은 카드 안의 초록 버튼 하나, 작성하기입니다. 오른쪽에는 우리 부서에서 누가 냈는지 점으로 보입니다 — 내용은 안 보이고 냈는지만 보입니다.',
      },
      {
        id: 'member-compose',
        kind: 'shot',
        anchor: 'compose-first',
        frame: 'compose-table',
        // 표의 왼쪽 700px — 「1. 주요 업무실적」 제목·「업무 내용」 머리글·첫 칸. 표 전체를 담으면 덜 다가가 버튼 기준(1.35배)에 못 미친다
        frameClip: { w: 700 },
        target: 'button',
        screen: 'composer',
        label: '업무 내용',
        say: '한글 표를 복사해 여기 붙여넣어요',
        more: '여러 줄이 한 번에 들어가요 · 직접 적어도 돼요',
        notes:
          '작성 화면은 한글 양식의 표와 같은 모양입니다. 실적, 계획, 특이사항 세 표가 있고, 점선 칸이 붙여넣는 자리입니다. 한글에서 쓰던 표를 통째로 복사해 여기 붙여넣으면 줄이 나뉘어 들어갑니다. 직접 적어도 됩니다. 구분 번호는 제출할 때 시스템이 다시 매깁니다.',
      },
      {
        id: 'member-previous',
        kind: 'shot',
        anchor: 'previous-to-achievements',
        frame: 'previous-panel',
        // 버튼이 머리줄 끝(오른쪽)에 있다 — 판의 오른쪽 700px(지난주에 낸 줄들의 내용이 같이 보인다)
        frameClip: { w: 700, right: true },
        target: 'button',
        screen: 'composer',
        label: '계획 2줄을 이번 주 실적으로',
        say: '지난주 계획이 그대로 들어와요',
        more: '줄마다 [+실적] [+계획]으로 골라 넣을 수도 있어요',
        notes:
          '이번 주 실적은 대개 지난주 계획에 적은 그 일입니다. 그래서 작성 화면 맨 위에 지난번에 낸 것을 펼쳐 둡니다. 오른쪽 버튼 한 번이면 지난주 계획이 이번 주 실적 칸으로 들어오고, 거기서 고치기만 하면 됩니다.',
      },
      {
        id: 'member-share',
        kind: 'shot',
        anchor: 'compose-share',
        frame: 'compose-table',
        frameClip: { w: 700, right: true },
        target: 'button',
        screen: 'composer',
        label: '공유',
        say: '전 직원이 알아야 할 일이면 눌러요',
        more: '병합본에 파란색으로 나가요 · 다시 누르면 꺼져요',
        notes:
          '지난주 계획이 이번 주 실적으로 들어왔습니다. 줄 맨 오른쪽의 공유는 전 직원에게 전할 주요 사항에 누르는 것입니다. 누른 줄은 병합본에 파란색으로 나갑니다.',
      },
      {
        id: 'member-submit',
        kind: 'shot',
        anchor: 'compose-submit',
        frame: 'compose-footer',
        frameClip: { w: 700, right: true },
        target: 'button',
        screen: 'composer',
        label: '제출',
        say: '다 적었으면 여기를 눌러요',
        more: '부서 양식(hwp)으로 만들어져 담당자에게 모여요',
        notes: '다 적었으면 오른쪽 아래 제출을 누릅니다. 이걸로 부서 양식 hwp가 만들어져 담당자에게 모입니다.',
      },
      {
        id: 'member-done',
        kind: 'shot',
        anchor: 'compose-open',
        frame: 'week-card',
        target: 'button',
        label: '다시 작성 (새 버전)',
        say: '고칠 일이 생기면 눌러요',
        more: '낸 내용이 채워진 채 열려요 · 마지막 버전이 병합돼요',
        notes:
          '제출하면 카드에 제출 완료가 붙고 버튼이 바뀝니다. 고칠 게 생기면 다시 작성을 누르세요. 방금 낸 내용이 채워진 채로 열리니 고칠 칸만 고쳐 내면 됩니다. 그게 새 버전이 되고, 병합에는 마지막 것이 들어갑니다. 이전 버전도 지워지지 않습니다. 마감 전이면 제출 취소도 할 수 있습니다.',
      },
      {
        id: 'member-history',
        kind: 'shot',
        anchor: 'history-open',
        frame: 'history-table',
        frameClip: { w: 700, right: true },
        target: 'button',
        label: '열기',
        say: '지난 주에 낸 것도 다시 열어 봐요',
        more: '최근 26주 · 담당자가 고친 판이면 「○○ 고침」이 함께 보여요',
        notes:
          '위 메뉴의 내 이력에는 최근 반년 치가 주마다 한 줄씩 있습니다. 낸 주는 열기로 바로 보고, 필요하면 받습니다. 담당자가 내 업무일지를 고쳤으면 누가 고쳤는지도 여기 나옵니다. 부서원 순서는 여기까지입니다.',
      },
    ],
  },
  {
    id: 'lead',
    title: '부서담당자',
    lede: '누가 냈는지 보고, 병합본을 다듬어요',
    notes:
      '다음은 부서담당자입니다. 부서원이 낸 것이 담당자에게 모입니다. 화면 위 메뉴에 [수합 관리]가 하나 더 있습니다.',
    who: 'manager',
    steps: [
      {
        id: 'lead-status',
        kind: 'shot',
        anchor: 'status-card',
        target: 'area',
        screen: 'lead-manage',
        selfOnly: true,
        label: '제출 현황',
        say: '우리 부서 몇 명이 냈는지 보여요',
        more: '아래 부서원 표의 [열기]로 낸 것을 바로 봐요',
        notes:
          '담당자에게는 위 메뉴에 수합 관리가 더 있습니다. 맨 위 카드가 이번 주 제출 현황, 몇 명 중 몇 명이 냈는지입니다. 아래로 내려가면 부서원 표가 있고, 열기를 누르면 파일을 받지 않고 내용을 바로 봅니다.',
      },
      {
        id: 'lead-nudge',
        kind: 'shot',
        anchor: 'copy-missing',
        frame: 'status-card',
        frameClip: { w: 700 },
        target: 'button',
        screen: 'lead-manage',
        label: '미제출 2명 이름 복사',
        say: '메신저에 붙여넣어 알려요',
        more: 'Tincase도 마감 전날 11:45 · 당일 09:00 · 1시간 전 · 10분 전에 안 낸 사람에게 알려요',
        notes:
          '수합 관리 맨 위 카드가 이번 주 제출 현황, 몇 명 중 몇 명이 냈는지입니다. 독촉은 이름 복사 하나면 됩니다. 메신저에 붙여넣으세요. 그리고 Tincase가 마감 전날 점심 전, 당일 아침, 한 시간 전, 십 분 전에 아직 안 낸 사람에게만 알림을 보냅니다. 이미 낸 사람에게는 가지 않습니다.',
      },
      {
        id: 'lead-merge',
        kind: 'shot',
        anchor: 'merge-ready',
        frame: 'merge-card',
        frameClip: { h: 200 },
        target: 'area',
        screen: 'lead-manage',
        label: '준비됨',
        say: '마감 1분 뒤 저절로 합쳐져요',
        more: '늦게 낸 사람이 있으면 [다시 병합] — 병합본을 고친 뒤라면 고친 내용이 사라져서 먼저 물어요',
        notes:
          '목요일 두 시 일 분이면 병합본이 저절로 만들어집니다. 여러 사람이 같은 회의를 적었으면 한 줄로 묶고, 내용이 달라서 확인이 필요한 곳은 여기 따로 알려 줍니다. 마감 뒤에 늦게 낸 사람이 있으면 다시 병합을 누르면 됩니다. 다만 병합본을 이미 고쳤다면 다시 병합할 때 고친 내용이 사라집니다. 그래서 누가 몇 곳 고쳤는지 보여 주고 한 번 더 묻습니다.',
      },
      {
        id: 'lead-merged',
        kind: 'shot',
        anchor: 'merged-cell',
        frame: 'merged-drawer',
        frameClip: { h: 420 },
        target: 'button',
        label: '업무실적 내용',
        say: '칸을 눌러 바로 고쳐요',
        more: '다 고쳤으면 수정 저장 · 줄은 손잡이로 옮겨요',
        notes:
          '내용 보기를 누르면 병합본이 화면에 열립니다. 이상한 줄이 하나 보이면 한글을 열 필요 없이 그 칸을 눌러 고치고 수정 저장을 누릅니다. 순서도 끌어서 바꿉니다. 여기서 고쳐도 부서원이 낸 원본은 바뀌지 않습니다.',
      },
      {
        id: 'lead-rules',
        kind: 'shot',
        anchor: 'merge-categories',
        frame: 'merge-settings',
        frameClip: { h: 400 },
        target: 'area',
        label: '분류 순서',
        say: '한 번 적어 두면 매주 이 순서로 묶여요',
        more: '정렬은 제출자 순·일자 순 — 이미 만든 병합본은 [다시 병합]해야 바뀌어요',
        notes:
          '매주 손으로 줄을 옮기던 일은 부서 설정에서 한 번 정해 둡니다. 분류 순서를 적으면 병합본이 그 순서로 묶이고, 정렬을 일자 순으로 하면 날짜 빠른 줄부터 놓입니다. 다음 병합부터 그대로 따릅니다. 이번 주 병합본이 이미 있으면 카드에 규칙 바뀜이 뜹니다 — 다시 병합을 눌러야 그 병합본에도 들어갑니다.',
      },
    ],
  },
  {
    id: 'head',
    title: '실·팀장',
    lede: '화면 이름은 부서장, 병합본을 보고 승인해요',
    notes:
      '이제 실장님, 팀장님 차례입니다. 화면에서는 「부서장」이라고 나옵니다. 담당자가 다듬은 병합본을 보고 승인하시는 일입니다.',
    who: 'head',
    steps: [
      {
        id: 'head-notice',
        kind: 'message',
        label: '사내 메신저',
        say: '마감 10분 뒤 검토 부탁이 와요',
        more: '부서장에게만, 병합이 된 때만 와요 — [수합 관리]에서 병합본을 열어요',
        message: {
          from: 'Tincase',
          subject: '[Tincase] {week} 주간 병합본 검토 부탁드려요',
          lines: ['{week} 주간 업무일지 병합본이 준비됐어요.', 'Tincase에서 내용을 확인하고 고칠 부분을 알려주세요.'],
        },
        notes:
          '목요일 두 시 십 분, 실장님 팀장님께 메신저로 이 알림이 갑니다. 병합이 성공했을 때만 갑니다 — 실패는 고칠 수 있는 담당자에게 먼저 갑니다. 알림을 받으면 Tincase의 수합 관리에서 병합본을 엽니다.',
      },
      {
        id: 'head-open',
        kind: 'shot',
        anchor: 'merged-open',
        frame: 'merge-review',
        frameClip: { w: 700 },
        target: 'button',
        screen: 'head-manage',
        label: '내용 보기',
        say: '눌러서 병합본을 열어요',
        more: '[작성자 보기]를 켜면 줄마다 누가 냈는지 보여요',
        notes:
          '병합본 카드에 부서장 승인 전이라고 붙어 있습니다. 내용 보기를 누르면 병합본이 열리고, 작성자 보기를 켜면 줄마다 누가 썼는지 보입니다 — 물어볼 사람을 바로 압니다.',
      },
      {
        id: 'head-save',
        kind: 'shot',
        anchor: 'merged-save',
        frame: 'merged-head',
        frameClip: { w: 700, right: true },
        target: 'button',
        label: '수정 저장',
        say: '고쳐서 저장하면 그게 승인이에요',
        more: '한글로 받아 고칠 필요 없어요 · 담당자에게 「승인 완료 · 바뀐 곳」이 가요',
        notes:
          '고칠 곳이 있으면 그 칸을 눌러 바로 고치고 수정 저장을 누르시면 됩니다. 한글로 받아서 고치실 필요가 없습니다. 따로 승인을 누를 필요 없이 그 저장이 승인입니다. 담당자에게 승인 완료와 함께 어디가 바뀌었는지 알림이 갑니다.',
      },
      {
        id: 'head-approve',
        kind: 'shot',
        anchor: 'merged-approve',
        frame: 'merge-review',
        frameClip: { w: 700 },
        target: 'button',
        screen: 'head-manage',
        label: '고칠 것 없음 · 승인',
        say: '고칠 게 없으면 이것만 눌러요',
        more: '부서장에게만 보여요 · 승인 뒤 바뀌면 「승인 뒤 바뀜」으로 알려 줘요',
        notes:
          '고칠 것이 없으면 이 버튼 하나입니다. 부서장에게만 보이는 버튼입니다. 승인한 뒤에 누가 늦게 내서 병합본이 바뀌면 승인 뒤 바뀜으로 표시되니, 그때 한 번 더 보시면 됩니다.',
      },
      {
        id: 'head-report',
        kind: 'shot',
        anchor: 'report-unit-submit',
        frame: 'report-unit',
        frameClip: { w: 700 },
        target: 'button',
        who: 'report',
        selfHome: 'lead',
        label: '기획경영본부에 제출',
        say: '승인되면 담당자가 위로 올려요',
        more: '본부가 없는 부서는 「총괄(기획조정실)에 제출」 · 낸 뒤에 고쳤으면 [다시 제출]',
        notes:
          '승인이 나면 담당자가 병합본 카드 아래의 제출 카드에서 위로 냅니다. 산하 본부가 있으면 본부에, 없으면 총괄에 바로 갑니다. 카드에는 언제까지 내야 하는지 시각이 붙어 있고, 실·팀장 승인이 아직이면 부서장 승인 전이라고 같은 줄에 나옵니다. 누르는 순간의 병합본이 사본으로 가니, 그 뒤에 고쳤으면 다시 제출을 눌러야 합니다.',
      },
    ],
  },
  {
    id: 'hq',
    title: '본부',
    lede: '실·팀이 낸 것을 이어 붙여 총괄에 내요',
    notes: '실·팀이 낸 것은 본부로 갑니다. 본부 담당자와 본부장님께는 [본부 취합] 메뉴가 있습니다.',
    who: 'hq',
    steps: [
      {
        id: 'hq-status',
        kind: 'shot',
        anchor: 'hq-units',
        target: 'area',
        screen: 'hq',
        selfOnly: true,
        label: '산하 제출',
        say: '실·팀마다 언제 냈는지 보여요',
        more: '이어 붙이는 순서는 [순서 바꾸기]로 한 번 정하면 매주 그대로예요',
        notes:
          '본부 담당자와 본부장에게는 본부 취합 메뉴가 있습니다. 맨 위에 기한이 둘 있습니다 — 「실·팀 → 본부」는 실·팀이 본부에 내는 시각, 「본부 → 총괄」은 본부가 총괄에 내는 시각입니다. 아래에는 산하 실·팀이 냈는지, 언제 누가 냈는지 한 줄씩 보입니다. 위에서부터 이 순서대로 문서에 들어가고, 순서는 한 번 정하면 매주 그대로입니다.',
      },
      {
        id: 'hq-run',
        kind: 'shot',
        anchor: 'hq-run-button',
        frame: 'hq-run-head',
        frameClip: { w: 700 },
        target: 'button',
        screen: 'hq',
        label: '이어 붙이기',
        say: '낸 실·팀을 한 문서로 이어요',
        more: '실·팀 안의 내용은 바꾸지 않아요 · 늦게 낸 곳이 있으면 [다시 이어 붙이기]',
        notes:
          '본부 취합 화면 맨 위에는 산하 실·팀이 냈는지, 언제 냈는지가 한 줄씩 있습니다. 이어 붙이기를 누르면 낸 실·팀이 정한 순서대로 한 문서가 됩니다. 사람이 확인할 곳이 있으면 주황 상자로 알려 주고, 번호 다시 매기기처럼 저절로 고친 것은 접어 둡니다. 본부는 실·팀 안의 내용을 고치지 않습니다 — 고칠 곳은 그 실·팀이 고쳐 다시 내고, 여기서 다시 이어 붙입니다.',
      },
      {
        id: 'hq-approve',
        kind: 'shot',
        anchor: 'hq-approve',
        frame: 'hq-approval',
        // 버튼이 줄 끝(오른쪽)에 있다 — 오른쪽에서 772px: 「본부장이 [승인]을 누르면…」 낱말 앞에서 시작한다
        frameClip: { w: 772, right: true },
        target: 'button',
        screen: 'hq',
        label: '검토 완료 · 승인',
        say: '본부장이 다 봤으면 눌러요',
        more: '본부장에게만 보여요 · 누르면 본부 담당자에게 알림이 가요',
        notes:
          '본부장님은 본부본을 받아 보시고 검토 완료 승인을 누릅니다. 누르는 순간 본부 담당자에게 승인 완료 알림이 갑니다.',
      },
      {
        id: 'hq-submit',
        kind: 'shot',
        anchor: 'report-hq-submit',
        frame: 'report-hq',
        frameClip: { w: 700 },
        target: 'button',
        screen: 'hq',
        label: '총괄(기획조정실)에 제출',
        say: '누르면 본부 일은 끝이에요',
        more: '「본부 → 총괄」 기한이 카드에 보여요 · 그 뒤에 다시 이어 붙였으면 [다시 제출]',
        notes:
          '승인이 끝나면 같은 카드 아래의 총괄(기획조정실)에 제출을 누릅니다. 카드에 「본부 → 총괄」 기한이 적혀 있습니다. 이걸로 본부의 일은 끝입니다. 제출한 뒤에 다시 이어 붙였으면 제출 뒤 바뀜이 뜨니 다시 제출하면 됩니다.',
      },
    ],
  },
  {
    id: 'org',
    title: '총괄',
    lede: '전사 제출을 보고 전사본을 만들어요',
    notes: '마지막으로 기획조정실, 총괄입니다. 전사가 한 화면에 모입니다.',
    who: 'org',
    steps: [
      {
        id: 'org-board',
        kind: 'shot',
        anchor: 'org-total',
        frame: 'org-board',
        // 합계는 표 머리 왼쪽 — 왼쪽 700px에 섹션 줄 몇 개가 같이 보인다
        frameClip: { w: 700, h: 330 },
        target: 'area',
        screen: 'org',
        label: '제출',
        say: '전사에서 몇 명이 냈는지 보여요',
        more: '막대를 누르면 안 낸 사람이 펼쳐져요 · [안내문 복사]로 바로 알려요',
        notes:
          '기획조정실 총괄 화면, 전사입니다. 맨 위 합계가 전사에서 몇 명이 냈는지입니다. 머리 줄에 부서 마감과 「실·팀 → 본부」·「본부 → 총괄」 두 기한이 있습니다. 전사가 전사본 섹션 순서대로 한 줄씩 있고, 줄마다 몇 명이 냈는지 막대로 보입니다. 막대를 누르면 안 낸 사람이 펼쳐지고 안내문 복사로 바로 알릴 수 있습니다.',
      },
      {
        id: 'org-final',
        kind: 'shot',
        anchor: 'org-upload',
        frame: 'org-board',
        frameClip: { y: 76, w: 460, h: 330, right: true },
        target: 'button',
        screen: 'org',
        who: 'orgDesk',
        label: '올리기',
        say: '게시판으로 받은 hwp는 여기 올려요',
        more: '「최종본에」 열이 섹션마다 전사본에 무엇이 들어갈지 보여 줘요',
        notes:
          '오른쪽 「최종본에」 열은 섹션마다 무엇이 들어갈지입니다. Tincase로 올라온 것, 총괄이 올린 파일, 본부가 아직 안 낸 것, 실·팀은 냈는데 본부본에 빠진 것, 미제출. 본부 쪽 문제는 이름을 눌러 그 본부 화면으로 갑니다. 아직 Tincase를 안 쓰는 섹션은 게시판으로 받은 hwp를 그 줄에서 올립니다.',
      },
      {
        id: 'org-run',
        kind: 'shot',
        anchor: 'org-run-button',
        frame: 'org-run',
        frameClip: { w: 700 },
        target: 'button',
        screen: 'org-run',
        who: 'orgDesk',
        label: '전사 취합본 만들기',
        say: '들어온 섹션을 한 문서로 묶어요',
        more: '빠진 섹션은 「미제출」로 자리만 남아요',
        notes:
          '맨 아래 전사 취합본 만들기를 누르면 들어온 섹션이 순서대로 한 문서, 전사본이 됩니다. 안 온 섹션은 미제출로 자리만 남습니다. 도착했는데 어느 섹션에도 안 들어가는 사본이 있으면 만들기 전에 따로 알려 줍니다. 자동으로 고친 곳과 한글에서 확인할 곳도 같이 알려 줍니다.',
      },
      {
        id: 'org-download',
        kind: 'shot',
        anchor: 'org-download',
        frame: 'org-run',
        frameClip: { w: 700 },
        target: 'button',
        screen: 'org-run',
        who: 'orgDesk',
        label: '전사본 받기',
        say: '한글로 열어 보고 게시판에 올려요',
        more: '늦게 들어온 섹션이 있으면 「섹션이 바뀜」 — [다시 만들기]',
        notes:
          '전사본 받기로 한글 파일을 받아 열어 보고 게시판에 올리면 한 주가 끝납니다. 그 뒤에 늦게 들어온 섹션이 있으면 섹션이 바뀜이 뜨니 다시 만들기를 누릅니다.',
      },
      {
        id: 'org-schedule',
        kind: 'shot',
        anchor: 'deadline-paste',
        frame: 'deadline-paste-box',
        target: 'area',
        who: 'schedule',
        label: '공지 붙여넣기',
        say: '연휴엔 공지를 그대로 붙여넣어요',
        more: '[일정 바꾸기] → [마감 바꾸기]에서 열려요 · 날짜·시각을 알아서 읽어요',
        notes:
          '연휴로 마감이 당겨지는 주에는 일정 바꾸기를 엽니다. 게시판에 올리는 작성 요청 공지를 그대로 붙여넣으면 날짜와 시각을 읽습니다. 따로 날짜를 고를 필요가 없습니다.',
      },
      {
        id: 'org-preview',
        kind: 'shot',
        anchor: 'deadline-apply',
        frame: 'deadline-plan',
        frameClip: { w: 700 },
        target: 'button',
        who: 'schedule',
        selfOnly: true,
        label: '이대로 적용',
        say: '미리 본 대로 그 주만 바뀌어요',
        more: '전 부서 마감이 대외 마감 한 시간 앞으로 잡히고, 다음 주는 평소대로예요',
        notes:
          '미리보기에서 어느 주차 마감이 언제로 바뀌는지, 알림과 병합이 몇 시에 나가는지, 「실·팀 → 본부」·「본부 → 총괄」 기한이 언제가 되는지 먼저 확인합니다. 이대로 적용을 누르면 그 주만 전 부서 마감이 바뀌고, 부서원 화면의 마감이 빨갛게 바뀌며 이유가 한 줄 붙습니다.',
      },
    ],
  },
  {
    id: 'outro',
    title: '마무리',
    who: 'all',
    steps: [
      {
        id: 'outro-summary',
        kind: 'buttons',
        label: '한 주에 누르는 버튼은 이것뿐이에요',
        say: '모르면 맨 위 [사용 안내]를 다시 열어요',
        rows: [
          { who: '부서원', buttons: ['작성하기', '제출'] },
          { who: '부서담당자', buttons: ['내용 보기', '○○본부에 제출'] },
          { who: '실·팀장', buttons: ['수정 저장', '고칠 것 없음 · 승인'], or: true },
          { who: '본부', buttons: ['이어 붙이기', '총괄(기획조정실)에 제출'] },
          { who: '총괄', buttons: ['전사 취합본 만들기', '전사본 받기'] },
        ],
        notes:
          '정리하면 사람마다 누르는 버튼은 두 개 남짓입니다. 마감은 매주 목요일 두 시, 병합은 그 1분 뒤 저절로 됩니다. 오늘 본 화면은 언제든 위 메뉴의 사용 안내에서 다시 볼 수 있습니다.',
      },
      {
        id: 'outro-address',
        kind: 'address',
        presentOnly: true,
        label: '이 주소에서 다시 볼 수 있어요',
        say: '로그인하면 맨 위 [사용 안내]에서도 열려요',
        notes:
          '이 주소로 들어오시면 됩니다. 로그인한 뒤 위 메뉴의 사용 안내를 누르면 오늘 본 것을 한 장씩 다시 넘겨 볼 수 있습니다. 질문 받겠습니다.',
      },
    ],
  },
];

/** 말풍선으로 읽히는 단계 — 그림 단계와 알림 카드. 이름은 16자, 문장은 32자까지(PG-T84) */
export const isCoachStep = (s: GuideStep) => s.kind === 'shot' || s.kind === 'message';

// ── 펼치기 ──────────────────────────────────────────────────────────────────

/** 발표·혼자 보기가 공통으로 쓰는 한 장 */
export interface Slide {
  /** 주소 조각 — 장 카드는 `lead`, 단계는 `lead-3` (이야기 순서의 장 안 **전체** 순번 — 사람·방식마다 같다) */
  key: string;
  /** 이 장을 보여 줄 장 — 혼자 보기에서 `selfHome`으로 옮긴 단계면 옮겨 간 장 */
  chapter: GuideChapter;
  /** 장 카드면 null */
  step: GuideStep | null;
  /** 그 방식에서 장 안의 순번(1부터) — 「부서담당자 3/5」의 3. 장 카드는 0 */
  n: number;
  /** 그 방식에서 장 안의 단계 수 — 「3/5」의 5 */
  of: number;
}

const whoOf = (c: GuideChapter, s: GuideStep): GuideCap => s.who ?? c.who;

/** 장 카드가 있는 장 = 역할 장 (부서원 → 총괄). 장 카드의 「지금 여기」 줄이 쓴다 */
export function roleChapters(deck: readonly GuideChapter[] = DECK): GuideChapter[] {
  return deck.filter((c) => c.lede);
}

/** 발표 모드 — **모든 장**, 역할 장 앞에 장 카드 (PG-59). 혼자 보기 전용 단계(`selfOnly`)는 뺀다 */
export function presentSlides(deck: readonly GuideChapter[] = DECK): Slide[] {
  return deck.flatMap((c) => {
    const shown = c.steps.map((s, i) => ({ s, i })).filter(({ s }) => !s.selfOnly);
    return [
      ...(c.lede ? [{ key: c.id, chapter: c, step: null, n: 0, of: shown.length }] : []),
      ...shown.map(({ s, i }, k) => ({ key: `${c.id}-${i + 1}`, chapter: c, step: s, n: k + 1, of: shown.length })),
    ];
  });
}

export interface SelfChapter {
  chapter: GuideChapter;
  /** 이 사람이 쓰는 단계만 — 주소 조각(key)은 이야기 순서 기준 그대로 */
  slides: Slide[];
  /** 내 역할의 장 — 목차에서 맨 앞에 펼쳐 둔다 */
  mine: boolean;
}

/**
 * PG-61 — 혼자 보기의 장 목록. **이 사람이 쓰는 단계만**(TACP-9), **내 역할의 장이 맨 앞**.
 *
 * 「내 장」은 그 장의 주인(`who`)이 이 사람인 장이다 — 볼 단계가 하나 있다고 내 장이 아니다. 예전에는 담당자에게
 * 「실·팀장 · 내 역할」이 붙었다(그 장의 「위로 제출」 한 단계 때문에). 그 단계는 이제 `selfHome`으로 담당자 장에 둔다.
 * 그런 장이 없는 사람(부서원)은 부서원 장이 자기 장이다. 나머지는 이야기 순서 그대로 뒤에 둔다 —
 * 담당자가 처음 열었을 때 자기 일보다 부서원 작성법이 먼저 나오면 「나는 해당 없네」 하고 닫는다.
 */
export function selfChapters(caps: Iterable<GuideCap>, deck: readonly GuideChapter[] = DECK): SelfChapter[] {
  const has = new Set<GuideCap>(caps);
  has.add('all');
  const home = new Map<ChapterId, { step: GuideStep; key: string }[]>();
  for (const c of deck) {
    c.steps.forEach((s, i) => {
      if (s.presentOnly || !has.has(whoOf(c, s))) return;
      const to = s.selfHome && deck.some((d) => d.id === s.selfHome) ? s.selfHome : c.id;
      home.set(to, [...(home.get(to) ?? []), { step: s, key: `${c.id}-${i + 1}` }]);
    });
  }
  const visible = deck
    .filter((c) => home.has(c.id))
    .map((c) => {
      const list = home.get(c.id)!;
      return { chapter: c, slides: list.map(({ step, key }, k) => ({ key, chapter: c, step, n: k + 1, of: list.length })) };
    });
  const own = (c: GuideChapter) => c.who !== 'all' && has.has(c.who);
  const ownIds = new Set(
    (visible.some((c) => own(c.chapter)) ? visible.filter((c) => own(c.chapter)) : visible.filter((c) => c.chapter.id === 'member')).map(
      (c) => c.chapter.id,
    ),
  );
  return [
    ...visible.filter((c) => ownIds.has(c.chapter.id)).map((c) => ({ ...c, mine: true })),
    ...visible.filter((c) => !ownIds.has(c.chapter.id)).map((c) => ({ ...c, mine: false })),
  ];
}

/** 그림이 있는 단계 — 찍기·무결성 검사가 쓴다 */
export function shotSteps(deck: readonly GuideChapter[] = DECK): Extract<GuideStep, { kind: 'shot' }>[] {
  return deck.flatMap((c) => c.steps).filter((s): s is Extract<GuideStep, { kind: 'shot' }> => s.kind === 'shot');
}
