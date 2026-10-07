// RU-62 — 남의 문서 본문을 **원래 꼴 그대로** 옮겨 오기. 서식 표(DocInfo) 번호를 대상 문서에 맞게 옮겨 적는다.
//
// 본문 레코드는 글자 모양·문단 모양·스타일·테두리를 **번호로만** 가리킨다. 그 번호는 문서마다 다르다 —
// 같은 양식에서 나온 문서라도 누가 붙여넣기를 하면 그 문서에만 서식이 늘어난다(분석 §9.6 글꼴 혼재).
// 그래서 레코드를 그냥 옮기면 엉뚱한 서식이 입혀지고, 범위를 넘으면 한글이 문서를 열지 못한다.
//
// 방법: 옮길 본문이 가리키는 번호를 따라가 원본 DocInfo의 그 레코드를 대상 DocInfo로 **가져온다.**
//   · 대상에 바이트까지 같은 레코드가 있으면 그것을 쓴다 — 같은 양식에서 나온 문서는 대부분 새로 늘지 않는다
//   · 없으면 끝에 붙이고 ID_MAPPINGS의 개수를 올린다
//   · 가져오는 레코드가 다시 가리키는 번호(글자 모양 → 글꼴·테두리, 문단 모양 → 탭·테두리, 스타일 → 문단·글자 모양)도
//     먼저 같은 방식으로 가져온다
//
// 번호 체계 (실측, 2026-10-07 — fixtures·운영 양식·병합본 4종이 모두 같다):
//   글꼴(언어별)·글자 모양·문단 모양·스타일·탭 = 0부터 · 테두리/배경 = **1부터**(0 = 없음)
import { HwpRecord, TAG } from './record';

export class DocMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocMergeError';
  }
}

/** DocInfo 태그 (HWP 5.0) */
const DI = {
  DOCUMENT_PROPERTIES: 16,
  ID_MAPPINGS: 17,
  BIN_DATA: 18,
  FACE_NAME: 19,
  BORDER_FILL: 20,
  CHAR_SHAPE: 21,
  TAB_DEF: 22,
  NUMBERING: 23,
  BULLET: 24,
  PARA_SHAPE: 25,
  STYLE: 26,
} as const;

/** ID_MAPPINGS 칸 — 0 BinData, 1~7 글꼴(한글·영문·한자·일어·기타·기호·사용자), 8 테두리, 9 글자, 10 탭, 11 번호, 12 글머리, 13 문단, 14 스타일 */
const SLOT = { BIN: 0, FACE0: 1, BORDER: 8, CHAR: 9, TAB: 10, NUM: 11, BULLET: 12, PARA: 13, STYLE: 14 } as const;
const LANGS = 7;

/** 레코드 하나 + 딸린 자식 레코드(레벨이 더 깊은 것) — 묶어서 옮긴다 */
type Item = HwpRecord[];

interface Parsed {
  head: HwpRecord[]; // DOCUMENT_PROPERTIES, ID_MAPPINGS
  bin: Item[];
  faces: Item[][]; // 언어별
  border: Item[];
  char: Item[];
  tab: Item[];
  num: Item[];
  bullet: Item[];
  para: Item[];
  style: Item[];
  rest: HwpRecord[];
  slots: number[];
}

const ORDER = [DI.BIN_DATA, DI.FACE_NAME, DI.BORDER_FILL, DI.CHAR_SHAPE, DI.TAB_DEF, DI.NUMBERING, DI.BULLET, DI.PARA_SHAPE, DI.STYLE] as const;

