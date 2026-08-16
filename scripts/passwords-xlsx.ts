/**
 * 전 인원 임시 비밀번호를 **엑셀 한 장**으로 모은다 (본부 → 실 → 정렬순).
 *
 *   npx tsx scripts/passwords-xlsx.ts [출력경로]
 *
 * 왜 CSV가 아니라 xlsx인가: **엑셀이 CSV를 열 때 값을 고쳐 버린다.**
 * 비밀번호가 숫자·날짜처럼 생겼으면 서식을 바꿔 다른 글자가 되고, 앞의 0도 사라진다.
 * 전달용 문서에서 그건 치명적이다. xlsx는 셀을 글자로 못박을 수 있다.
 *
 * 평문은 **여기 있는 파일이 유일한 사본**이다 — 서버에는 해시만 있다.
 * 그래서 이 스크립트는 새로 발급하지 않고 이미 뽑아둔 파일을 모으기만 한다
 * (재발급하면 지금 쓰는 비밀번호가 전부 무효가 된다).
 *
 * 출력은 docs/private/ 아래에 둔다 (git 제외).
 */
import { createWriteStream, readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ZipArchive } from 'archiver'; // v8+ 클래스 API
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const SRC_DIRS = ['docs/private/passwords', 'docs/private'];

interface Row {
  parent: string;
  division: string;
  name: string;
  email: string;
  password: string;
  role: string;
  onRoster: boolean;
}

/** BOM·따옴표를 감안한 최소 CSV 파서 — 우리가 만든 파일만 읽으므로 이 정도면 충분하다 */
function readCsv(file: string): Record<string, string>[] {
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const head = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = l.split(',').map((c) => c.replace(/^"|"$/g, '').trim());
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? '']));
  });
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 모든 셀을 **글자**로 쓴다 (inlineStr) — 엑셀이 값을 해석해 고치지 못하게 */
function sheetXml(rows: Row[]): string {
  const header = ['본부', '부서', '이름', '이메일', '임시 비밀번호', '역할', '제출 대상'];
  const cell = (c: number, r: number, v: string, style = 0) =>
    `<c r="${String.fromCharCode(65 + c)}${r}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;

  const body = rows
    .map((row, i) => {
      const r = i + 2;
      const vals = [row.parent, row.division, row.name, row.email, row.password, row.role, row.onRoster ? 'Y' : '—'];
      return `<row r="${r}">${vals.map((v, c) => cell(c, r, v)).join('')}</row>`;
    })
    .join('');

  // 요소 순서가 규격에 못박혀 있다: sheetPr → sheetViews → cols → sheetData → autoFilter.
  // 순서가 어긋나면 엑셀·LibreOffice가 파일을 아예 못 연다 (실제로 겪었다).
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>
<col min="1" max="1" width="20" customWidth="1"/><col min="2" max="2" width="20" customWidth="1"/><col min="3" max="3" width="10" customWidth="1"/>
<col min="4" max="4" width="26" customWidth="1"/><col min="5" max="5" width="18" customWidth="1"/><col min="6" max="6" width="12" customWidth="1"/><col min="7" max="7" width="10" customWidth="1"/>
</cols>
<sheetData>
<row r="1">${header.map((h, c) => cell(c, 1, h, 1)).join('')}</row>
${body}
</sheetData>
<autoFilter ref="A1:G${rows.length + 1}"/>
</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF5F0E0"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="표준" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;

async function main() {
  const out = process.argv[2] ?? `docs/private/Tincase_전인원_임시비밀번호_${new Date().toISOString().slice(0, 10)}.xlsx`;

  // 평문 모으기 (재발급하지 않는다)
  const byEmail = new Map<string, string>();
  for (const dir of SRC_DIRS) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.csv')) continue;
      for (const r of readCsv(path.join(dir, f))) {
        if (r['이메일'] && r['임시비밀번호']) byEmail.set(r['이메일'], r['임시비밀번호']);
      }
    }
  }

  // 조직 정보는 DB가 정본 (부서·역할·제출대상은 그동안 바뀌었을 수 있다)
  const users = await prisma.user.findMany({
    where: { isActive: true },
    include: { division: { select: { nameKo: true, parentKo: true } } },
    orderBy: [{ division: { parentKo: 'asc' } }, { division: { nameKo: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
  });

  const rows: Row[] = [];
  const missing: string[] = [];
  for (const u of users) {
    const pw = byEmail.get(u.email);
    if (!pw) {
      missing.push(`${u.division.nameKo} ${u.name}`);
      continue;
    }
    rows.push({
      parent: u.division.parentKo === '한국환경연구원' ? '본부 직속' : u.division.parentKo,
      division: u.division.nameKo,
      name: u.name,
      email: u.email,
      password: pw,
      role: u.isOperator ? '운영자' : u.isCoordinator ? '총괄' : u.divisionRole === 'lead' ? '부서담당자' : '제출자',
      onRoster: u.onRoster,
    });
  }

  const zip = new ZipArchive({ zlib: { level: 9 } });
  const stream = createWriteStream(out, { mode: 0o600 }); // 본인만 읽게
  zip.pipe(stream);
  zip.append(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    { name: '[Content_Types].xml' },
  );
  zip.append(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    { name: '_rels/.rels' },
  );
  zip.append(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="임시비밀번호" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    { name: 'xl/workbook.xml' },
  );
  zip.append(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    { name: 'xl/_rels/workbook.xml.rels' },
  );
  zip.append(STYLES, { name: 'xl/styles.xml' });
  zip.append(sheetXml(rows), { name: 'xl/worksheets/sheet1.xml' });
  await zip.finalize();
  await new Promise<void>((r) => stream.on('close', () => r()));

  const divisions = new Set(rows.map((r) => r.division));
  console.log(`${out}`);
  console.log(`  ${rows.length}명 · ${divisions.size}개 부서 · 본부 → 실 → 정렬순`);
  if (missing.length) console.log(`  ⚠ 평문을 못 찾은 인원 ${missing.length}명: ${missing.slice(0, 5).join(', ')}`);
  console.log('  파일 권한 600 · docs/private는 git 제외 · 개인별로만 전달할 것');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
