/**
 * ─────────────────────────────────────────────────────────────
 * Practice #3: Stateful Counter — 변경 이력을 스스로 보관하는 카운터 DO
 * ─────────────────────────────────────────────────────────────
 * DO라는 작은 컴퓨터의 구성:
 *   RAM      : 클래스 프로퍼티              → 하이버네이션되면 날아감 (2.3)
 *   하드디스크: ctx.storage.sql (SQLite)    → 하이버네이션·재배포에도 남음 (2.4)
 *   키보드    : 메서드                     → 워커가 RPC로 호출
 *
 * 설계: 테이블은 history 하나만 쓴다.
 *   - 카운트가 바뀔 때마다 새 행을 INSERT 한다 (UPDATE는 없다)
 *   - "현재 카운트" = history의 마지막 행의 count_after (행이 없으면 0)
 *   → 강의의 pongs(행 하나를 UPDATE) 방식과 달리, 값과 이력이 한 곳에 있어 어긋날 수 없다.
 *
 * ★ 동시성: DO는 한 번에 한 요청만 처리한다. change()의 "읽기 → INSERT" 사이에
 *   await가 없으므로 두 사용자가 동시에 눌러도 증가가 유실되지 않는다.
 *
 * ★ IP·도시·국가는 이 파일에 없다. request는 워커(index.ts)에만 있으므로
 *   워커가 뽑아서 메서드 인자(Visitor)로 넘겨준다. RPC 인자는 JSON처럼 직렬화 가능한 값만 된다.
 */
import { DurableObject } from 'cloudflare:workers';

/** 워커가 request에서 뽑아 넘겨주는 방문자 정보 */
export type Visitor = { ip: string; city: string; country: string };

/** history 테이블 한 행 (GET /history 응답 형태) */
export type HistoryRow = {
    id: number;
    action: 'increment' | 'decrement';
    count_after: number;
    ip: string;
    city: string;
    country: string;
    created_at: string;
};

export class DurableCounter extends DurableObject<Env> {
    // ctx.storage.sql을 매번 쓰기 길어서 줄여 둔 것. 메서드에서 this.sql로 쓴다.
    sql: SqlStorage;

    /**
     * constructor는 처음 생성될 때 + 하이버네이션에서 깨어날 때마다 실행된다.
     * 그래서 아래 SQL은 몇 번 실행돼도 안전하도록(IF NOT EXISTS) 쓴다.
     * 초기 행은 넣지 않는다 — "행이 없으면 0"이 곧 초기 상태다.
     */
    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);

        this.sql = ctx.storage.sql;

        this.sql.exec(`
			CREATE TABLE IF NOT EXISTS history (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				action TEXT NOT NULL,                  -- 'increment' | 'decrement'
				count_after INTEGER NOT NULL,          -- 변경 후 값
				ip TEXT,
				city TEXT,
				country TEXT,
				created_at TEXT DEFAULT CURRENT_TIMESTAMP
			);
		`);
    }

    // ───────────── 내부 도우미 (워커에서 직접 부르지 않음) ─────────────

    /**
     * 현재 카운트 = history의 마지막 행. 행이 하나도 없으면(첫 요청 전) 0.
     *
     * .one()은 결과가 0행이면 예외를 던지므로 여기서는 못 쓴다.
     * .toArray()[0]은 0행이면 undefined → `?? 0`으로 초기값 처리.
     */
    private currentCount(): number {
        const row = this.sql
            .exec(`SELECT count_after FROM history ORDER BY id DESC LIMIT 1`)
            .toArray()[0] as { count_after: number } | undefined;
        return row?.count_after ?? 0;
    }

    /**
     * increment / decrement 공통 처리: 읽기 → 새 값 계산 → 이력 INSERT.
     *
     * ★ 값은 반드시 ? 자리표시자로 넘긴다 (파라미터 쿼리).
     *   ip·city·country는 외부에서 온 문자열이라 문자열에 직접 끼워 넣으면 SQL 인젝션에 노출된다.
     *   created_at은 DEFAULT CURRENT_TIMESTAMP라 INSERT에서 생략하면 SQLite가 채운다.
     *
     * @param action  이력에 남길 동작 이름
     * @param delta   +1 또는 -1
     * @param visitor 워커가 넘겨준 방문자 정보
     * @returns 변경 후 카운트
     */
    private change(action: HistoryRow['action'], delta: 1 | -1, visitor: Visitor): number {
        const next = this.currentCount() + delta;
        this.sql.exec(
            `INSERT INTO history (action, count_after, ip, city, country) VALUES (?, ?, ?, ?, ?)`,
            action,
            next,
            visitor.ip,
            visitor.city,
            visitor.country,
        );
        return next;
    }

    // ───────────── 워커가 호출하는 공개 메서드 (키보드) ─────────────

    /** POST /increment — count를 1 늘리고 이력을 남긴다. 변경 후 값을 돌려준다. */
    increase(visitor: Visitor): number {
        return this.change('increment', 1, visitor);
    }

    /** POST /decrement — count를 1 줄이고 이력을 남긴다. 변경 후 값을 돌려준다. */
    decrease(visitor: Visitor): number {
        return this.change('decrement', -1, visitor);
    }

    /** GET /count — 현재 count. 아직 아무도 누르지 않았으면 0. */
    getCount(): number {
        return this.currentCount();
    }

    /**
     * GET /history — 최근 변경 이력을 최신순으로 돌려준다.
     * 과제 요구사항: 최근 100건. 매개변수로 두어 필요하면 줄일 수 있게 했다.
     *
     * LIMIT에도 ? 를 쓴다 — 숫자라도 습관적으로 파라미터로 넘기는 편이 안전하다.
     */
    getHistory(limit = 100): HistoryRow[] {
        return this.sql
            .exec(`SELECT * FROM history ORDER BY id DESC LIMIT ?`, limit)
            .toArray() as HistoryRow[];
    }
}
