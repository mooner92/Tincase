// S-08 §7 — HM-T01~T05, HM-T15 상당 (읽기 계층 범위).
// 픽스처는 실제 파일 (fixtures/README.md). CI 등 픽스처 없는 환경에선 skip.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import * as CFB from 'cfb';
import path from 'node:path';
import { parseRecords, serializeRecords, paraText, TAG } from './record';
import { openHwp } from './ole';
import { extractTables, tableGrid } from './model';
import { readWorklog, validateHwpUpload, UploadValidationError } from './reader';
import { fillTable, packHwp, stripCfbSentinel, locateTables } from './writer';
import { createHash } from 'node:crypto';

const FIX = path.resolve(__dirname, '../../../fixtures');
const f = (n: string) => path.join(FIX, n);
const has = existsSync(f('master-template.hwp'));
const d = has ? describe : describe.skip;

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function sectionOf(file: string): Buffer {
  const cf = CFB.read(readFileSync(f(file)), { type: 'buffer' });
  const raw = Buffer.from(CFB.find(cf, '/BodyText/Section0')!.content as Uint8Array);
  return inflateRawSync(raw);
}

d('HM-T01 — 레코드 왕복 바이트 동일성 (필수 게이트)', () => {
  for (const file of ['master-template.hwp', 'sample-filled-w1.hwp', 'sample-filled-w2.hwp']) {
    it(`${file}: serialize(parse(x)) === x`, () => {
      const section = sectionOf(file);
      const rebuilt = serializeRecords(parseRecords(section));
      expect(rebuilt.length).toBe(section.length);
      expect(sha(rebuilt)).toBe(sha(section));
    });
  }
});

d('표 구조 (HM-T02/T03)', () => {
  it('[HM-T02] master-template → 표 3개, 행 9/9/5, 전부 5열', () => {
    const tables = extractTables(parseRecords(sectionOf('master-template.hwp')));
    expect(tables.map((t) => t.rows)).toEqual([9, 9, 5]);
    expect(tables.every((t) => t.cols === 5)).toBe(true);
    // 병합 셀 없음 (실측): 전 셀 1×1
    expect(tables.flatMap((t) => t.cells).every((c) => c.colSpan === 1 && c.rowSpan === 1)).toBe(true);
  });
  it('[HM-T03] sample-filled-w2 → 표 2개 (3번 삭제됨), 행 10/9', () => {
    const tables = extractTables(parseRecords(sectionOf('sample-filled-w2.hwp')));
    expect(tables.length).toBe(2);
    expect(tables.map((t) => t.rows)).toEqual([10, 9]);
  });
  it('헤더 행 셀 값이 실측과 일치', () => {
    const [t1] = extractTables(parseRecords(sectionOf('master-template.hwp')));
    expect(tableGrid(t1)[0]).toEqual(['구분', '업무실적 내용', '일자', '장소', '참석자']);
  });
});

d('읽기 규칙 (HM-T04/T05, HM-15)', () => {
  it('[HM-T04] sample-filled-w2 → 실적 9행·계획 7행·특이 0행', () => {
    const { worklog, warnings } = readWorklog(readFileSync(f('sample-filled-w2.hwp')));
    expect(worklog.achievements.length).toBe(9);
    expect(worklog.plans.length).toBe(7); // 2-8은 빈 행 → 제외 (HM-15e)
    expect(worklog.notes.length).toBe(0);
    expect(warnings.some((w) => w.includes('3번 표'))).toBe(true);
  });
  it('셀 값 실측 대조 — 내용·일자·장소', () => {
    const { worklog } = readWorklog(readFileSync(f('sample-filled-w2.hwp')));
    expect(worklog.achievements[0].content).toBe('인포그래픽 제작');
    expect(worklog.achievements[4]).toEqual({
      content: '데이터기반행정 평가 컨설팅',
      date: '8/12',
      place: '오송앤세종컨퍼런스회의실',
      attendee: '',
    });
  });
  it('[HM-15g] 자리표시자 OO/OO는 빈 값', () => {
    const { worklog } = readWorklog(readFileSync(f('master-template.hwp')));
    // 빈 양식의 1-1 예시행: 일자 "OO/OO" → ''
    expect(worklog.achievements[0].date).toBe('');
  });
  it('[HM-T02 파생] 빈 양식도 예시 4행이 읽힌다', () => {
    const { worklog } = readWorklog(readFileSync(f('master-template.hwp')));
    expect(worklog.achievements.length).toBe(4); // 1-1~1-4 예시, 1-5~1-8 빈 행 제외
  });
});

