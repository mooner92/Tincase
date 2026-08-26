// RS-02~12 — ERP 인원 현황(xlsx) → Tincase 인원 최신화.
//
// KEI는 신입·퇴사가 잦은데 ERP에 API가 없다. 그래서 **주 1회 운영자가 엑셀을 뽑아 올린다.**
// 이 파일은 «올린 엑셀과 지금 DB의 차이»를 계산하고, 승인하면 적용한다.
//
// 설계의 중심은 «잘 반영하는 것»이 아니라 **«잘못 반영되지 않는 것»**이다.
// 엑셀 한 번 잘못 뽑으면(필터가 걸린 채로 저장하는 실수) 멀쩡한 사람 수백 명이 잠긴다.
// 그래서:
//   1. 계획(plan)과 적용(apply)을 나눈다 — 사람이 보고 승인해야 반영된다
//   2. 대량 이탈은 **막는다** — 한 번에 10명 넘게 사라지면 «엑셀이 잘못 뽑혔다»고 본다
//   3. 사람이 정한 값은 엑셀이 덮지 않는다 — 담당자·집계여부·알림설정·비밀번호
//   4. 담당자가 사라지면 **반드시 알린다** — 조용히 넘어가면 그 부서가 무주공산이 된다
import type { PrismaClient } from '@prisma/client';

/** ERP 엑셀에서 반드시 있어야 하는 열 */
export const REQUIRED_COLUMNS = ['상위부서', '부서', '사번', '성명', '직책', 'E-MAIL'] as const;

/** RS-11 — 한 번에 이보다 많이 사라지면 적용을 막는다 */
export const MAX_DEACTIVATIONS = 10;

/** 부서의 장. 이 직책이면 `head`가 된다 (ADR-0008) */
const HEAD_TITLES = ['실장', '본부장', '단장', '센터장'];

export interface ErpPerson {
  parentKo: string;
  divisionKo: string;
  employeeNo: string;
  name: string;
  jobTitle: string;
  email: string;
}

export interface DbPerson {
  id: string;
  email: string;
  name: string;
  divisionId: string;
  divisionKo: string;
  divisionRole: string;
  employeeNo: string | null;
  jobTitle: string | null;
  onRoster: boolean;
  rosterNote: string | null;
  isActive: boolean;
  isOperator: boolean;
  isCoordinator: boolean;
}

/**
 * RS-05 — 직책에서 역할을 유도한다. **`lead`는 유도되지 않는다** —
 * 담당자는 취합게시판 답변일자를 근거로 운영자가 직접 지정하는 값이고,
 * ERP는 그런 걸 모른다. 이미 담당자면 직책이 무엇이든 담당자로 남는다 (ADR-0008).
 */
export function deriveRole(jobTitle: string, currentRole?: string): 'member' | 'lead' | 'head' {
  if (currentRole === 'lead') return 'lead';
  return HEAD_TITLES.includes(jobTitle) ? 'head' : 'member';
}

/**
 * RS-06 — 집계 대상인가. **`직책`이 「담당」이 아니면 제외**한다 —
 * 원장·부원장·실장·본부장은 매주 업무일지를 쓰는 사람이 아니다 (DM-16).
 * 337명 중 332명이 이 규칙과 맞았고, 어긋난 5명은 휴직 등 **사람이 정한 예외**다.
 */
export function deriveOnRoster(jobTitle: string): boolean {
  return jobTitle === '담당' || jobTitle === '';
}

export type ChangeKind = 'create' | 'move' | 'title' | 'rename' | 'employeeNo' | 'deactivate' | 'reactivate';

export interface Change {
  kind: ChangeKind;
  /** 사람 식별용. `create`면 null */
  userId: string | null;
  name: string;
  /** 사람이 읽는 한 줄 */
  detail: string;
  /** 적용할 값 */
  apply: {
    email?: string;
    name?: string;
    divisionKo?: string;
    employeeNo?: string;
    jobTitle?: string;
    divisionRole?: string;
    onRoster?: boolean;
    rosterNote?: string | null;
    isActive?: boolean;
  };
}

