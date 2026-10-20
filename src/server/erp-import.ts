// RH-90 — ERP 주간업무보고 PDF → 후보. 글자는 pdftotext(poppler)로 뽑는다 — 표·글상자 없는 인쇄본이라 -layout이면 줄이 그대로 나온다(2026-10 실측).
// 올린 파일은 남기지 않는다(내부 문서): 임시 폴더에 쓰고 읽은 뒤 바로 지운다. 감사 기록에는 수만 남긴다.
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { HttpError } from '@/server/authz';
import { buildCandidates, parseErpText, type ErpCandidate, type ErpEntry } from '@/lib/erp-report';

const run = promisify(execFile);

export const ERP_LIMITS = { files: 10, bytes: 3 * 1024 * 1024 } as const;

export async function pdfText(bytes: Buffer): Promise<string> {
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(422, 'invalid_file', 'PDF 파일이 아닙니다.');
  const dir = await mkdtemp(path.join(tmpdir(), 'erp-'));
  try {
    const f = path.join(dir, 'in.pdf');
    await writeFile(f, bytes, { mode: 0o600 });
    const { stdout } = await run('pdftotext', ['-layout', '-enc', 'UTF-8', f, '-'], { timeout: 15_000, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(422, 'invalid_file', 'PDF에서 글자를 읽지 못했습니다.');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface ErpFileResult {
  name: string;
  unitKo: string | null;
  entries: number;
  /** 뺀 이유 — 없으면 들어갔다 */
  skipped?: string;
}

const squash = (s: string) => s.replace(/\s+/g, '');

/**
 * RH-90 — 파일들 → 후보. `units`는 이 본부와 산하 실의 이름(자문회의 표 순서) — 그 밖 부서의 PDF는 뺀다.
 * 같은 부서 PDF가 두 번 오면 둘 다 읽는다(기간을 나눠 뽑은 경우) — 같은 일은 묶기가 하나로 친다.
 */
export async function erpCandidates(
  files: { name: string; bytes: Buffer }[],
  hqKo: string,
  units: readonly string[],
  today: [number, number],
): Promise<{ files: ErpFileResult[]; candidates: ErpCandidate[] }> {
  const allowed = new Set(units.map(squash));
  const out: ErpFileResult[] = [];
  const entries: ErpEntry[] = [];
  for (const f of files) {
    let text: string;
    try {
      text = await pdfText(f.bytes);
    } catch (e) {
      out.push({ name: f.name, unitKo: null, entries: 0, skipped: e instanceof HttpError ? e.message : 'PDF를 읽지 못했습니다.' });
      continue;
    }
    const r = parseErpText(text);
    if (!r.unit) {
      out.push({ name: f.name, unitKo: null, entries: 0, skipped: 'ERP 주간업무보고 모양이 아닙니다(머리 「[부서명] (기간)」이 없음).' });
      continue;
    }
    if (!allowed.has(squash(r.unit))) {
      out.push({ name: f.name, unitKo: r.unit, entries: 0, skipped: `${r.unit}은(는) 이 본부 소속이 아닙니다.` });
      continue;
    }
    out.push({ name: f.name, unitKo: r.unit, entries: r.entries.length });
    entries.push(...r.entries);
  }
  return { files: out, candidates: buildCandidates(entries, hqKo, today) };
}