d('업로드 검증 (ST-T 시리즈)', () => {
  it('[ST-T04/T05] 실제 픽스처 → 통과', () => {
    expect(() => validateHwpUpload(readFileSync(f('master-template.hwp')))).not.toThrow();
    expect(() => validateHwpUpload(readFileSync(f('sample-filled-w2.hwp')))).not.toThrow();
  });
  it('[ST-T02] PNG 바이트 → not_hwp', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(64).fill(0)]);
    expect(() => validateHwpUpload(png)).toThrowError(UploadValidationError);
    try {
      validateHwpUpload(png);
    } catch (e) {
      expect((e as UploadValidationError).reason).toBe('not_hwp');
    }
  });
  it('[ST-T14] ZIP 바이트(.hwpx 위장) → hwpx_not_allowed + 변환 안내', () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Array(32).fill(0)]);
    try {
      validateHwpUpload(zip);
      expect.unreachable();
    } catch (e) {
      const err = e as UploadValidationError;
      expect(err.reason).toBe('hwpx_not_allowed');
      expect(err.message).toContain('다른 이름으로 저장');
    }
  });
  it('[ST-T06] OLE지만 HWP가 아니면 corrupt/no_fileheader 계열 거부', () => {
    // 최소 OLE 헤더 흉내 (실제 파싱은 실패) → not_hwp 또는 corrupt_structure
    const fake = Buffer.alloc(512);
    [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].forEach((b, i) => (fake[i] = b));
    expect(() => validateHwpUpload(fake)).toThrowError(UploadValidationError);
  });
});

d('paraText 제어 문자 처리', () => {
  it('일반 텍스트 + CR 종단', () => {
    const buf = Buffer.from('구분\r', 'utf16le');
    expect(paraText(buf)).toBe('구분');
  });
  it('확장 컨트롤(16바이트)을 건너뛴다', () => {
    // ctrl 11 (표 앵커) + 7유닛 페이로드 + "AB"
    const parts = [Buffer.alloc(16), Buffer.from('AB', 'utf16le')];
    parts[0].writeUInt16LE(11, 0);
    expect(paraText(Buffer.concat(parts))).toBe('AB');
  });
});

d('openHwp 메타', () => {
  it('버전·압축 플래그 실측 일치', () => {
    const file = openHwp(readFileSync(f('master-template.hwp')));
    expect(file.version).toBe('5.1.1.0');
    expect(file.compressed).toBe(true);
    expect(file.sections.length).toBe(1);
    expect(file.previewText).toContain('주요 업무실적');
  });
});