function parseDocInfo(recs: readonly HwpRecord[]): Parsed {
  const idm = recs.find((r) => r.tag === DI.ID_MAPPINGS);
  if (!idm) throw new DocMergeError('DocInfo에 ID_MAPPINGS가 없습니다');
  const slots: number[] = [];
  for (let o = 0; o + 4 <= idm.data.length; o += 4) slots.push(idm.data.readInt32LE(o));

  const head: HwpRecord[] = [];
  const groups = new Map<number, Item[]>(ORDER.map((t) => [t, []]));
  const rest: HwpRecord[] = [];
  let i = 0;
  // 머리 — 문서 속성과 ID_MAPPINGS
  while (i < recs.length && (recs[i].tag === DI.DOCUMENT_PROPERTIES || recs[i].tag === DI.ID_MAPPINGS)) head.push(recs[i++]);
  let lastOrder = -1;
  while (i < recs.length) {
    const r = recs[i];
    const ord = ORDER.indexOf(r.tag as (typeof ORDER)[number]);
    if (ord < 0) break; // 서식 표가 끝났다 — 나머지는 그대로 둔다
    if (ord < lastOrder) throw new DocMergeError(`DocInfo 레코드 순서가 예상과 다릅니다 (태그 ${r.tag})`);
    lastOrder = ord;
    const item: Item = [r];
    let k = i + 1;
    while (k < recs.length && recs[k].level > r.level) item.push(recs[k++]);
    groups.get(r.tag)!.push(item);
    i = k;
  }
  while (i < recs.length) rest.push(recs[i++]);

  // 글꼴은 언어별로 이어 붙어 있다 — 개수 칸으로 나눈다
  const allFaces = groups.get(DI.FACE_NAME)!;
  const faces: Item[][] = [];
  let at = 0;
  for (let l = 0; l < LANGS; l++) {
    const n = slots[SLOT.FACE0 + l] ?? 0;
    faces.push(allFaces.slice(at, at + n));
    at += n;
  }
  if (at !== allFaces.length) throw new DocMergeError(`글꼴 개수가 ID_MAPPINGS와 맞지 않습니다 (${allFaces.length} ≠ ${at})`);
  const p: Parsed = {
    head,
    bin: groups.get(DI.BIN_DATA)!,
    faces,
    border: groups.get(DI.BORDER_FILL)!,
    char: groups.get(DI.CHAR_SHAPE)!,
    tab: groups.get(DI.TAB_DEF)!,
    num: groups.get(DI.NUMBERING)!,
    bullet: groups.get(DI.BULLET)!,
    para: groups.get(DI.PARA_SHAPE)!,
    style: groups.get(DI.STYLE)!,
    rest,
    slots,
  };
  const check: [string, number, number][] = [
    ['테두리', p.border.length, slots[SLOT.BORDER]],
    ['글자 모양', p.char.length, slots[SLOT.CHAR]],
    ['문단 모양', p.para.length, slots[SLOT.PARA]],
    ['스타일', p.style.length, slots[SLOT.STYLE]],
    ['탭', p.tab.length, slots[SLOT.TAB]],
  ];
  for (const [what, got, want] of check) {
    if (got !== want) throw new DocMergeError(`${what} 개수가 ID_MAPPINGS와 맞지 않습니다 (${got} ≠ ${want})`);
  }
  return p;
}

const same = (a: Item, b: Item) => a.length === b.length && a.every((r, i) => r.tag === b[i].tag && r.level === b[i].level && r.data.equals(b[i].data));
const cloneItem = (it: Item): Item => it.map((r) => ({ ...r, data: Buffer.from(r.data) }));

/** 스타일 이름 (로컬) — 같은 이름이면 같은 스타일로 본다 */
function styleName(d: Buffer): string {
  const n = d.readUInt16LE(0);
  return d.toString('ucs2', 2, 2 + n * 2);
}
function styleTail(d: Buffer): number {
  const n1 = d.readUInt16LE(0);
  const n2 = d.readUInt16LE(2 + n1 * 2);
  return 4 + n1 * 2 + n2 * 2; // attr u8 · next u8 · lang i16 · 문단 모양 u16(+4) · 글자 모양 u16(+6)
}

/** PARA_SHAPE 첫 속성의 문단 머리 종류 — 0 없음 · 1 개요 · 2 번호 · 3 글머리 */
const headType = (d: Buffer) => (d.readUInt32LE(0) >>> 23) & 3;

/**
 * 원본 DocInfo → 대상 DocInfo로 번호를 옮겨 적는 일꾼. 한 대상 문서에 여러 원본을 차례로 합칠 수 있다
 * (전사 취합: 섹션마다 원본이 다르다) — 대상 쪽 목록은 계속 자란다.
 */
export class DocInfoMerger {
  private t: Parsed;
  private warnings: string[] = [];

  constructor(targetDocInfo: readonly HwpRecord[]) {
    this.t = parseDocInfo(targetDocInfo);
  }

  /** 원본 하나를 위한 번호 대응표. 원본마다 새로 만든다 */
  from(sourceDocInfo: readonly HwpRecord[]): SourceMapper {
    return new SourceMapper(this, parseDocInfo(sourceDocInfo));
  }

  warn(w: string) {
    if (!this.warnings.includes(w)) this.warnings.push(w);
  }
  get notes(): readonly string[] {
    return this.warnings;
  }

