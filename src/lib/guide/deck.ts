// PG-57 · PG-83 — 사용 안내의 **단계 목록 하나.** 발표 모드(/guide/present)와 체험하기(/guide)가 이것 하나를 쓴다.
//
// 장의 순서는 기능 목록이 아니라 **한 주의 이야기**다: 부서원이 적어 내고 → 담당자가 모으고 → 실·팀장이 승인하고 →
// 본부장이 승인하고 → 총괄이 전사본을 받는다. 2026-10-08(ADR-0015 · RU-84)부터 승인이 곧 위로 가는 제출이다 — 본부본·전사본은
// 저절로 만들어진다. 그래서 「위로」 단계는 누르는 버튼이 아니라 **상태 줄**을 밝힌다(`target: 'area'`).
//
// 2026-10-08 v2(PG-83) — **장 = 능력, 역할이 쌓인다.** 체험하기는 부서원(누구나) → + 부서담당자 → + 실·팀장 → + 본부 → + 총괄 중
// 이 사람이 가진 장만 **이야기 순서 그대로** 보인다. 예전의 「내 역할 장 맨 앞」 정렬과 단계 옮기기(`selfHome`)는 없앴다 — 장이
// 짧아져(3~8단계) 순서가 곧 흐름이고, 부서장이 자기 장을 열려면 담당자 장을 지나는 것이 실제 일의 순서와 같다.
//
// 단계의 글은 두 토막뿐이다 — 게임 튜토리얼의 말풍선(사용자: 「인벤토리: 습득한 아이템은 여기서 확인할 수 있어요」처럼):
//   label  화면에 보이는 **그 글자** — 말풍선의 굵은 머리. **13자까지**(v2). 화면과 다른 낱말은 대조를 시키므로 지어내지 않는다.
//          화면의 버튼 이름이 13자를 넘으면(「계획 2줄을 이번 주 실적으로」) 그 버튼이 놓인 판의 이름(「지난번에 낸 것」)을 쓴다
//   say    친근한 한 문장, 해요체 — **30자까지**, 생각 하나. 둘째 생각은 체험하기의 「자세히」(`more`)로
// 발표자가 말할 것은 `notes`(발표자 창에만).
//
// 그림은 데이터가 아니라 산출물이다: `node scripts/guide-capture.cjs`가 가짜 DB로 앱을 몰아 `anchor`(구멍)와
// `frame`(카메라)의 사각형을 재고 `public/guide/deck/<id>.webp`와 `manifest.json`을 만든다(PG-62). 그래서 여기에는
// 좌표가 없다. 단계는 **지금 화면에 있는 앵커만** 가리킨다(v2 — 앵커를 새로 달지 않았다). 앵커(`data-guide`)가 사라지면
// 테스트가 먼저 깨진다(PG-63). 단계 순서는 **누르면 다음 화면**이 되게 놓았다.

/**
 * 이 단계를 **쓰는 사람**. 체험하기는 이 사람이 쓰는 단계만 그린다(TACP-9). 누가 무엇을 갖는지는
 * `authz.ts`의 `guideCaps`가 정한다(TACP-12) — 여기서는 이름만 붙인다.
 */
export type GuideCap =
  | 'all' // 누구나 — 부서원 장
  | 'manager' // 부서 문서를 다루는 사람 (lead·head, TACP-16) — 부서담당자 장
  | 'head' // 병합본 승인 (isReviewer, HM-47) — 실·팀장 장
  | 'report' // 「위로」 상태 카드 (canSeeHandoff + 3단계 켜짐, TACP-21 v1.7 · RU-80)
  | 'hq' // 본부 취합 (hasHqDesk) — 본부 장
  | 'org' // 「전사」 화면 (orgPageView.open) — 총괄 장
  | 'orgDesk' // 전사 취합 (canOpenOrgDesk)
  | 'schedule'; // 주차 마감 바꾸기 (canScheduleDeadlines, TACP-20)

export type ChapterId = 'intro' | 'why' | 'member' | 'lead' | 'head' | 'hq' | 'org' | 'outro';
/** 역할 장 — 체험하기·둘러보기가 쌓는 장. 이야기 순서다 (PG-83) */
export type RoleChapterId = 'member' | 'lead' | 'head' | 'hq' | 'org';