// ── 쓰기 계층 (HM-16) ────────────────────────────────────────
// 핵심 불변식: 행을 늘려도 **원본 서식 레코드를 복제**하므로 규격이 변하지 않는다 (HM-ABS).
d('writer — 표 편집', () => {
  const src = () => readFileSync(f('master-template.hwp'));
  const recsOf = (b: Buffer) => parseRecords(openHwp(b).sections[0]);

  it('[HM-T20] 편집 없이 재조립하면 표 구조가 그대로다', () => {
    const recs = recsOf(src());
    const out = packHwp(src(), [serializeRecords(recs)]);
    const before = readWorklog(src());
    const after = readWorklog(out);
    expect(after.tables.map((t) => [t.rows, t.cols])).toEqual(before.tables.map((t) => [t.rows, t.cols]));
    expect(after.worklog).toEqual(before.worklog);
  });

  it('[HM-T21] 행 확장 — 8행 양식에 20행을 채워도 열 수·표 개수가 유지된다', () => {
    const recs = recsOf(src());
    const rows = [...Array(20)].map((_, i) => [`1-${i + 1}`, `업무 ${i + 1}`, '8/13', '', '']);
    fillTable(recs, 0, rows);
    const back = readWorklog(packHwp(src(), [serializeRecords(recs)]));
    expect(back.tables[0].rows).toBe(21); // 머리글 1 + 데이터 20
    expect(back.tables[0].cols).toBe(5);
    expect(back.tables.length).toBe(3); // 나머지 표는 건드리지 않았다
    expect(back.worklog.achievements.length).toBe(20);
    expect(back.worklog.achievements.at(-1)!.content).toBe('업무 20');
    expect(back.warnings).toEqual([]);
  });

  it('[HM-T22] 행 축소 — 제출 내용이 적으면 빈 행을 남기지 않는다', () => {
    const recs = recsOf(src());
    fillTable(recs, 0, [['1-1', '단독 업무', '', '', '']]);
    const back = readWorklog(packHwp(src(), [serializeRecords(recs)]));
    expect(back.tables[0].rows).toBe(2);
    expect(back.worklog.achievements).toEqual([{ content: '단독 업무', date: '', place: '', attendee: '' }]);
  });

  it('[HM-T23] 빈 셀에도 글자를 넣을 수 있다 (PARA_TEXT 레코드가 없는 셀)', () => {
    const recs = recsOf(src());
    // 원본 1-3행의 장소·참석자는 비어 있다 — 거기에 글자를 넣는다
    fillTable(recs, 0, [
      ['1-1', '첫째', '8/11', '중회의실', '원장'],
      ['1-2', '둘째', '8/12', '소회의실', '부원장'],
      ['1-3', '셋째', '8/13', '대회의실', '연구진'],
    ]);
    const back = readWorklog(packHwp(src(), [serializeRecords(recs)]));
    expect(back.worklog.achievements[2]).toEqual({
      content: '셋째', date: '8/13', place: '대회의실', attendee: '연구진',
    });
  });

  it('[HM-T24] 긴 한글 문자열도 글자 수가 어긋나지 않는다', () => {
    const recs = recsOf(src());
    const long = '가나다라마바사아자차카타파하'.repeat(12); // 168자
    fillTable(recs, 0, [['1-1', long, '', '', '']]);
    const back = readWorklog(packHwp(src(), [serializeRecords(recs)]));
    expect(back.worklog.achievements[0].content).toBe(long);
  });

  it('[HM-T25] 표를 여러 개 동시에 편집해도 서로 침범하지 않는다', () => {
    const recs = recsOf(src());
    fillTable(recs, 0, [...Array(15)].map((_, i) => [`1-${i + 1}`, `실적 ${i + 1}`, '', '', '']));
    fillTable(recs, 1, [['2-1', '계획 하나', '', '', '']]);
    fillTable(recs, 2, [['3-1', '특이 하나', '', '', '']]);
    const back = readWorklog(packHwp(src(), [serializeRecords(recs)]));
    expect(back.worklog.achievements.length).toBe(15);
    expect(back.worklog.plans).toEqual([{ content: '계획 하나', date: '', place: '', attendee: '' }]);
    expect(back.worklog.notes).toEqual([{ content: '특이 하나', date: '', place: '', attendee: '' }]);
  });
});