  /** 대상 목록에 같은 것이 있으면 그 번호, 없으면 붙이고 새 번호 (0부터) */
  intern(list: Item[], item: Item): number {
    const k = list.findIndex((x) => same(x, item));
    if (k >= 0) return k;
    list.push(cloneItem(item));
    return list.length - 1;
  }

  get target(): Parsed {
    return this.t;
  }

  /** 합친 DocInfo 레코드 — ID_MAPPINGS 개수를 다시 적는다 */
  build(): HwpRecord[] {
    const t = this.t;
    const slots = [...t.slots];
    slots[SLOT.BIN] = t.bin.length;
    t.faces.forEach((f, l) => (slots[SLOT.FACE0 + l] = f.length));
    slots[SLOT.BORDER] = t.border.length;
    slots[SLOT.CHAR] = t.char.length;
    slots[SLOT.TAB] = t.tab.length;
    slots[SLOT.NUM] = t.num.length;
    slots[SLOT.BULLET] = t.bullet.length;
    slots[SLOT.PARA] = t.para.length;
    slots[SLOT.STYLE] = t.style.length;
    const head = t.head.map((r) => {
      if (r.tag !== DI.ID_MAPPINGS) return r;
      const d = Buffer.from(r.data);
      slots.forEach((v, i) => i * 4 + 4 <= d.length && d.writeInt32LE(v, i * 4));
      return { ...r, data: d };
    });
    return [
      ...head,
      ...t.bin.flat(),
      ...t.faces.flat(2),
      ...t.border.flat(),
      ...t.char.flat(),
      ...t.tab.flat(),
      ...t.num.flat(),
      ...t.bullet.flat(),
      ...t.para.flat(),
      ...t.style.flat(),
      ...t.rest,
    ];
  }
}

export class SourceMapper {
  private face = new Map<string, number>();
  private border = new Map<number, number>();
  private char = new Map<number, number>();
  private tab = new Map<number, number>();
  private para = new Map<number, number>();
  private style = new Map<number, number>();
  private num = new Map<number, number>();
  private bullet = new Map<number, number>();

  constructor(
    private m: DocInfoMerger,
    private s: Parsed,
  ) {}

  private get t() {
    return this.m.target;
  }

  mapFace(lang: number, id: number): number {
    const key = `${lang}:${id}`;
    const hit = this.face.get(key);
    if (hit !== undefined) return hit;
    const src = this.s.faces[lang]?.[id];
    if (!src) throw new DocMergeError(`없는 글꼴 번호 (언어 ${lang}, ${id})`);
    const out = this.m.intern(this.t.faces[lang], src);
    this.face.set(key, out);
    return out;
  }

  /** 테두리/배경 — **1부터**. 0은 「없음」이라 그대로 */
  mapBorder(id1: number): number {
    if (id1 === 0) return 0;
    const hit = this.border.get(id1);
    if (hit !== undefined) return hit;
    const src = this.s.border[id1 - 1];
    if (!src) throw new DocMergeError(`없는 테두리 번호 ${id1}`);
    // 그림 채우기는 BinData를 가리킨다 — 그림은 옮기지 않으므로 알린다
    if (src[0].data.length >= 36 && (src[0].data.readUInt32LE(32) & 0x2) !== 0) this.m.warn('그림으로 채운 테두리가 있어 그 그림은 옮기지 않았습니다');
    const out = this.m.intern(this.t.border, src) + 1;
    this.border.set(id1, out);
    return out;
  }

  mapTab(id: number): number {
    const hit = this.tab.get(id);
    if (hit !== undefined) return hit;
    const src = this.s.tab[id];
    if (!src) throw new DocMergeError(`없는 탭 번호 ${id}`);
    const out = this.m.intern(this.t.tab, src);
    this.tab.set(id, out);
    return out;
  }

  mapChar(id: number): number {
    const hit = this.char.get(id);
    if (hit !== undefined) return hit;
    const src = this.s.char[id];
    if (!src) throw new DocMergeError(`없는 글자 모양 번호 ${id}`);
    const it = cloneItem(src);
    const d = it[0].data;
    if (d.length < 70) throw new DocMergeError(`글자 모양 레코드가 짧습니다 (${d.length})`);
    for (let l = 0; l < LANGS; l++) d.writeUInt16LE(this.mapFace(l, d.readUInt16LE(l * 2)), l * 2);
    d.writeUInt16LE(this.mapBorder(d.readUInt16LE(68)), 68);
    const out = this.m.intern(this.t.char, it);
    this.char.set(id, out);
    return out;
  }