/** 장 순서 — 이야기 순서다. 테스트가 이 순서를 고정한다(PG-T84) */
export const CHAPTER_ORDER: readonly ChapterId[] = ['intro', 'why', 'member', 'lead', 'head', 'hq', 'org', 'outro'];
export const ROLE_CHAPTERS: readonly RoleChapterId[] = ['member', 'lead', 'head', 'hq', 'org'];

/** 말풍선 글의 한도 (PG-83) — 이름 13자 · 문장 30자. 글자 슬라이드의 큰 줄은 24자 */
export const LABEL_MAX = 13;
export const SAY_MAX = 30;
export const TITLE_MAX = 24;

interface StepBase {
  /** 그림 파일 이름이자 manifest의 키 — 바꾸면 다시 찍어야 한다 */
  id: string;
  /** 말풍선의 굵은 머리 — **화면에 보이는 그 글자**, 13자까지. 글자 슬라이드(표지·왜·정리·주소)에서는 큰 제목(24자) */
  label: string;
  /** 친근한 한 문장, 해요체 — 30자까지, 생각 하나. 말풍선에서 「label: say」로 이어 읽힌다 */
  say: string;
  /** 체험하기의 「자세히」 한 줄 — 없어도 된다. 발표 무대에는 그리지 않는다 */
  more?: string;
  /** 발표자 메모 — 발표자 창에만 */
  notes: string;
  /** 없으면 장의 `who` */
  who?: GuideCap;
  /** 발표에서만 — 표지·왜·로그인·마무리·주소. 체험하기는 이미 로그인한 사람이 자기 일을 따라 보는 곳이다 (PG-83) */
  presentOnly?: boolean;
  /**
   * 체험하기에서만 — 발표에서 빼는 단계. 강당에서는 한 주의 끝(전사본 받기)이 장의 마지막 무게여야 하는데,
   * 드문 일(연휴 마감 미리보기·분류 순서 설정)을 넘기면 이야기의 끝이 흐려진다
   */
  selfOnly?: boolean;
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
       * 무엇을 보이는 단계인가 — 누르는 것(`button`)인가, 보기만 하는 것(`area` — 칩·합계·상태 줄)인가.
       * `button`이면 누르라는 손이 붙는다
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
  /** 목차·도크·구석 알약의 이름 — 「부서담당자 3/5」 */
  title: string;
  /** 장 카드의 한 줄(「이번엔 ○○ 차례예요」 밑). 있는 장이 역할 장이다(표지·왜·마무리에는 없다) */
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
        presentOnly: true,
        label: '지금은 hwp를 메일로 주고받아요',
        say: '모으고 합치는 건 모두 손으로 했어요',
        notes:
          '지금까지는 매주 목요일마다 hwp 파일이 메일로 오갔습니다. 담당자는 파일을 하나씩 열어 복사해 붙였고, 본부와 기획조정실은 그걸 또 합쳤습니다. 누가 안 냈는지 세는 일, 늦게 온 파일을 다시 끼워 넣는 일도 모두 사람 몫이었습니다.',
      },
      {
        id: 'why-after',
        kind: 'flow',
        presentOnly: true,
        label: '적는 건 웹, 모으는 건 Tincase',
        say: '승인하면 자동으로 위로 올라가요',
        flow: [
          { who: '부서원', what: '적고 제출' },
          { who: '부서담당자', what: '병합본 다듬기' },
          { who: '실·팀장', what: '검토·승인' },
          { who: '본부', what: '본부장 승인' },
          { who: '총괄', what: '전사본 받기' },
        ],
        notes:
          '바뀌는 것은 적는 곳 하나입니다. 부서원은 웹에서 표에 적고 제출을 누릅니다. 마감이 지나면 부서 병합본이 저절로 만들어지고, 부서담당자가 다듬습니다. 실·팀장이 고쳐 저장하거나 승인하면 그 판이 바로 본부로 올라가고, 본부본은 저절로 모입니다. 본부장이 승인하면 총괄로 가고, 전사본은 늘 준비돼 있습니다. 사람이 하는 일은 승인 두 번이고, 그 사이를 옮기는 일은 Tincase가 합니다. 이제 이 순서대로 화면을 보겠습니다.',
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
        // 체험하기는 이미 로그인한 사람이 연다 — 로그인은 강당에서만 (PG-83)
        presentOnly: true,
        label: '로그인',
        say: 'KEI 이메일과 받은 비밀번호로 들어와요',
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
        say: '이번 주 일지는 여기서 써요',
        more: '마감 시각은 카드 위에 늘 보여요',
        notes:
          '로그인하면 바로 이 화면, 홈입니다. 왼쪽 카드가 이번 주이고, 맨 위에 주차와 마감이 있습니다. 할 일은 카드 안의 초록 버튼 하나, 작성하기입니다.',
      },
      {
        id: 'member-compose',
        kind: 'shot',
        anchor: 'compose-first',
        frame: 'compose-table',
        // 표의 왼쪽 700px — 「1. 주요 업무실적」 제목·「업무 내용」 머리글·첫 칸
        frameClip: { w: 700 },
        target: 'button',
        screen: 'composer',
        label: '업무 내용',
        say: '한글 표를 복사해 붙여넣어요',
        more: '여러 줄이 한 번에 들어가요 · 직접 적어도 돼요',
        notes:
          '작성 화면은 한글 양식의 표와 같은 모양입니다. 실적, 계획, 특이사항 세 표가 있고, 점선 칸이 붙여넣는 자리입니다. 한글에서 쓰던 표를 통째로 복사해 여기 붙여넣으면 줄이 나뉘어 들어갑니다. 직접 적어도 됩니다.',
      },
      {
        id: 'member-previous',
        kind: 'shot',
        anchor: 'previous-to-achievements',
        frame: 'previous-panel',
        // 버튼이 머리줄 끝(오른쪽)에 있다 — 판의 오른쪽 700px(지난번에 낸 줄들이 같이 보인다)
        frameClip: { w: 700, right: true },
        target: 'button',
        screen: 'composer',
        // 버튼 이름(「계획 2줄을 이번 주 실적으로」 16자)은 13자를 넘는다 — 그 버튼이 놓인 판의 이름을 머리로 쓴다(PG-83)
        label: '지난번에 낸 것',
        say: '버튼 하나로 계획을 실적에 넣어요',
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
        say: '전 직원이 알 일이면 눌러요',
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
        say: '다 적었으면 눌러요',
        more: '부서 양식(hwp)으로 만들어져 담당자에게 모여요',
        notes: '다 적었으면 오른쪽 아래 제출을 누릅니다. 이걸로 부서 양식 hwp가 만들어져 담당자에게 모입니다.',
      },
      {
        id: 'member-done',
        kind: 'shot',
        anchor: 'compose-open',
        frame: 'week-card',
        target: 'button',
        label: '열기',
        say: '낸 것을 열어 고쳐 낼 수 있어요',
        more: '고쳐서 내면 새 버전 · 마감 전엔 제출 취소도 돼요',
        notes:
          '제출하면 카드에 제출 완료가 붙고 버튼이 열기로 바뀝니다. 열기를 누르면 방금 낸 내용이 채워진 채로 열립니다. 고칠 칸만 고쳐 내면 새 버전이 되고, 병합에는 마지막 것이 들어갑니다. 마감 전이면 제출 취소도 할 수 있습니다.',
      },
      {
        id: 'member-past',
        kind: 'shot',
        anchor: 'past-open',
        frame: 'past-weeks',
        frameClip: { w: 700, right: true },
        target: 'button',
        label: '내 일지',
        say: '지난 주에 낸 것도 여기 있어요',
        more: '같은 줄 [병합본]은 부서가 합친 문서예요',
        notes:
          '같은 화면 오른쪽 지난 주차에는 지난 주가 달마다 묶여 있습니다. 내 일지로 그 주에 낸 것을 열고, 병합본으로 부서가 합친 문서를 봅니다. 부서원 순서는 여기까지입니다.',
      },
    ],
  },
  {
    id: 'lead',
    title: '부서담당자',
    lede: '누가 냈는지 보고, 병합본을 다듬어요',
    notes:
      '다음은 부서담당자입니다. 부서원이 낸 것이 담당자에게 모입니다. 화면 위 메뉴에 제출과 수합 관리가 있고, 수합 관리에서 일합니다.',
    who: 'manager',
    steps: [
      {
        id: 'lead-nudge',
        kind: 'shot',
        anchor: 'copy-missing',
        frame: 'status-card',
        frameClip: { w: 700 },
        target: 'button',
        screen: 'lead-manage',
        label: '미제출 2명 이름 복사',
        say: '메신저에 붙여 알려요',
        more: 'Tincase도 마감 전에 안 낸 사람에게 알려요',
        notes:
          '수합 관리 맨 위 카드가 이번 주 제출 현황, 몇 명 중 몇 명이 냈는지입니다. 독촉은 이름 복사 하나면 됩니다. 메신저에 붙여넣으세요. Tincase도 마감 전날 점심 전, 한 시간 전, 십 분 전에 아직 안 낸 사람에게만 알림을 보냅니다.',
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
        more: '늦게 낸 사람이 있으면 [다시 병합]을 눌러요',
        notes:
          '목요일 두 시 일 분이면 병합본이 저절로 만들어집니다. 부서들이 한 줄로 서서 차례로 합쳐지므로, 앞 부서를 기다리는 동안에는 카드에 대기 중과 몇 번째인지가 보입니다. 여러 사람이 같은 회의를 적었으면 한 줄로 묶고, 확인이 필요한 곳은 따로 알려 줍니다. 마감 뒤에 늦게 낸 사람이 있으면 다시 병합을 누르면 됩니다. 누르면 그 줄에 서고 버튼에 몇 번째인지 보입니다. 병합본을 이미 고쳤다면 고친 내용이 사라지므로 한 번 더 묻습니다.',
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
          '내용 보기를 누르면 병합본이 화면에 열립니다. 이상한 줄이 보이면 한글을 열 필요 없이 그 칸을 눌러 고치고 수정 저장을 누릅니다. 순서도 끌어서 바꿉니다. 여기서 고쳐도 부서원이 낸 원본은 바뀌지 않습니다.',
      },
      {
        id: 'lead-handoff',
        kind: 'shot',
        anchor: 'report-unit-submit',
        frame: 'report-unit',
        frameClip: { w: 700 },
        // RU-80 — 누르는 버튼이 아니라 상태 줄이다. 담당자가 누를 것은 없다
        target: 'area',
        screen: 'lead-manage',
        who: 'report',
        // 화면의 카드 제목 「{받는 곳}에 올라가는 병합본」의 뒷부분 — 받는 곳 이름을 빼야 13자 안이다
        label: '올라가는 병합본',
        say: '부서장이 승인하면 저절로 올라가요',
        more: '본부가 없는 부서는 총괄로 바로 가요',
        notes:
          '병합본 카드 아래가 위로 올라가는 상태입니다. 부서장이 승인하는 순간 그 병합본이 본부로 올라갑니다. 담당자가 따로 누를 것은 없습니다. 본부가 없는 부서는 총괄로 바로 갑니다.',
      },
      {
        id: 'lead-rules',
        kind: 'shot',
        anchor: 'merge-categories',
        frame: 'merge-settings',
        frameClip: { h: 400 },
        target: 'area',
        selfOnly: true,
        label: '분류 순서',
        say: '한 번 적으면 매주 이 순서예요',
        more: '[부서 설정]은 수합 관리 오른쪽 위에 있어요',
        notes:
          '매주 손으로 줄을 옮기던 일은 부서 설정에서 한 번 정해 둡니다. 분류 순서를 적으면 병합본이 그 순서로 묶이고, 다음 병합부터 그대로 따릅니다.',
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
        more: '병합이 된 때만 와요 · [수합 관리]에서 열어요',
        message: {
          from: 'Tincase',
          subject: '[Tincase] {week} 주간 병합본 검토 부탁드려요',
          lines: ['{week} 주간 업무일지 병합본이 준비됐어요.', 'Tincase에서 내용을 확인하고 고칠 부분을 알려주세요.'],
        },
        notes:
          '목요일 두 시 십 분, 실장님 팀장님께 메신저로 이 알림이 갑니다. 병합이 성공했을 때만 갑니다. 알림을 받으면 Tincase의 수합 관리에서 병합본을 엽니다.',
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
        more: '줄마다 누가 냈는지 작성자 열에 보여요',
        notes:
          '병합본 카드에 부서장 승인 전이라고 붙어 있습니다. 내용 보기를 누르면 병합본이 열리고, 작성자 열에 줄마다 누가 썼는지 보입니다.',
      },
      {
        id: 'head-save',
        kind: 'shot',
        anchor: 'merged-save',
        frame: 'merged-head',
        frameClip: { w: 700, right: true },
        target: 'button',
        label: '수정 저장',
        say: '고쳐 저장하면 그게 승인이에요',
        more: '한글로 받아 고칠 필요 없어요',
        notes:
          '고칠 곳이 있으면 그 칸을 눌러 바로 고치고 수정 저장을 누르시면 됩니다. 따로 승인을 누를 필요 없이 그 저장이 승인이고, 그 판이 바로 위로 올라갑니다. 담당자에게는 어디가 바뀌었는지 알림이 갑니다.',
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
        more: '승인 뒤 바뀌면 다시 승인해 달라는 알림이 가요',
        notes:
          '고칠 것이 없으면 이 버튼 하나입니다. 부서장에게만 보이는 버튼이고, 누르는 순간 이 병합본이 위로 올라갑니다. 승인한 뒤에 누가 늦게 내서 병합본이 바뀌면 다시 승인해 달라는 알림이 갑니다.',
      },
      {
        id: 'head-sent',
        kind: 'shot',
        anchor: 'report-unit-submit',
        frame: 'report-unit',
        frameClip: { w: 700 },
        target: 'area',
        who: 'report',
        label: '올라감',
        say: '승인하면 바로 위로 올라가요',
        more: '본부 도착 · 본부장 승인 시각도 여기 보여요',
        notes:
          '승인이 나는 순간 그 병합본이 위로 올라갑니다. 수합 관리의 카드에 올라감과 시각, 승인한 사람이 찍히고, 그 밑에 본부 도착, 본부장 승인 시각이 이어집니다.',
      },
    ],
  },
  {
    id: 'hq',
    title: '본부',
    lede: '본부본이 저절로 모이면 승인만 해요',
    notes: '실·팀장이 승인한 병합본은 저절로 본부로 갑니다. 본부 담당자와 본부장님께는 [본부 취합] 메뉴가 있습니다.',
    who: 'hq',
    steps: [
      {
        id: 'hq-units',
        kind: 'shot',
        anchor: 'hq-units',
        target: 'area',
        screen: 'hq',
        // 카드 전체가 볼 것이다 — 발표에서는 바로 다음 단계와 같은 화면이라 뺀다
        selfOnly: true,
        label: '산하 현황',
        say: '승인된 실·팀이 저절로 모여요',
        more: '이어 붙이는 순서는 한 번 정하면 매주 그대로예요',
        notes:
          '본부 취합 화면 맨 위에 산하 실·팀이 올라왔는지, 언제 누가 승인했는지 한 줄씩 보입니다. 위에서부터 이 순서대로 문서에 들어갑니다.',
      },
      {
        id: 'hq-run',
        kind: 'shot',
        anchor: 'hq-run-button',
        frame: 'hq-run-head',
        frameClip: { w: 700 },
        // RU-82 — [이어 붙이기]는 없다. 본부본은 실·팀이 올라올 때마다 저절로 이어 붙는다 — 상태 줄을 밝힌다
        target: 'area',
        screen: 'hq',
        label: '자동으로 이어 붙임',
        say: '본부본은 저절로 모여요',
        more: '늦게 올라온 실·팀도 저절로 들어가요',
        notes:
          '실·팀장이 승인하는 순간 그 병합본이 올라오고, 본부본이 정한 순서대로 저절로 이어 붙습니다. 상태 줄에 언제 다시 이어 붙었는지와 산하 몇 곳이 들어왔는지가 보입니다. 본부는 실·팀 안의 내용을 고치지 않습니다.',
      },
      {
        id: 'hq-approve',
        kind: 'shot',
        anchor: 'hq-approve',
        frame: 'hq-approval',
        // 버튼이 줄 끝(오른쪽)에 있다 — 오른쪽에서 772px
        frameClip: { w: 772, right: true },
        target: 'button',
        screen: 'hq',
        label: '검토 완료 · 승인',
        say: '승인하면 바로 총괄로 가요',
        more: '본부장에게만 보이는 버튼이에요',
        notes:
          '본부장님은 본부본을 받아 보시고 검토 완료 승인을 누릅니다. 누르는 순간 그 본부본이 총괄로 갑니다. 본부 담당자가 따로 누를 것은 없습니다.',
      },
      {
        id: 'hq-sent',
        kind: 'shot',
        anchor: 'report-hq-submit',
        frame: 'report-hq',
        frameClip: { w: 700 },
        target: 'area',
        screen: 'hq',
        label: '승인 · 총괄로 감',
        say: '이걸로 본부 일은 끝이에요',
        more: '승인 뒤 본부본이 바뀌면 주황으로 보여요',
        notes:
          '승인이 끝나면 같은 카드 아래 총괄 줄에 승인 · 총괄로 감과 시각이 찍힙니다. 이걸로 본부의 일은 끝입니다. 그 뒤에 실·팀이 다시 올려 본부본이 바뀌면 주황으로 알려 줍니다.',
      },
    ],
  },
  {
    id: 'org',
    title: '총괄',
    lede: '전사 제출을 보고 전사본을 받아요',
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
        more: '막대를 누르면 안 낸 사람이 펼쳐져요',
        notes:
          '기획조정실 총괄 화면, 전사입니다. 맨 위 합계가 전사에서 몇 명이 냈는지입니다. 전사가 전사본 섹션 순서대로 한 줄씩 있고, 줄마다 몇 명이 냈는지 막대로 보입니다. 막대를 누르면 안 낸 사람이 펼쳐지고 안내문 복사로 바로 알릴 수 있습니다.',
      },
      {
        id: 'org-run',
        kind: 'shot',
        anchor: 'org-run-button',
        frame: 'org-run',
        frameClip: { w: 700 },
        // RU-83 — [전사 취합본 만들기]는 없다. 섹션이 들어올 때마다 저절로 다시 만들어진다 — 상태 줄을 밝힌다
        target: 'area',
        screen: 'org-run',
        who: 'orgDesk',
        label: '전사본',
        say: '들어온 섹션으로 늘 준비돼 있어요',
        more: '빠진 섹션은 「미제출」로 자리만 남아요',
        notes:
          '맨 아래 전사본 카드입니다. 본부장이 승인할 때마다 Tincase가 들어온 섹션을 순서대로 한 문서로 다시 만듭니다. 누를 버튼이 없습니다. 안 온 섹션은 미제출로 자리만 남습니다.',
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
        say: '받아서 게시판에 올려요',
        more: '받은 뒤 바뀌면 주황으로 알려요 · 다시 받으면 돼요',
        notes:
          '전사본 받기로 한글 파일을 받아 열어 보고 게시판에 올리면 한 주가 끝납니다. 받은 뒤에 늦게 들어온 섹션이 있어 전사본이 다시 만들어지면 주황으로 알려 드립니다.',
      },
      {
        id: 'org-schedule',
        kind: 'shot',
        anchor: 'deadline-paste',
        frame: 'deadline-paste-box',
        target: 'area',
        who: 'schedule',
        label: '공지 붙여넣기',
        say: '연휴엔 공지를 그대로 붙여요',
        more: '[일정 바꾸기]에서 열려요 · 날짜·시각을 알아서 읽어요',
        notes:
          '연휴로 마감이 당겨지는 주에는 일정 바꾸기를 엽니다. 게시판에 올리는 작성 요청 공지를 그대로 붙여넣으면 날짜와 시각을 읽습니다.',
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
        say: '그 주만 마감이 바뀌어요',
        more: '다음 주는 평소대로예요',
        notes:
          '미리보기에서 어느 주차 마감이 언제로 바뀌는지 먼저 확인합니다. 이대로 적용을 누르면 그 주만 전 부서 마감이 바뀌고, 부서원 화면의 마감이 빨갛게 바뀌며 이유가 한 줄 붙습니다.',
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
        presentOnly: true,
        label: '한 주에 누르는 버튼은 이것뿐이에요',
        say: '모르면 맨 위 [사용 안내]를 다시 열어요',
        rows: [
          { who: '부서원', buttons: ['작성하기', '제출'] },
          { who: '부서담당자', buttons: ['내용 보기', '수정 저장'] },
          { who: '실·팀장', buttons: ['수정 저장', '고칠 것 없음 · 승인'], or: true },
          { who: '본부', buttons: ['검토 완료 · 승인'] },
          { who: '총괄', buttons: ['전사본 받기'] },
        ],
        notes:
          '정리하면 사람마다 누르는 버튼은 두 개 남짓이고, 본부와 총괄은 하나입니다. 마감은 매주 목요일 두 시, 병합은 그 1분 뒤 저절로 됩니다. 승인하면 위로 올라가는 것, 본부본과 전사본을 만드는 것도 저절로 됩니다. 처음 로그인하면 화면 구석에 30초 둘러보기도 뜹니다.',
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

/** 말풍선으로 읽히는 단계 — 그림 단계와 알림 카드. 이름은 13자, 문장은 30자까지(PG-T147) */
export const isCoachStep = (s: GuideStep) => s.kind === 'shot' || s.kind === 'message';

// ── 펼치기 ──────────────────────────────────────────────────────────────────

/** 발표·체험하기가 공통으로 쓰는 한 장 */
export interface Slide {
  /** 주소 조각 — 장 카드는 `lead`, 단계는 `lead-3` (이야기 순서의 장 안 **전체** 순번 — 사람·방식마다 같다) */
  key: string;
  chapter: GuideChapter;
  /** 장 카드면 null */
  step: GuideStep | null;
  /** 그 방식에서 장 안의 순번(1부터) — 「부서담당자 3/5」의 3. 장 카드는 0 */
  n: number;
  /** 그 방식에서 장 안의 단계 수 — 「3/5」의 5 */
  of: number;
}

const whoOf = (c: GuideChapter, s: GuideStep): GuideCap => s.who ?? c.who;

/** 장 카드가 있는 장 = 역할 장 (부서원 → 총괄). 장 카드의 「지금 여기」 칩이 쓴다 */
export function roleChapters(deck: readonly GuideChapter[] = DECK): GuideChapter[] {
  return deck.filter((c) => c.lede);
}

/**
 * PG-83 · PG-T145 — **가진 역할 장**, 이야기 순서. 체험하기와 둘러보기(PG-84)가 같은 쌓기를 쓴다 —
 * 장의 주인(`who`)을 가진 사람에게 그 장이 있다. 부서원 장(`all`)은 누구에게나 맨 앞이다
 */
export function stackedChapters(caps: Iterable<GuideCap>, deck: readonly GuideChapter[] = DECK): RoleChapterId[] {
  const has = new Set<GuideCap>(caps);
  has.add('all');
  return roleChapters(deck)
    .filter((c) => has.has(c.who))
    .map((c) => c.id as RoleChapterId);
}

/** 발표 모드 — **모든 장**, 역할 장 앞에 장 카드 (PG-59). 체험하기 전용 단계(`selfOnly`)는 뺀다 */
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
}

