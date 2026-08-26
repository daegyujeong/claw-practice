/**
 * ─────────────────────────────────────────────────────────────
 * 2.5 Concurrency — 카운터를 RAM에서 하드디스크(SQLite)로 옮기기
 * ─────────────────────────────────────────────────────────────
 * DO라는 작은 컴퓨터의 구성:
 *   RAM      : 클래스 프로퍼티              → 하이버네이션되면 날아감 (2.3)
 *   하드디스크: ctx.storage.sql (SQLite)    → 하이버네이션·재배포에도 남음 (2.4)
 *   키보드    : 메서드 (increase, ping)     → 워커가 호출
 *
 * 이번 챕터: count 프로퍼티를 없애고 값을 SQLite에만 둔다.
 *   → `npm run dev` 서버를 껐다 켜도, 하이버네이션돼도 숫자가 이어진다.
 *
 * ★ 동시성 — DO는 "한 번에 한 요청"만 처리한다 (단일 스레드)
 *   increase()는 "읽기(total=3) → 쓰기(4)" 두 단계다. 보통 서버라면 그 사이에
 *   다른 사용자가 끼어들어 똑같이 3을 읽고 4를 써서 한 번이 유실될 수 있다
 *   (Section 1의 KV 카운터가 정확히 이 문제를 갖고 있었다).
 *   DO에서는 사용자 A의 increase()가 끝나기 전엔 사용자 B의 increase()가 시작되지 않는다.
 *   플랫폼이 보장하므로 lock이나 트랜잭션 코드가 필요 없다.
 *   단, 읽기와 쓰기 사이에 `await fetch(...)` 같은 외부 대기를 넣으면 그 사이에
 *   다른 요청이 끼어들 수 있다. → "저장소 읽기·쓰기 사이에 외부 await를 두지 말 것"
 *
 * ★ constructor에서 await가 필요하면 (파일 다운로드, KV 읽기 등):
 *   ctx.blockConcurrencyWhile(async () => { await ... });
 *   이 콜백이 끝나기 전까지는 어떤 요청도 DO에 배달되지 않는다 ("준비 끝나고 손님 받기").
 */
import { DurableObject } from 'cloudflare:workers';

export class DurablePotato extends DurableObject<Env> {
	// ctx.storage.sql을 매번 쓰기 길어서 줄여 둔 것. 메서드에서 this.sql로 쓴다.
	sql: SqlStorage;

	/**
	 * constructor는 처음 생성될 때 + 하이버네이션에서 깨어날 때마다 실행된다.
	 * 그래서 아래 SQL은 몇 번 실행돼도 안전하도록(IF NOT EXISTS / OR IGNORE) 쓴다.
	 */
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		this.sql = ctx.storage.sql;

		ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS pongs (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				total INTEGER
			);
		`);

		ctx.storage.sql.exec(`
			INSERT OR IGNORE INTO pongs (id, total) VALUES (1, 0);
		`);
	}

	/**
	 * 카운터를 1 올리고 현재 값을 돌려준다. 값은 pongs 테이블(id=1)의 total 컬럼에 있다.
	 *
	 * SQL인데 await가 없는 이유: SQLite가 DO와 같은 프로세스에 있어서 exec()가 동기다.
	 */
	increase() {
		// ① 읽기. 행이 하나뿐이니 .one()으로 객체 하나를 바로 받는다.
		//    (.one()은 결과가 정확히 1행이 아니면 예외를 던진다 → LIMIT 1을 붙이면 더 안전)
		//    `as { total: number }`는 TypeScript에 컬럼 타입을 알려주는 것.
		const { total } = this.sql.exec(`SELECT total FROM pongs LIMIT 1`).one() as { total: number };

		// ② 쓰기. ★ 값은 반드시 ? 자리표시자로 넘긴다 (파라미터 쿼리).
		//    `SET total = ${total + 1}`처럼 문자열에 직접 끼워 넣으면 SQL 인젝션에 노출된다.
		//    ?는 넘긴 인자 순서대로 치환되고, 인자는 "SQL 코드"가 아니라 "값"으로만 취급된다.
		this.sql.exec(`UPDATE pongs SET total = ? WHERE id = 1`, total + 1);

		return `count is ${total + 1}`;
	}

	ping() {
		return 'pong';
	}
}
