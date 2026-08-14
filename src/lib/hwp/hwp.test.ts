// S-08 §7 — HM-T01~T05, HM-T15 상당 (읽기 계층 범위).
// 픽스처는 실제 파일 (fixtures/README.md). CI 등 픽스처 없는 환경에선 skip.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import * as CFB from 'cfb';
import path from 'node:path';
import { parseRecords, serializeRecords, paraText } from './record';
import { openHwp } from './ole';
import { extractTables, tableGrid } from './model';
import { readWorklog, validateHwpUpload, UploadValidationError } from './reader';
import { fillTable, packHwp } from './writer';
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
