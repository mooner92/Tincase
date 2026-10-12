// NT-56 — 가짜 알림 수신함의 **기록**. 메신저 클라이언트(messenger.ts)가 보낸 폼 한 통 = 한 줄(JSONL).
//
// DB가 아니라 저장소의 파일에 둔다: 시험 전용 기록에 스키마를 늘리면 운영 DB에도 빈 표가 생기고(배포 절차의 `db push`),
// 지울 때도 마이그레이션이 따라온다. 파일은 서버를 바꿔 끼워도(테스트 ↔ 시연 저장소) 그 저장소와 함께 다닌다.
// 리허설 스크립트(scripts/rehearsal.ts)도 같은 파일을 읽는다 — 화면과 판정이 같은 것을 본다.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { env } from './env';
import { storageRoot } from './storage';
import { kindBase, sinkOpen } from '@/lib/messenger-sink';

/** 문이 열려 있나 — 시험·시연 서버 + `MESSENGER_SINK=on` (lib의 판정을 이 서버의 env로) */
export function messengerSinkOpen(): boolean {
  return sinkOpen(env);
}

export interface SinkRecipient {
  employeeNo: string;
  /** 그 사번의 사람 — 없으면(모르는 사번) 빈 값 */
  email: string;
  name: string;
}

export interface SinkEntry {
  id: string;
  /** 받은 시각 ISO */
  at: string;
  /** NotifyLog 종류 그대로(`ru_org_ready:<사람>`). 머리가 없던 호출이면 빈 값 */
  kind: string;
  /** 종류 앞부분 — 거르기용 */
  base: string;
  recipients: SinkRecipient[];
  subject: string;
  contents: string;
  url: string;
  /** 받은 폼 전체 — 클라이언트가 규격대로 보냈는지 나중에 볼 수 있게 */
  form: Record<string, string>;
}

/** 파일이 이보다 크면 뒤쪽만 남긴다 — 시험 서버에서 몇 주 돌아도 저장소를 채우지 않게 */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const KEEP_LINES = 3000;

export function sinkFile(): string {
  return path.join(storageRoot(), 'dev', 'messenger-sink.jsonl');
}

export async function appendSinkEntry(e: Omit<SinkEntry, 'id' | 'at' | 'base'>, at = new Date()): Promise<SinkEntry> {
  const entry: SinkEntry = { id: randomUUID(), at: at.toISOString(), base: kindBase(e.kind), ...e };
  const file = sinkFile();
  await mkdir(path.dirname(file), { recursive: true });
  // 한 줄 append — 동시에 들어와도 줄이 섞이지 않는다(O_APPEND, 한 번의 write)
  await appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');
  const size = (await stat(file)).size;
  if (size > MAX_FILE_BYTES) {
    const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean);
    // 임시 파일 이름은 호출마다 다르게 — 같은 프로세스의 두 요청이 동시에 5MB를 넘기면 같은 임시 파일에 섞어 쓴다
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmp, `${lines.slice(-KEEP_LINES).join('\n')}\n`, 'utf8');
    await rename(tmp, file);
  }
  return entry;
}

/** 줄 하나를 읽는다. 깨진 줄은 건너뛴다 — 기록 하나가 화면 전체를 막지 않게 */
export function parseSinkLines(text: string): SinkEntry[] {
  const out: SinkEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as SinkEntry);
    } catch {
      /* 깨진 줄 */
    }
  }
  return out;
}

/** 받은 순서 그대로(오래된 것 먼저). 파일이 없으면 빈 목록 */
export async function readSinkEntries(): Promise<SinkEntry[]> {
  try {
    return parseSinkLines(await readFile(sinkFile(), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

/** 「비우기」 — 파일을 빈 것으로. 몇 줄을 지웠는지 돌려준다 */
export async function clearSink(): Promise<number> {
  const n = (await readSinkEntries()).length;
  const file = sinkFile();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '', 'utf8');
  return n;
}