// -- HM-08a 센티널 제거 --------------------------------------
// cfb는 쓸 때마다 자기 표식 스트림을 넣는데, 한글이 그걸 만나면 문서를 열지 못한다.
// 이 테스트가 깨지면 **생성한 hwp를 아무도 못 연다** — 조용히 실패하는 종류라 게이트로 둔다.
d('writer — cfb 센티널', () => {
  const src = () => readFileSync(f('master-template.hwp'));
  const streams = (b: Buffer) => CFB.read(b, { type: 'buffer' }).FullPaths.map((x) => x.split('/').pop() ?? '');

  it('[HM-T26] 출력에 센티널 스트림이 없다', () => {
    const recs = parseRecords(openHwp(src()).sections[0]);
    fillTable(recs, 0, [['1-1', '검증', '', '', '']]);
    const out = packHwp(src(), [serializeRecords(recs)]);
    expect(streams(out).some((n) => n.includes('Sh33t'))).toBe(false);
  });

  it('[HM-T27] 스트림 목록이 원본과 정확히 같다 — 빠뜨린 것도 더한 것도 없어야 한다', () => {
    const recs = parseRecords(openHwp(src()).sections[0]);
    fillTable(recs, 0, [['1-1', '검증', '', '', '']]);
    const out = packHwp(src(), [serializeRecords(recs)]);
    expect(streams(out).sort()).toEqual(streams(src()).sort());
  });

  it('[HM-T28] 센티널이 없는 입력은 그대로 돌려준다 (두 번 걸어도 안전)', () => {
    const once = stripCfbSentinel(src());
    expect(once.equals(src())).toBe(true);
  });

  it('[HM-T29] 제거 후에도 표를 다시 읽을 수 있다', () => {
    const recs = parseRecords(openHwp(src()).sections[0]);
    fillTable(recs, 0, [...Array(12)].map((_, i) => [`1-${i + 1}`, `행 ${i + 1}`, '', '', '']));
    const back = readWorklog(packHwp(src(), [serializeRecords(recs)]));
    expect(back.worklog.achievements).toHaveLength(12);
    expect(back.worklog.achievements.at(-1)!.content).toBe('행 12');
  });
});

// -- HM-11a 빈 셀 규칙 (한글 실측으로 확인된 게이트) ----------
//
// 한글 양식은 **빈 칸에 PARA_TEXT 레코드를 두지 않는다** (원본 양식 실측: 빈 셀 20개 전부).
// 문단끝 표시만 든 빈 레코드를 넣으면 **한글이 문서를 손상으로 판정한다.**
//
// 이 테스트가 없으면 안 걸린다: 우리 리더도 LibreOffice도 빈 레코드를 그대로 읽는다.
// 실제로 그래서 여섯 번의 확인 왕복 끝에야 원인이 잡혔다.
d('writer — 빈 셀 규칙', () => {
  const src = () => readFileSync(f('master-template.hwp'));
  const cellsOf = (b: Buffer, table = 0) => {
    const recs = parseRecords(openHwp(b).sections[0]);
    const t = locateTables(recs)[table];
    return t.cells.map((c) => ({
      row: c.row,
      col: c.col,
      hasText: recs.slice(c.start, c.end).some((r) => r.tag === TAG.PARA_TEXT),
      nChars: recs.slice(c.start, c.end).find((r) => r.tag === TAG.PARA_HEADER)!.data.readUInt32LE(0) & 0x7fffffff,
    }));
  };

  it('[HM-T30] 원본 양식의 빈 셀에는 PARA_TEXT가 없다 (규칙의 근거)', () => {
    const empty = cellsOf(src()).filter((c) => !c.hasText);
    expect(empty.length).toBeGreaterThan(0);
    for (const c of empty) expect(c.nChars).toBe(1); // 빈 문단도 글자 수는 1 (문단끝 몫)
  });

  it('[HM-T31] 빈 글자를 채워도 PARA_TEXT를 만들지 않는다 ★', () => {
    const recs = parseRecords(openHwp(src()).sections[0]);
    fillTable(recs, 0, [...Array(12)].map((_, i) => [`1-${i + 1}`, `업무 ${i + 1}`, '', '', '']));
    const out = packHwp(src(), [serializeRecords(recs)]);
    // 3·4·5열은 전부 빈 글자였다 → 레코드가 없어야 한다
    for (const c of cellsOf(out).filter((c) => c.row >= 1 && c.col >= 2)) {
      expect(c.hasText, `(${c.row},${c.col})에 빈 PARA_TEXT가 생겼다`).toBe(false);
      expect(c.nChars).toBe(1);
    }
  });

  it('[HM-T32] 글자가 있던 셀을 비우면 레코드를 지운다', () => {
    const recs = parseRecords(openHwp(src()).sections[0]);
    fillTable(recs, 0, [['1-1', '', '', '', '']]); // 1-1은 원래 "제10차 인사위원회"
    const out = packHwp(src(), [serializeRecords(recs)]);
    const c = cellsOf(out).find((x) => x.row === 1 && x.col === 1)!;
    expect(c.hasText).toBe(false);
    expect(c.nChars).toBe(1);
  });

  it('[HM-T33] 빈 칸에 글자를 넣으면 레코드를 만든다 (반대 방향)', () => {
    const recs = parseRecords(openHwp(src()).sections[0]);
    fillTable(recs, 0, [...Array(3)].map((_, i) => [`1-${i + 1}`, `내용 ${i + 1}`, '', '중회의실', '']));
    const out = packHwp(src(), [serializeRecords(recs)]);
    for (const c of cellsOf(out).filter((c) => c.row >= 1 && c.col === 3)) {
      expect(c.hasText).toBe(true);
      expect(c.nChars).toBe('중회의실'.length + 1);
    }
  });

  it('[HM-T34] 표 3개를 동시에 고쳐도 규칙이 유지된다 (실제 병합 조건)', () => {
    const recs = parseRecords(openHwp(src()).sections[0]);
    fillTable(recs, 0, [...Array(20)].map((_, i) => [`1-${i + 1}`, `실적 ${i + 1}`, '', '', '']));
    fillTable(recs, 1, [...Array(10)].map((_, i) => [`2-${i + 1}`, `계획 ${i + 1}`, '', '', '']));
    fillTable(recs, 2, [['3-1', '특이', '', '', '']]);
    const out = packHwp(src(), [serializeRecords(recs)]);
    for (const table of [0, 1, 2]) {
      for (const c of cellsOf(out, table)) {
        // 어떤 셀도 "레코드는 있는데 글자 수가 1" 인 상태여선 안 된다
        expect(c.hasText && c.nChars === 1, `표${table + 1} (${c.row},${c.col}) 빈 레코드`).toBe(false);
      }
    }
  });
});