  /** 번호·글머리는 1부터로 본다 (0 = 없음). 이 기관 문서들에서는 쓰이지 않았다(실측 0개) — 쓰이면 옮기고 알린다 */
  private mapList(kind: 'num' | 'bullet', id1: number): number {
    if (id1 === 0) return 0;
    const cache = kind === 'num' ? this.num : this.bullet;
    const hit = cache.get(id1);
    if (hit !== undefined) return hit;
    const src = (kind === 'num' ? this.s.num : this.s.bullet)[id1 - 1];
    if (!src) {
      this.m.warn('문단 번호·글머리 정보를 찾지 못해 번호 없이 옮겼습니다');
      return 0;
    }
    this.m.warn('문단 번호·글머리가 있는 문단을 옮겼습니다 — 한글에서 번호 모양을 확인해 주세요');
    const out = this.m.intern(kind === 'num' ? this.t.num : this.t.bullet, src) + 1;
    cache.set(id1, out);
    return out;
  }

  mapPara(id: number): number {
    const hit = this.para.get(id);
    if (hit !== undefined) return hit;
    const src = this.s.para[id];
    if (!src) throw new DocMergeError(`없는 문단 모양 번호 ${id}`);
    const it = cloneItem(src);
    const d = it[0].data;
    if (d.length < 34) throw new DocMergeError(`문단 모양 레코드가 짧습니다 (${d.length})`);
    d.writeUInt16LE(this.mapTab(d.readUInt16LE(28)), 28);
    const ht = headType(d);
    if (ht === 2) d.writeUInt16LE(this.mapList('num', d.readUInt16LE(30)), 30);
    else if (ht === 3) d.writeUInt16LE(this.mapList('bullet', d.readUInt16LE(30)), 30);
    d.writeUInt16LE(this.mapBorder(d.readUInt16LE(32)), 32);
    const out = this.m.intern(this.t.para, it);
    this.para.set(id, out);
    return out;
  }

  /** 스타일은 **이름**으로 맞춘다 — 같은 이름이 대상에 있으면 그것. 문단의 실제 모양은 문단 모양 번호가 정한다 */
  mapStyle(id: number): number {
    const hit = this.style.get(id);
    if (hit !== undefined) return hit;
    const src = this.s.style[id];
    if (!src) throw new DocMergeError(`없는 스타일 번호 ${id}`);
    const name = styleName(src[0].data);
    const k = this.t.style.findIndex((x) => styleName(x[0].data) === name);
    if (k >= 0) {
      this.style.set(id, k);
      return k;
    }
    const it = cloneItem(src);
    const d = it[0].data;
    const o = styleTail(d);
    if (d.length < o + 8) throw new DocMergeError(`스타일 레코드가 짧습니다 (${name})`);
    d.writeUInt16LE(this.mapPara(d.readUInt16LE(o + 4)), o + 4);
    d.writeUInt16LE(this.mapChar(d.readUInt16LE(o + 6)), o + 6);
    // 다음 스타일은 자기 자신으로 — 원본의 다음 스타일을 따라가면 대상에 없는 연쇄가 생긴다
    const out = this.t.style.length;
    d.writeUInt8(Math.min(out, 255), o + 1);
    this.t.style.push(it);
    this.style.set(id, out);
    return out;
  }
}

function ctrlId(data: Buffer): string {
  return data.length < 4 ? '' : Buffer.from([data[3], data[2], data[1], data[0]]).toString('latin1');
}

/**
 * 본문 레코드(문단 블록들)를 복제하면서 번호를 대상 기준으로 옮겨 적는다.
 *
 *   PARA_HEADER      문단 모양(+8) · 스타일(+10)
 *   PARA_CHAR_SHAPE  (위치, 글자 모양) 쌍마다
 *   TABLE            표 테두리(행 크기 배열 뒤) · 영역별 테두리
 *   LIST_HEADER      **표 칸일 때만** 칸 테두리(+32) — 머리말·글상자의 LIST_HEADER는 꼴이 다르다
 *
 * 그림·도형(`gso `)은 BinData를 가리켜 옮길 수 없다 — 만나면 멈춘다(조용히 깨진 문서를 만들지 않는다).
 */
