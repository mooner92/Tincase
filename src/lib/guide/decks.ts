// PG-100 — 사용 안내의 **갈래** 목록. 부서의 양식이 정한다(서버 `guideVariantOf`): 실형 5칸 표 · 연구 본부 과제 카드 · 환경평가본부 ERP 가져오기.
// 갈래마다 단계(deck)와 그림 목록(manifest)이 따로다. 총괄 장은 갈래마다 같아서 실형 갈래에만 있다.
import { DECK, type DeckKey, type GuideChapter } from './deck';
import { PROJECT_DECK } from './deck-project';
import { ERP_DECK } from './deck-erp';

export interface DeckInfo {
  key: DeckKey;
  /** 탭 이름 — 「우리 팀 방식」처럼 그 부서 사람이 알아보는 이름 */
  tab: string;
  /** 탭 아래 한 줄 — 어느 부서가 이 방식인가 */
  who: string;
  chapters: readonly GuideChapter[];
}

export const DECKS: Record<DeckKey, DeckInfo> = {
  unit: { key: 'unit', tab: '실·팀 (5칸 표)', who: '기획경영본부 실 · 임원실 · 글로벌 · AI홍보전략실 · 지속센터', chapters: DECK },
  project: { key: 'project', tab: '연구 본부 (과제 카드)', who: '국토환경 · 생활환경 · 기후대기 · 적응센터', chapters: PROJECT_DECK },
  erp: { key: 'erp', tab: '환경평가본부 (ERP 가져오기)', who: '환경평가본부 — 본부 담당이 ERP 보고서로', chapters: ERP_DECK },
};

export const DECK_KEYS: readonly DeckKey[] = ['unit', 'project', 'erp'];

export const isDeckKey = (v: unknown): v is DeckKey => typeof v === 'string' && (DECK_KEYS as readonly string[]).includes(v);