// ── HM-31 문단 정합성 (한글이 손상 판정하는 조건) ─────────────
//
// PARA_HEADER는 뒤따르는 레코드 개수를 자기 안에 들고 있다. 레코드를 지우거나 더하면서
// 이 수를 안 고치면 한글이 **문서 손상**으로 판정한다. 라이브러리·LibreOffice는 그냥 읽어서
// 이런 실수가 오래 안 드러난다 — 그래서 파일이 아니라 **구조를 직접** 본다.
describe('문단 선언 개수 정합 (HM-T31)', () => {
  const audit = (recs: ReturnType<typeof parseRecords>) => {
    const bad: string[] = [];
    for (let i = 0; i < recs.length; i++) {
      if (recs[i].tag !== TAG.PARA_HEADER || recs[i].data.length < 18) continue;
      const csDeclared = recs[i].data.readUInt16LE(12);
      const lsDeclared = recs[i].data.readUInt16LE(16);
      let cs = 0;
      let ls = 0;
      for (let j = i + 1; j < recs.length; j++) {
        if (recs[j].tag === TAG.PARA_HEADER || recs[j].tag === TAG.LIST_HEADER) break;
        if (recs[j].tag === TAG.PARA_CHAR_SHAPE) cs += recs[j].data.length / 8;
        if (recs[j].tag === TAG.PARA_LINE_SEG) ls += recs[j].data.length / 36;
      }
      if (cs !== csDeclared) bad.push(`문단 ${i}: charShape 선언 ${csDeclared} ≠ 실제 ${cs}`);
      if (ls !== lsDeclared) bad.push(`문단 ${i}: lineSeg 선언 ${lsDeclared} ≠ 실제 ${ls}`);
    }
    return bad;
  };

  it.skipIf(!has)('[HM-T31] 표를 채운 뒤에도 선언 개수와 실제 레코드 수가 맞는다', () => {
    const recs = parseRecords(sectionOf('master-template.hwp'));
    expect(audit(recs), '원본 양식').toEqual([]);

    fillTable(recs, 0, [
      ['1-1', '짧은 업무', '8/18', '온라인', ''],
      ['1-2', '칸 폭을 훌쩍 넘겨 두 줄 이상으로 넘어가야 하는 아주 긴 업무 내용 문장입니다', '8/19', '본원 소회의실', '실장, 팀원 전원'],
      ['1-3', '', '', '', ''],
    ]);
    expect(audit(recs), '채운 뒤').toEqual([]);
  });
});