export function remapBody(recs: readonly HwpRecord[], map: SourceMapper): HwpRecord[] {
  const out = recs.map((r) => ({ ...r, data: Buffer.from(r.data) }));
  // 표 칸 LIST_HEADER는 'tbl ' 컨트롤 바로 아래 레벨이다
  const cellLevels: { level: number; end: number }[] = [];
  for (let i = 0; i < out.length; i++) {
    const r = out[i];
    while (cellLevels.length && i >= cellLevels[cellLevels.length - 1].end) cellLevels.pop();
    if (r.tag === TAG.CTRL_HEADER) {
      const id = ctrlId(r.data);
      if (id === 'gso ') throw new DocMergeError('그림·도형이 들어 있는 섹션은 아직 옮길 수 없습니다');
      if (id === 'tbl ') {
        let end = i + 1;
        while (end < out.length && out[end].level > r.level) end++;
        cellLevels.push({ level: r.level + 1, end });
      }
    }
    if (r.tag === TAG.PARA_HEADER && r.data.length >= 11) {
      r.data.writeUInt16LE(map.mapPara(r.data.readUInt16LE(8)), 8);
      r.data.writeUInt8(Math.min(map.mapStyle(r.data.readUInt8(10)), 255), 10);
    } else if (r.tag === TAG.PARA_CHAR_SHAPE) {
      for (let o = 0; o + 8 <= r.data.length; o += 8) r.data.writeUInt32LE(map.mapChar(r.data.readUInt32LE(o + 4)), o + 4);
    } else if (r.tag === TAG.TABLE && r.data.length >= 18) {
      const rows = r.data.readUInt16LE(4);
      const o = 18 + rows * 2;
      if (o + 2 <= r.data.length) r.data.writeUInt16LE(map.mapBorder(r.data.readUInt16LE(o)), o);
      if (o + 4 <= r.data.length) {
        const zones = r.data.readUInt16LE(o + 2);
        for (let z = 0; z < zones; z++) {
          const at = o + 4 + z * 10 + 8;
          if (at + 2 <= r.data.length) r.data.writeUInt16LE(map.mapBorder(r.data.readUInt16LE(at)), at);
        }
      }
    } else if (r.tag === TAG.LIST_HEADER && r.data.length >= 34) {
      const top = cellLevels[cellLevels.length - 1];
      if (top && r.level === top.level) r.data.writeUInt16LE(map.mapBorder(r.data.readUInt16LE(32)), 32);
    }
  }
  return out;
}

/** 검증 — 본문이 가리키는 번호가 모두 DocInfo 범위 안인가. 한글이 「손상」으로 보는 또 하나의 지점이다 */
export function checkReferences(docInfo: readonly HwpRecord[], body: readonly HwpRecord[]): string[] {
  const p = parseDocInfo(docInfo);
  const bad: string[] = [];
  const nPara = p.para.length;
  const nStyle = p.style.length;
  const nChar = p.char.length;
  const nBorder = p.border.length;
  body.forEach((r, i) => {
    if (r.tag === TAG.PARA_HEADER && r.data.length >= 11) {
      if (r.data.readUInt16LE(8) >= nPara) bad.push(`#${i} 문단 모양 ${r.data.readUInt16LE(8)} ≥ ${nPara}`);
      if (r.data.readUInt8(10) >= nStyle) bad.push(`#${i} 스타일 ${r.data.readUInt8(10)} ≥ ${nStyle}`);
    } else if (r.tag === TAG.PARA_CHAR_SHAPE) {
      for (let o = 0; o + 8 <= r.data.length; o += 8) if (r.data.readUInt32LE(o + 4) >= nChar) bad.push(`#${i} 글자 모양 ${r.data.readUInt32LE(o + 4)} ≥ ${nChar}`);
    } else if (r.tag === TAG.LIST_HEADER && r.data.length >= 34) {
      const b = r.data.readUInt16LE(32);
      if (b > nBorder) bad.push(`#${i} 칸 테두리 ${b} > ${nBorder}`);
    }
  });
  for (const c of p.char) {
    const d = c[0].data;
    for (let l = 0; l < LANGS; l++) if (d.readUInt16LE(l * 2) >= p.faces[l].length) bad.push(`글자 모양의 글꼴 ${l}:${d.readUInt16LE(l * 2)} 범위 밖`);
    if (d.readUInt16LE(68) > nBorder) bad.push(`글자 모양의 테두리 ${d.readUInt16LE(68)} 범위 밖`);
  }
  for (const s of p.style) {
    const d = s[0].data;
    const o = styleTail(d);
    if (d.readUInt16LE(o + 4) >= nPara || d.readUInt16LE(o + 6) >= nChar) bad.push(`스타일 「${styleName(d)}」의 모양 번호 범위 밖`);
  }
  return bad;
}