export interface SyncPlan {
  /** 엑셀에서 읽은 인원 수 */
  totalRows: number;
  /** **사람이 보고 승인할** 변경. 화면에 줄줄이 나온다 */
  changes: Change[];
  /**
   * RS-16 — 사람에게 보여줄 것이 없는 **기록용 채움**. 지금은 `jobTitle` 하나다.
   *
   * 직책을 처음 저장하는 것 자체는 아무 동작도 바꾸지 않지만 **반드시 저장돼야** 한다.
   * 저장이 안 되면 다음 주에도 「첫 채움」이라 «직책이 바뀌었는가»를 영영 못 본다 —
   * 즉 승진·보직변경이 조용히 무시된다. 이걸 `changes`에 넣으면 첫 주에만 300줄이
   * 화면을 덮어 정작 볼 것(퇴사·부서이동)이 묻힌다. 그래서 적용은 하되 보여주지 않는다.
   */
  backfills: Change[];
  /** 새로 만들어야 하는 부서 (엑셀에는 있고 DB에는 없음) */
  newDivisions: { nameKo: string; parentKo: string }[];
  /** 담당자가 사라졌다 — 반드시 사람이 보아야 한다 (RS-10) */
  leadWarnings: string[];
  /** 이름은 같은데 사번·이메일이 엇갈린 사람 등 — 건드리지 않고 알린다 */
  conflicts: string[];
  /** 이게 비어 있지 않으면 **적용할 수 없다** (RS-11) */
  blockers: string[];
  /** 바뀌지 않은 사람 수 */
  unchanged: number;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * RS-04 — **순수 함수.** DB도 파일도 건드리지 않는다.
 * 이 함수가 순수해야 «이 엑셀이면 무슨 일이 벌어지는가»를 테스트로 못 박을 수 있다.
 */
export function planRosterSync(
  db: DbPerson[],
  erp: ErpPerson[],
  knownDivisions: string[],
  maxDeactivations = MAX_DEACTIVATIONS,
): SyncPlan {
  const changes: Change[] = [];
  const backfills: Change[] = [];
  const conflicts: string[] = [];
  const leadWarnings: string[] = [];
  let unchanged = 0;

  const byNo = new Map(db.filter((u) => u.employeeNo).map((u) => [u.employeeNo!, u]));
  const byMail = new Map(db.map((u) => [norm(u.email), u]));
  const matched = new Set<string>();

  // ── 부서 ──────────────────────────────────────────────
  const known = new Set(knownDivisions);
  const newDivisions: { nameKo: string; parentKo: string }[] = [];
  for (const p of erp) {
    if (known.has(p.divisionKo) || newDivisions.some((d) => d.nameKo === p.divisionKo)) continue;
    newDivisions.push({ nameKo: p.divisionKo, parentKo: p.parentKo });
  }

  // ── 사람 ──────────────────────────────────────────────
  for (const p of erp) {
    const hitNo = byNo.get(p.employeeNo);
    const hitMail = byMail.get(norm(p.email));

    // RS-08 — 사번과 이메일이 **서로 다른 사람**을 가리키면 손대지 않는다.
    // 둘 중 뭐가 맞는지 코드가 정할 수 없다 — 잘못 고르면 남의 계정을 덮어쓴다
    if (hitNo && hitMail && hitNo.id !== hitMail.id) {
      conflicts.push(
        `${p.divisionKo}/${p.name}: 사번(${p.employeeNo})은 ${hitNo.name}, 이메일(${p.email})은 ${hitMail.name}을 가리킵니다 — 건너뜀`,
      );
      matched.add(hitNo.id);
      matched.add(hitMail.id);
      continue;
    }

    const cur = hitNo ?? hitMail;

    if (!cur) {
      changes.push({
        kind: 'create',
        userId: null,
        name: p.name,
        detail: `${p.divisionKo} · ${p.jobTitle} · 사번 ${p.employeeNo}${deriveOnRoster(p.jobTitle) ? '' : ' (집계 제외)'}`,
        apply: {
          email: p.email,
          name: p.name,
          divisionKo: p.divisionKo,
          employeeNo: p.employeeNo,
          jobTitle: p.jobTitle,
          divisionRole: deriveRole(p.jobTitle),
          onRoster: deriveOnRoster(p.jobTitle),
          rosterNote: deriveOnRoster(p.jobTitle) ? null : p.jobTitle,
          isActive: true,
        },
      });
      continue;
    }

    matched.add(cur.id);
    const apply: Change['apply'] = {};
    const notes: string[] = [];

    if (cur.divisionKo !== p.divisionKo) {
      apply.divisionKo = p.divisionKo;
      notes.push(`부서 ${cur.divisionKo} → ${p.divisionKo}`);
    }
    if (cur.name !== p.name) {
      apply.name = p.name;
      notes.push(`이름 ${cur.name} → ${p.name}`);
    }
    if (cur.employeeNo !== p.employeeNo) {
      apply.employeeNo = p.employeeNo;
      notes.push(`사번 ${cur.employeeNo ?? '없음'} → ${p.employeeNo}`);
    }
    if (norm(cur.email) !== norm(p.email)) {
      apply.email = p.email;
      notes.push(`이메일 ${cur.email} → ${p.email}`);
    }
    if (!cur.isActive) {
      apply.isActive = true;
      notes.push('비활성 → 활성 (엑셀에 다시 나타남)');
    }

    /*
     * RS-07 — 직책이 **바뀌었을 때만** 역할·집계를 다시 유도한다.
     *
     * 안 바뀌었는데 매주 덮어쓰면 사람이 손으로 정한 예외(휴직·작성X)가 지워진다.
     * 바뀌었다면 승진·보직변경이므로 따라가는 게 맞다.
     * `jobTitle`이 null인 사람은 이 기능 이전에 만들어진 계정이라 **처음 한 번만** 채운다.
     */
    if (cur.jobTitle !== p.jobTitle) {
      apply.jobTitle = p.jobTitle;
      const first = cur.jobTitle === null;
      const role = deriveRole(p.jobTitle, cur.divisionRole);
      const roster = deriveOnRoster(p.jobTitle);
      if (role !== cur.divisionRole) {
        apply.divisionRole = role;
        notes.push(`역할 ${cur.divisionRole} → ${role}`);
      }
      /*
       * RS-09 — 첫 채움에서는 **제외 방향으로만** 반영한다.
       *
       * 제외 사유에는 ERP가 아는 것(직책)과 **사람만 아는 것**(휴직·작성X)이 섞여 있다.
       * 직책이 처음 들어오는 순간 규칙을 양방향으로 적용하면, 「담당인데 휴직이라 뺐다」가
       * 「담당이니 넣어라」로 뒤집혀 수동 예외가 통째로 지워진다.
       *
       * 반대로 «직책상 제외인데 포함돼 있다»(부원장 같은 경우)는 규칙이 옳으므로 반영한다.
       * 한 번 `jobTitle`이 채워진 뒤부터는 직책이 **바뀐** 경우만 보므로 양방향으로 연다.
       */
      const allowRosterChange = first ? !roster && cur.onRoster : roster !== cur.onRoster;
      if (allowRosterChange) {
        apply.onRoster = roster;
        apply.rosterNote = roster ? null : p.jobTitle;
        notes.push(`집계 ${cur.onRoster ? '포함' : '제외'} → ${roster ? '포함' : '제외'} (${p.jobTitle})`);
      }
      if (!first) notes.push(`직책 ${cur.jobTitle ?? '없음'} → ${p.jobTitle}`);
    }

    if (notes.length === 0) {
      // 보여줄 것은 없지만 저장할 것이 남았는가 (직책 첫 채움) — RS-16
      if (apply.jobTitle !== undefined) {
        backfills.push({ kind: 'title', userId: cur.id, name: p.name, detail: `직책 기록 (${p.jobTitle})`, apply });
      } else {
        unchanged++;
      }
      continue;
    }
    changes.push({
      kind: apply.divisionKo ? 'move' : apply.jobTitle ? 'title' : apply.name ? 'rename' : 'employeeNo',
      userId: cur.id,
      name: p.name,
      detail: notes.join(' · '),
      apply,
    });
  }

  // ── 엑셀에 없는 사람 = 퇴사 ────────────────────────────
  const gone = db.filter((u) => u.isActive && !matched.has(u.id));
  for (const u of gone) {
    changes.push({
      kind: 'deactivate',
      userId: u.id,
      name: u.name,
      detail: `${u.divisionKo} · 엑셀에 없음${u.divisionRole === 'lead' ? ' · **부서 담당자**' : ''}`,
      apply: { isActive: false },
    });
    // RS-10 — 담당자가 사라지면 그 부서는 병합본을 받아 제출할 사람이 없어진다.
    // 겉으로는 정상으로 보이므로 **여기서 반드시 말해야** 한다
    if (u.divisionRole === 'lead') {
      leadWarnings.push(`${u.divisionKo} 담당자 ${u.name} 님이 엑셀에 없습니다 — 새 담당자를 지정해 주세요`);
    }
    if (u.isOperator || u.isCoordinator) {
      leadWarnings.push(
        `${u.divisionKo} ${u.name} 님(${u.isOperator ? '시스템관리' : '총괄'})이 엑셀에 없습니다 — 확인이 필요합니다`,
      );
    }
  }

  // ── 안전장치 ─────────────────────────────────────────
  const blockers: string[] = [];
  if (gone.length > maxDeactivations) {
    blockers.push(
      `한 번에 ${gone.length}명이 사라집니다 (허용 ${maxDeactivations}명). ` +
        `엑셀이 필터가 걸린 채로 저장됐을 수 있습니다 — 전체 인원이 담겼는지 확인해 주세요.`,
    );
  }
  if (erp.length === 0) blockers.push('엑셀에서 사람을 한 명도 읽지 못했습니다.');

  return {
    totalRows: erp.length,
    changes,
    backfills,
    newDivisions,
    leadWarnings,
    conflicts,
    blockers,
    unchanged,
  };
}

/** 엑셀 한 행 → ErpPerson. 열 이름이 바뀌면 여기만 고친다 */
export function toErpPerson(row: Record<string, string>): ErpPerson | null {
  const name = (row['성명'] ?? '').trim();
  const email = (row['E-MAIL'] ?? '').trim();
  if (!name || !email) return null; // 합계행·빈 행
  return {
    parentKo: (row['상위부서'] ?? '한국환경연구원').trim(),
    divisionKo: (row['부서'] ?? '').trim(),
    employeeNo: (row['사번'] ?? '').trim(),
    name,
    jobTitle: (row['직책'] ?? '').trim(),
    email,
  };
}

/** 부서 슬러그 — 새 부서를 만들 때만 쓴다. 사람이 나중에 고칠 수 있다 (DM-14) */
function provisionalSlug(nameKo: string): string {
  return `division-${Buffer.from(nameKo, 'utf8').toString('hex').slice(0, 16)}`;
}

/**
 * RS-12 — 계획을 적용한다. **blockers가 있으면 던진다** — 막힌 계획은 적용되지 않는다.
 *
 * 트랜잭션 하나로 묶는 이유: 절반만 반영되면 «누가 어디 소속인지»가 어긋난 상태로 남는데,
 * 그건 다음 주 병합까지 조용히 굴러간다.
 */
export async function applyRosterSync(
  prisma: PrismaClient,
  plan: SyncPlan,
): Promise<{ created: number; updated: number; deactivated: number; divisionsCreated: number }> {
  if (plan.blockers.length > 0) {
    throw new Error(`적용할 수 없습니다: ${plan.blockers.join(' / ')}`);
  }

  let created = 0;
  let updated = 0;
  let deactivated = 0;
  let divisionsCreated = 0;

  await prisma.$transaction(async (tx) => {
    for (const d of plan.newDivisions) {
      await tx.division.create({
        data: {
          nameKo: d.nameKo,
          nameEn: d.nameKo,
          parentKo: d.parentKo,
          slug: provisionalSlug(d.nameKo),
          isActive: false, // TACP-4 — 새 부서는 아무도 못 보는 상태로 태어난다
          boardStatus: 'none',
        },
      });
      divisionsCreated++;
    }

    const divisions = await tx.division.findMany({ select: { id: true, nameKo: true } });
    const divisionId = new Map(divisions.map((d) => [d.nameKo, d.id]));

    // 기록용 채움도 **같이** 적용한다 — 안 하면 다음 주에 직책 변화를 못 본다 (RS-16)
    for (const c of [...plan.changes, ...plan.backfills]) {
      const { divisionKo, ...rest } = c.apply;
      const data: Record<string, unknown> = { ...rest };
      if (divisionKo) {
        const id = divisionId.get(divisionKo);
        if (!id) continue; // 부서를 못 찾으면 사람은 건드리지 않는다
        data.divisionId = id;
      }

      if (c.kind === 'create') {
        await tx.user.create({
          data: {
            email: c.apply.email!,
            name: c.apply.name!,
            divisionId: divisionId.get(c.apply.divisionKo!)!,
            employeeNo: c.apply.employeeNo,
            jobTitle: c.apply.jobTitle,
            divisionRole: c.apply.divisionRole ?? 'member',
            onRoster: c.apply.onRoster ?? true,
            rosterNote: c.apply.rosterNote ?? null,
            // 비밀번호는 여기서 만들지 않는다 — 개인별로 전달해야 하므로 발급은 따로 한다
            passwordHash: null,
            mustChangePassword: true,
          },
        });
        created++;
      } else if (c.userId) {
        await tx.user.update({ where: { id: c.userId }, data });
        if (c.kind === 'deactivate') deactivated++;
        else updated++;
      }
    }
  });

  return { created, updated, deactivated, divisionsCreated };
}
