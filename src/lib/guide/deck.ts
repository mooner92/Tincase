// PG-57 — 사용 안내의 **단계 목록 하나.** 발표 모드(/guide/present)와 혼자 보기(/guide)가 이것 하나를 쓴다.
//
// 장의 순서는 기능 목록이 아니라 **한 주의 이야기**다: 부서원이 적어 내고 → 담당자가 모으고 → 실·팀장이 승인하고 →
// 본부가 이어 붙이고 → 총괄이 전사본을 만든다. 강당에서 처음 보는 사람에게는 「버튼이 무엇을 하나」보다
// 「내 일이 이 흐름의 어디인가」가 먼저 들어가야 한다. 기능별로 나누면 흐름이 안 보인다.
//
// 제목(caption)은 프로젝터에서 한 줄로 읽히게 **24자까지**. 본문(body)은 혼자 볼 때 읽는 2–3줄,
// 메모(notes)는 발표자가 말할 것. 버튼 이름은 **지금 화면 그대로** 적는다 — 화면과 다른 낱말은 대조를 시킨다
// (「[승인]」이라고 적으면 강당에서는 화면의 「고칠 것 없음 · 승인」과 다른 버튼을 찾는다).
// 역할 이름도 화면을 따른다: 이름표로 쓸 때는 「부서담당자」, 화면이 「부서장」이라 부르는 사람은 장 제목이 「실·팀장」이어도
// 부제에 「부서장」을 밝힌다. 문서 이름은 「전사본」 — 「최종본에」는 화면의 열 이름일 때만 따옴표로.
//
// 그림은 데이터가 아니라 산출물이다: `node scripts/guide-capture.cjs`가 가짜 DB로 앱을 몰아 `anchor`(스포트라이트)와
// `frame`(카메라)의 사각형을 재고 `public/guide/deck/<id>.webp`와 `manifest.json`을 만든다(PG-62). 그래서 여기에는
// 좌표가 없다 — 화면이 바뀌면 다시 찍으면 되고, 앵커(`data-guide`)가 사라지면 테스트가 먼저 깨진다(PG-63).

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
  /** 한 줄 제목 — **24자까지**(PG-T84). 프로젝터에서 줄임표(…) 없이 한 줄로 읽혀야 한다 */
  caption: string;
  /** 혼자 보기의 본문 2–3줄 */
  body: string[];
  /** 발표자 메모 */
  notes: string;
  /** 없으면 장의 `who` */
  who?: GuideCap;
  /** 발표에서만 — 혼자 보기에는 뜻이 없는 단계(표지·주소: 혼자 보기는 페이지 머리가 표지다) */
  presentOnly?: boolean;
  /**
   * 혼자 보기에서만 — 발표에서 빼는 단계. 강당에서는 한 주의 끝(전사본 받기)이 장의 마지막 무게여야 하는데,
   * 드문 일(연휴 마감)을 미리보기 표까지 넘기면 이야기의 끝이 흐려진다. 발표는 「이럴 때 여기서 바꾼다」 한 장만 두고,
   * 세부는 그 일을 하는 사람이 혼자 보기에서 본다
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
 * 프레임 자르기 (그림 좌표 CSS px, 앵커 사각형 기준). 카드 하나가 다 담기면 카메라가 덜 다가가 글자가 작아진다 —
 * 프로젝터에서 읽히려면 누를 곳 둘레 700px 남짓만 담아야 한다(PG-58). `y`는 위에서 건너뛸 높이,
 * `right`면 오른쪽 끝에서 `w`만큼(버튼이 줄 끝에 있는 카드)
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
      /** 스포트라이트 — `data-guide` 값 (CP-104) */
      anchor: string;
      /** 카메라가 담을 곳 — 없으면 스포트라이트 둘레 */
      frame?: string;
      /** 카메라 사각형을 줄인다 — 찍을 때 적용해 manifest에 남는다 */
      frameClip?: FrameClip;
      /** 스포트라이트 사각형을 줄인다 — 앵커가 창보다 큰 표·드로어 본문일 때 보이는 윗부분만 감싼다 */
      focusClip?: FrameClip;
      /**
       * 무엇을 보이는 단계인가 — 버튼 하나(`button`)면 무대에서 UI 글자가 30px 이상(배율 2.0)이 되도록 다가가고,
       * 영역(`area` — 표·카드 전체)이면 1.4배 이상이다. 테스트가 이 기준으로 카메라를 잰다(PG-T88)
       */
      target: 'button' | 'area';
      /** 같은 화면의 연속 단계 — 카메라만 옮긴다 (CP-101) */
      screen?: string;
    })
  | (StepBase & { kind: 'cover' })
  | (StepBase & { kind: 'points'; points: string[] })
  | (StepBase & { kind: 'flow'; flow: { who: string; what: string }[] })
  | (StepBase & {
      kind: 'message';
      /** 사내 메신저 알림 모양 — `{week}`는 그림을 찍은 주차로 바뀐다(manifest.week) */
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
  /** 목차·진행 표시의 이름 — 「부서담당자 · 3/5」 */
  title: string;
  /** 장 제목 슬라이드의 한 줄. 없으면 장 제목 슬라이드를 두지 않는다(표지·왜·마무리) */
  lede?: string;
  /** 장 제목 슬라이드의 발표자 메모 — 앞 장에서 이 장으로 넘어가는 말 */
  notes?: string;
  who: GuideCap;
  steps: GuideStep[];
}

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
        caption: '업무일지를 웹에서 쓰고, 한 번에 모읍니다',
        body: ['Tincase 사용 안내 · 한국환경연구원 주간 업무일지', '화면 속 이름과 업무는 모두 안내용으로 지어낸 것입니다.'],
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
        kind: 'points',
        caption: '매주 hwp를 주고받고, 손으로 합쳤습니다',
        points: [
          '부서원은 양식을 받아 한글로 적고 메일로 보냈습니다',
          '담당자는 파일을 하나씩 열어 복사·붙여넣기로 합쳤습니다',
          '본부와 기획조정실이 같은 일을 한 번 더 했습니다',
        ],
        body: [
          '누가 냈는지 세는 것도, 늦게 온 파일을 다시 합치는 것도 사람이 했습니다.',
          '같은 표를 세 번 옮겨 적는 동안 줄이 빠지고 서식이 깨졌습니다.',
        ],
        notes:
          '지금까지는 매주 목요일마다 hwp 파일이 메일로 오갔습니다. 담당자는 파일을 하나씩 열어 복사해 붙였고, 본부와 기획조정실은 그걸 또 합쳤습니다. 누가 안 냈는지 세는 일, 늦게 온 파일을 다시 끼워 넣는 일도 모두 사람 몫이었습니다.',
      },
      {
        id: 'why-after',
        kind: 'flow',
        caption: '적는 건 웹에서, 모으는 건 Tincase가',
        flow: [
          { who: '부서원', what: '웹에서 적고 제출' },
          { who: '부서담당자', what: '병합본 다듬기' },
          { who: '실·팀장', what: '검토·승인' },
          { who: '본부', what: '이어 붙여 제출' },
          { who: '총괄', what: '전사본 만들기' },
        ],
        body: [
          '양식도, 적는 내용도 그대로입니다. 한글만 열지 않습니다.',
          '마감이 지나면 부서 병합본이 저절로 만들어지고, 위로는 버튼 하나로 올라갑니다.',
        ],
        notes:
          '바뀌는 것은 적는 곳 하나입니다. 부서원은 웹에서 표에 적고 제출을 누릅니다. 마감이 지나면 부서 병합본이 저절로 만들어지고, 부서담당자가 다듬습니다. 실·팀장이 고쳐 저장하면 그게 승인입니다. 그다음은 본부, 총괄로 버튼 하나씩 올라갑니다. 이제 이 순서대로 화면을 보겠습니다.',
      },
    ],
  },
  {
    id: 'member',
    title: '부서원',
    lede: '웹 표에 적고 [제출]을 누릅니다',
    notes: '먼저 부서원입니다. 모든 분이 하시는 일이고, 한 주에 버튼 두 번이면 끝납니다.',
    who: 'all',
    steps: [
      {
        id: 'member-login',
        kind: 'shot',
        anchor: 'login-form',
        target: 'area',
        caption: 'KEI 이메일로 로그인합니다',
        body: [
          '받은 비밀번호로 처음 들어오면 새 비밀번호로 바꾸게 됩니다.',
          '잊었으면 [비밀번호를 잊으셨나요?] — 메신저로 재설정 링크가 옵니다.',
        ],
        notes:
          '주소는 마지막 장에 크게 보여 드립니다. 아이디는 KEI 이메일입니다. 처음 받은 비밀번호로 들어오면 바로 새 비밀번호로 바꾸게 되어 있습니다. 비밀번호를 잊으면 로그인 화면 아래 링크로 메신저에 재설정 링크를 받습니다.',
      },
      {
        id: 'member-week',
        kind: 'shot',
        anchor: 'compose-open',
        frame: 'week-card',
        target: 'button',
        caption: '첫 화면은 「이번 주 업무일지」',
        body: [
          '맨 위에 주차와 마감, 남은 시간이 보입니다 — 마감은 매주 목요일 14:00입니다.',
          '[작성하기]를 누르면 작성 화면이 열립니다. 오른쪽은 우리 부서 제출 현황입니다.',
        ],
        notes:
          '로그인하면 바로 이 화면입니다. 맨 위가 이번 주 주차와 마감, 남은 시간입니다. 할 일은 카드 안의 초록 버튼 하나, 작성하기입니다. 오른쪽에는 우리 부서에서 누가 냈는지 점으로 보입니다 — 내용은 안 보이고 냈는지만 보입니다.',
      },
      {
        id: 'member-compose',
        kind: 'shot',
        anchor: 'compose-table',
        target: 'area',
        screen: 'composer',
        caption: '한글 표와 같은 칸에 적습니다',
        body: [
          '실적 · 계획 · 특이사항 세 표에 업무 내용·일자·장소·참석자를 적습니다.',
          '한글 표를 복사(Ctrl+C)해 첫 칸에 붙여넣으면 여러 줄이 한 번에 들어갑니다.',
          '적는 중인 내용은 이 브라우저에 저절로 보관됩니다.',
        ],
        notes:
          '작성 화면은 한글 양식의 표와 같은 모양입니다. 실적, 계획, 특이사항 세 표에 칸을 채웁니다. 한글에서 쓰던 표가 있으면 통째로 복사해 첫 칸에 붙여넣으면 줄이 나뉘어 들어갑니다. 구분 번호는 제출할 때 시스템이 다시 매깁니다.',
      },
      {
        id: 'member-previous',
        kind: 'shot',
        anchor: 'previous-to-achievements',
        frame: 'previous-panel',
        target: 'area',
        screen: 'composer',
        caption: '지난번 계획을 이번 주 실적으로 옮깁니다',
        body: [
          '맨 위 「지난번에 낸 것」에 지난주에 낸 내용이 펼쳐져 있습니다.',
          '[계획 2줄을 이번 주 실적으로] 같은 버튼 한 번이면 지난주 계획이 실적 칸에 들어갑니다.',
          '줄마다 [+실적] [+계획]으로 골라 넣을 수도 있습니다.',
        ],
        notes:
          '이번 주 실적은 대개 지난주 계획에 적은 그 일입니다. 그래서 작성 화면 맨 위에 지난번에 낸 것을 펼쳐 둡니다. 이 버튼 한 번이면 지난주 계획이 이번 주 실적 칸으로 들어오고, 거기서 고치기만 하면 됩니다.',
      },
      {
        id: 'member-submit',
        kind: 'shot',
        anchor: 'compose-submit',
        frame: 'compose-footer',
        frameClip: { w: 700, right: true },
        target: 'button',
        screen: 'composer',
        caption: '[제출]을 누르면 끝입니다',
        body: [
          '제출하면 부서 양식(hwp)으로 만들어져 담당자에게 모입니다.',
          '줄 오른쪽 [공유]를 켜면 그 줄이 병합본에 파란색으로 나갑니다.',
        ],
        notes:
          '다 적었으면 오른쪽 아래 제출을 누릅니다. 이걸로 부서 양식 hwp가 만들어져 담당자에게 모입니다. 전체에 알릴 주요 사항은 줄 끝의 공유를 켜 두면 병합본에 파란색으로 나갑니다.',
      },
      {
        id: 'member-done',
        kind: 'shot',
        anchor: 'my-actions',
        frame: 'week-card',
        target: 'button',
        caption: '다시 내면 새 버전이 됩니다',
        body: [
          '카드에 「제출 완료」가 붙습니다. [열어보기]로 낸 것을 화면에서 확인합니다.',
          '고칠 게 있으면 [다시 작성 (새 버전)] — 마지막 것이 병합에 들어갑니다.',
          '마감 전에는 [제출 취소]도 됩니다.',
        ],
        notes:
          '제출하면 카드에 제출 완료가 붙고 버튼이 바뀝니다. 고칠 게 생기면 다시 작성을 누르면 새 버전이 되고, 병합에는 마지막 것이 들어갑니다. 이전 버전도 지워지지 않습니다. 마감 전이면 제출 취소도 할 수 있습니다.',
      },
      {
        id: 'member-history',
        kind: 'shot',
        anchor: 'history-table',
        target: 'area',
        caption: '[내 이력]에서 지난주 것을 봅니다',
        body: [
          '최근 26주 — 낸 주는 [열기]로 화면에서 보고 [받기]로 내려받습니다.',
          '담당자가 고친 판이면 「○○ 고침」이 함께 보입니다.',
        ],
        notes:
          '위 메뉴의 내 이력에는 최근 반년 치가 주마다 한 줄씩 있습니다. 낸 주는 열어서 바로 보고, 필요하면 받습니다. 담당자가 내 업무일지를 고쳤으면 누가 고쳤는지도 여기 나옵니다. 부서원 순서는 여기까지입니다.',
      },
    ],
  },
  {
    id: 'lead',
    title: '부서담당자',
    lede: '누가 냈는지 보고, 병합본을 다듬습니다',
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
        caption: '[수합 관리]에서 누가 냈는지 봅니다',
        body: [
          '제출 수와 마감이 맨 위에, 아래 표에는 부서원마다 제출 시각과 버전이 있습니다.',
          '표의 [열기]로 제출물을 화면에서 바로 봅니다.',
        ],
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
        caption: '안 낸 사람은 이름을 복사해 알립니다',
        body: [
          '[미제출 2명 이름 복사] 같은 버튼 → 메신저에 붙여넣습니다.',
          'Tincase도 마감 전날 11:45 · 당일 09:00 · 1시간 전 · 10분 전에 안 낸 사람에게 알림을 보냅니다.',
        ],
        notes:
          '독촉은 이름 복사 하나면 됩니다. 메신저에 붙여넣으세요. 그리고 Tincase가 마감 전날 점심 전, 당일 아침, 한 시간 전, 십 분 전에 아직 안 낸 사람에게만 알림을 보냅니다. 이미 낸 사람에게는 가지 않습니다.',
      },
      {
        id: 'lead-merge',
        kind: 'shot',
        anchor: 'merge-card',
        target: 'area',
        screen: 'lead-manage',
        caption: '마감 1분 뒤, 병합본이 저절로 생깁니다',
        body: [
          '모인 업무일지가 한 문서로 합쳐집니다 — 같은 업무는 한 줄로 묶습니다.',
          '늦게 낸 사람이 있으면 [다시 병합]. 마감 전에도 [지금 병합]으로 미리 만들어 볼 수 있습니다.',
        ],
        notes:
          '목요일 두 시 일 분이면 병합본이 저절로 만들어집니다. 여러 사람이 같은 회의를 적었으면 한 줄로 묶고, 내용이 달라서 확인이 필요한 곳은 여기 따로 알려 줍니다. 마감 뒤에 늦게 낸 사람이 있으면 다시 병합을 누르면 됩니다.',
      },
      {
        id: 'lead-merged',
        kind: 'shot',
        anchor: 'merged-body',
        focusClip: { h: 240 },
        frame: 'merged-drawer',
        frameClip: { h: 420 },
        target: 'area',
        caption: '[내용 보기]로 열어 바로 고칩니다',
        body: [
          '칸을 눌러 고치고 [수정 저장] — 줄 순서는 왼쪽 손잡이를 끌어 바꿉니다.',
          '[hwp로 받기]로 한글 파일도 받습니다. 부서원이 낸 원본은 그대로 남습니다.',
        ],
        notes:
          '내용 보기를 누르면 병합본이 화면에 열립니다. 이상한 줄이 하나 보이면 한글을 열 필요 없이 그 칸을 눌러 고치고 수정 저장을 누릅니다. 순서도 끌어서 바꿉니다. 여기서 고쳐도 부서원이 낸 원본은 바뀌지 않습니다.',
      },
      {
        id: 'lead-rules',
        kind: 'shot',
        anchor: 'merge-order',
        frame: 'merge-settings',
        frameClip: { h: 400 },
        target: 'area',
        caption: '분류·정렬 순서는 [부서 설정]에서',
        body: [
          '분류 순서에 「AI-홍보-시스템-도서관」처럼 적으면 병합본이 그 순서로 묶입니다.',
          '정렬은 제출자 순 또는 일자 순 — 한 번 정하면 매주 그대로입니다.',
        ],
        notes:
          '매주 손으로 줄을 옮기던 일은 부서 설정에서 한 번 정해 둡니다. 분류 순서를 적으면 병합본이 그 순서로 묶이고, 정렬을 일자 순으로 하면 날짜 빠른 줄부터 놓입니다. 다음 주부터 병합이 그대로 따릅니다.',
      },
    ],
  },
  {
    id: 'head',
    title: '실·팀장',
    lede: '병합본을 검토하고 승인합니다 (화면에서는 「부서장」)',
    notes:
      '이제 실장님, 팀장님 차례입니다. 화면에서는 「부서장」이라고 나옵니다. 담당자가 다듬은 병합본을 보고 승인하시는 일입니다.',
    who: 'head',
    steps: [
      {
        id: 'head-notice',
        kind: 'message',
        caption: '마감 10분 뒤 검토 요청이 옵니다',
        message: {
          from: 'Tincase',
          subject: '[Tincase] {week} 주간 병합본 검토 부탁드려요',
          lines: ['{week} 주간 업무일지 병합본이 준비됐어요.', 'Tincase에서 내용을 확인하고 고칠 부분을 알려주세요.'],
        },
        body: [
          '사내 메신저 알림함으로 옵니다 — 부서장에게만, 병합이 된 때만.',
          '[수합 관리]에서 병합본을 엽니다.',
        ],
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
        caption: '[수합 관리]에서 병합본을 엽니다',
        body: [
          '병합본 카드에 「부서장 승인 전」이 붙어 있습니다.',
          '[내용 보기]로 열면 [작성자 보기]로 줄마다 누가 냈는지도 보입니다.',
        ],
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
        caption: '고쳐서 저장하면 그대로 승인입니다',
        body: [
          '칸을 고치고 [수정 저장] — 저장하는 순간 승인으로 기록됩니다.',
          '담당자에게 「승인 완료 · 바뀐 곳」 알림이 갑니다.',
        ],
        notes:
          '고칠 곳이 있으면 그 자리에서 고치고 수정 저장을 누르시면 됩니다. 따로 승인을 누를 필요 없이 그 저장이 승인입니다. 담당자에게 승인 완료와 함께 어디가 바뀌었는지 알림이 갑니다.',
      },
      {
        id: 'head-approve',
        kind: 'shot',
        anchor: 'merged-approve',
        frame: 'merge-review',
        frameClip: { w: 700 },
        target: 'button',
        screen: 'head-manage',
        caption: '고칠 게 없으면 [고칠 것 없음 · 승인]',
        body: [
          '누르면 바로 승인됩니다 — 이 버튼은 부서장에게만 보입니다.',
          '승인한 뒤 병합본이 바뀌면 「승인 뒤 바뀜」으로 다시 알려 줍니다.',
        ],
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
        caption: '승인되면 담당자가 본부(총괄)에 제출합니다',
        body: [
          '[수합 관리]의 「○○본부에 제출」 — 본부가 없는 부서는 「총괄(기획조정실)에 제출」입니다.',
          '누르는 순간의 병합본이 사본으로 갑니다. 그 뒤에 고치면 [다시 제출].',
        ],
        notes:
          '승인이 나면 담당자가 병합본 카드 아래의 제출 카드에서 위로 냅니다. 산하 본부가 있으면 본부에, 없으면 총괄에 바로 갑니다. 누르는 순간의 병합본이 사본으로 가니, 그 뒤에 고쳤으면 다시 제출을 눌러야 합니다.',
      },
    ],
  },
  {
    id: 'hq',
    title: '본부',
    lede: '실·팀이 낸 것을 이어 붙여 총괄에 냅니다',
    notes: '실·팀이 낸 것은 본부로 갑니다. 본부 담당자와 본부장님께는 [본부 취합] 메뉴가 있습니다.',
    who: 'hq',
    steps: [
      {
        id: 'hq-status',
        kind: 'shot',
        anchor: 'hq-units',
        target: 'area',
        screen: 'hq',
        caption: '[본부 취합]에서 실·팀 상태를 봅니다',
        body: [
          '산하 실·팀마다 「제출」 시각과 낸 사람이, 아직이면 「병합됨 · 미제출」·「아직 병합 전」이 보입니다.',
          '이어 붙이는 순서는 [순서 바꾸기]로 한 번 정해 두면 매주 그대로입니다.',
        ],
        notes:
          '본부 담당자와 본부장에게는 본부 취합 메뉴가 있습니다. 산하 실·팀이 냈는지, 언제 누가 냈는지 한 줄씩 보입니다. 위에서부터 이 순서대로 문서에 들어가고, 순서는 한 번 정하면 매주 그대로입니다.',
      },
      {
        id: 'hq-run',
        kind: 'shot',
        anchor: 'hq-run-button',
        frame: 'hq-run-head',
        frameClip: { w: 700 },
        target: 'button',
        screen: 'hq',
        caption: '[이어 붙이기]로 본부본을 만듭니다',
        body: [
          '낸 실·팀만 정한 순서대로 한 문서가 됩니다 — 실·팀 안의 내용은 바꾸지 않습니다.',
          '[본부본 받기]로 열어 확인합니다. 늦게 낸 곳이 있으면 [다시 이어 붙이기].',
        ],
        notes:
          '이어 붙이기를 누르면 낸 실·팀이 정한 순서대로 한 문서가 됩니다. 본부는 실·팀 안의 내용을 고치지 않습니다 — 고칠 곳은 그 실·팀이 고쳐 다시 내고, 여기서 다시 이어 붙입니다.',
      },
      {
        id: 'hq-approve',
        kind: 'shot',
        anchor: 'hq-approve',
        frame: 'hq-approval',
        // 버튼이 줄 끝(오른쪽)에 있다 — 오른쪽에서 772px: 「본부장이 [승인]을 누르면…」 낱말 앞에서 시작하고 배율 2.0을 지킨다
        frameClip: { w: 772, right: true },
        target: 'button',
        screen: 'hq',
        caption: '본부장은 [검토 완료 · 승인]을 누릅니다',
        body: [
          '본부본을 받아 본 뒤 누릅니다 — 본부 담당자에게 알림이 갑니다.',
          '이 버튼은 본부장에게만 보입니다.',
        ],
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
        caption: '[총괄(기획조정실)에 제출]로 올립니다',
        body: [
          '같은 「본부본」 카드 아래에 있습니다 — 그 순간의 본부본이 총괄에 갑니다.',
          '제출한 뒤 다시 이어 붙였으면 「제출 뒤 바뀜」 — [다시 제출].',
        ],
        notes:
          '승인이 끝나면 같은 카드 아래의 총괄(기획조정실)에 제출을 누릅니다. 이걸로 본부의 일은 끝입니다. 제출한 뒤에 다시 이어 붙였으면 제출 뒤 바뀜이 뜨니 다시 제출하면 됩니다.',
      },
    ],
  },
  {
    id: 'org',
    title: '총괄',
    lede: '전사 제출을 한 화면에서 보고, 전사본을 만듭니다',
    notes: '마지막으로 기획조정실, 총괄입니다. 전사가 한 화면에 모입니다.',
    who: 'org',
    steps: [
      {
        id: 'org-board',
        kind: 'shot',
        anchor: 'org-board',
        focusClip: { h: 430 },
        frameClip: { h: 430 },
        target: 'area',
        screen: 'org',
        caption: '[전사]에서 섹션별 제출을 한눈에',
        body: [
          '전사본 섹션 순서대로 한 줄씩 — 막대를 누르면 안 낸 사람과 팀이 펼쳐집니다.',
          '[안내문 복사]로 바로 알립니다. 팀 이름을 누르면 그 부서의 수합 관리(읽기 전용)입니다.',
        ],
        notes:
          '기획조정실 총괄 화면입니다. 전사가 전사본 섹션 순서대로 한 줄씩 있고, 줄마다 몇 명이 냈는지 막대로 보입니다. 막대를 누르면 안 낸 사람이 펼쳐지고 안내문 복사로 바로 알릴 수 있습니다.',
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
        caption: '게시판으로 온 hwp는 [올리기]로 넣습니다',
        body: [
          '「최종본에」 열은 섹션마다 전사본에 무엇이 들어갈지입니다 — Tincase · 올린 파일 · 본부 대기 · 미제출.',
          '아직 게시판으로 받는 섹션은 받은 hwp를 그 줄의 [올리기]로 넣습니다.',
        ],
        notes:
          '오른쪽 「최종본에」 열은 섹션마다 무엇이 들어갈지입니다. Tincase로 올라온 것, 총괄이 올린 파일, 본부가 아직 안 낸 것, 미제출. 아직 Tincase를 안 쓰는 섹션은 게시판으로 받은 hwp를 그 줄에서 올립니다.',
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
        caption: '[전사 취합본 만들기]를 누릅니다',
        body: [
          '들어온 섹션이 정한 순서대로 한 문서가 됩니다 — 빠진 섹션은 「미제출」로 자리만 남습니다.',
          '번호를 다시 매긴 곳, 한글에서 확인할 곳을 먼저 알려 줍니다.',
        ],
        notes:
          '맨 아래 전사 취합본 만들기를 누르면 들어온 섹션이 순서대로 한 문서, 전사본이 됩니다. 안 온 섹션은 미제출로 자리만 남습니다. 자동으로 고친 곳과 한글에서 확인할 곳도 같이 알려 줍니다.',
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
        caption: '[전사본 받기]로 받아 한글에서 확인합니다',
        body: [
          '받은 파일을 한글로 열어 확인하고 취합게시판(NAMS)에 올립니다.',
          '늦게 들어온 섹션이 있으면 「섹션이 바뀜」 — [다시 만들기].',
        ],
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
        caption: '연휴엔 [일정 바꾸기]로 마감을 당깁니다',
        body: [
          '[일정 바꾸기] → [마감 바꾸기] → 게시판 공지 본문을 그대로 붙여넣습니다.',
          '「제출 기한은 10월 7(수) 오후 3시입니다」 같은 문장에서 날짜·시각을 읽습니다.',
        ],
        notes:
          '연휴로 마감이 당겨지는 주에는 일정 바꾸기를 엽니다. 게시판에 올리는 작성 요청 공지를 그대로 붙여넣으면 날짜와 시각을 읽습니다. 따로 날짜를 고를 필요가 없습니다.',
      },
      {
        id: 'org-preview',
        kind: 'shot',
        anchor: 'deadline-apply',
        frame: 'deadline-plan',
        target: 'area',
        who: 'schedule',
        selfOnly: true,
        caption: '미리 보고 [이대로 적용]을 누릅니다',
        body: [
          '[미리보기]에서 바뀌는 마감과 알림·병합 시각을 먼저 봅니다 — 아직 아무것도 안 바뀝니다.',
          '적용하면 그 주만 전 부서 마감이 대외 마감 한 시간 앞으로 잡히고, 다음 주는 평소대로입니다.',
        ],
        notes:
          '미리보기에서 어느 주차 마감이 언제로 바뀌는지, 알림과 병합이 몇 시에 나가는지 먼저 확인합니다. 이대로 적용을 누르면 그 주만 전 부서 마감이 바뀌고, 부서원 화면의 마감이 빨갛게 바뀌며 이유가 한 줄 붙습니다.',
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
        caption: '한 주에 누르는 버튼은 이것뿐입니다',
        rows: [
          { who: '부서원', buttons: ['작성하기', '제출'] },
          { who: '부서담당자', buttons: ['내용 보기', '○○본부에 제출'] },
          { who: '실·팀장', buttons: ['수정 저장', '고칠 것 없음 · 승인'], or: true },
          { who: '본부', buttons: ['이어 붙이기', '총괄(기획조정실)에 제출'] },
          { who: '총괄', buttons: ['전사 취합본 만들기', '전사본 받기'] },
        ],
        body: [
          '마감은 매주 목요일 14:00, 병합은 마감 1분 뒤 저절로 됩니다.',
          '모르는 게 있으면 맨 위 [사용 안내]를 다시 여세요.',
        ],
        notes:
          '정리하면 사람마다 누르는 버튼은 두 개 남짓입니다. 마감은 매주 목요일 두 시, 병합은 그 1분 뒤 저절로 됩니다. 오늘 본 화면은 언제든 위 메뉴의 사용 안내에서 다시 볼 수 있습니다.',
      },
      {
        id: 'outro-address',
        kind: 'address',
        presentOnly: true,
        caption: '이 주소에서 다시 보실 수 있습니다',
        body: ['로그인하면 맨 위 메뉴의 [사용 안내]에서도 열립니다.'],
        notes:
          '이 주소로 들어오시면 됩니다. 로그인한 뒤 위 메뉴의 사용 안내를 누르면 오늘 본 것을 한 장씩 다시 넘겨 볼 수 있습니다. 질문 받겠습니다.',
      },
    ],
  },
];