/**
 * PG-83 — 체험하기의 장 목록. **가진 역할 장만, 이야기 순서 그대로 쌓는다**(TACP-9). 장 안에서도 이 사람이 쓰는 단계만
 * (`who`) — 「위로」 상태(`report`)·전사본(`orgDesk`)·일정(`schedule`). 발표 전용(표지·왜·로그인·마무리·주소)은 없다.
 */
export function selfChapters(caps: Iterable<GuideCap>, deck: readonly GuideChapter[] = DECK): SelfChapter[] {
  const has = new Set<GuideCap>(caps);
  has.add('all');
  const mine = new Set<ChapterId>(stackedChapters(has, deck));
  return deck
    .filter((c) => mine.has(c.id))
    .map((c) => {
      const list = c.steps.map((s, i) => ({ s, i })).filter(({ s }) => !s.presentOnly && has.has(whoOf(c, s)));
      return { chapter: c, slides: list.map(({ s, i }, k) => ({ key: `${c.id}-${i + 1}`, chapter: c, step: s, n: k + 1, of: list.length })) };
    })
    .filter((c) => c.slides.length > 0);
}

/** 그림이 있는 단계 — 찍기·무결성 검사가 쓴다 */
export function shotSteps(deck: readonly GuideChapter[] = DECK): Extract<GuideStep, { kind: 'shot' }>[] {
  return deck.flatMap((c) => c.steps).filter((s): s is Extract<GuideStep, { kind: 'shot' }> => s.kind === 'shot');
}