// ── 펼치기 ──────────────────────────────────────────────────────────────────

/** 발표·혼자 보기가 공통으로 쓰는 한 장 */
export interface Slide {
  /** 주소 조각 — 장 제목은 `lead`, 단계는 `lead-3` (이야기 순서의 장 안 **전체** 순번 — 사람·방식마다 같다) */
  key: string;
  /** 이 장을 보여 줄 장 — 혼자 보기에서 `selfHome`으로 옮긴 단계면 옮겨 간 장 */
  chapter: GuideChapter;
  /** 장 제목 슬라이드면 null */
  step: GuideStep | null;
  /** 그 방식에서 장 안의 순번(1부터) — 「부서담당자 · 3/5」의 3. 장 제목 슬라이드는 0 */
  n: number;
  /** 그 방식에서 장 안의 단계 수 — 「3/5」의 5 */
  of: number;
}

const whoOf = (c: GuideChapter, s: GuideStep): GuideCap => s.who ?? c.who;

/** 장 제목 슬라이드가 있는 장 = 역할 장 (부서원 → 총괄). 장 제목의 「01 / 05」와 「지금 여기」 줄이 쓴다 */
export function roleChapters(deck: readonly GuideChapter[] = DECK): GuideChapter[] {
  return deck.filter((c) => c.lede);
}

/** 발표 모드 — **모든 장**, 장 사이에 장 제목 슬라이드 (PG-59). 혼자 보기 전용 단계(`selfOnly`)는 뺀다 */
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
