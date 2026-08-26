/**
 * ─────────────────────────────────────────────────────────────
 * 2.4 Durable Object Storage — 내장 SQLite ("하드디스크")
 * ─────────────────────────────────────────────────────────────
 * DO라는 작은 컴퓨터의 구성:
 *   RAM      : 클래스 프로퍼티 (this.count)   → 하이버네이션되면 날아감 (2.3)
 *   하드디스크: ctx.storage.sql (SQLite)       → 하이버네이션·재배포에도 남음 (이번 챕터)
 *   키보드    : 메서드 (increase, ping)        → 워커가 호출
 *
 * ctx.storage 안에는 세 가지가 있다:
 *   - alarm* : 미래의 특정 시각에 DO를 깨우는 알람 (2.7에서 배움)
 *   - get/put: 이 DO 전용 KV (Section 1 KV와 같은 API) — 지금은 SQL 사용을 권장
 *   - sql    : 이 DO 전용 SQLite. 객체마다 완전히 격리된 자기만의 DB
 *
 * ★ SQL인데 await가 없다!
 *   KV는 네트워크 너머에 있어서 `await env.CLAW_KV.get()`처럼 기다려야 했다.
 *   DO의 SQLite는 DO와 "같은 프로세스" 안에 있어서 sql.exec()가 동기로 즉시 끝난다.
 */
import { DurableObject } from 'cloudflare:workers';

export class DurablePotato extends DurableObject<Env> {
	/**
	 * @param ctx - DurableObjectState. storage(저장소), id, blockConcurrencyWhile 등이 들어 있다
	 * @param env - 바인딩 모음 (워커의 env와 같은 것)
	 *
	 * ★ constructor는 "한 번"이 아니라 "여러 번" 실행된다.
	 *   처음 만들어질 때 + 하이버네이션에서 깨어날 때마다 다시 실행된다.
	 *   반면 SQLite 데이터는 하이버네이션을 살아남는다.
	 *   → 여기서 실행하는 SQL은 "몇 번 실행돼도 결과가 같도록"(멱등하게) 써야 한다.
	 */
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		// IF NOT EXISTS가 없으면: 두 번째 깨어날 때 "테이블이 이미 있다"며 에러.
		// pongs 테이블에 행 하나(id=1)만 두고 그 total 컬럼을 카운터로 쓸 계획.
		ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS pongs (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				total INTEGER
			);
		`);

		// OR IGNORE가 없으면: 두 번째 깨어날 때 "id=1이 이미 있다"(PRIMARY KEY 중복) 에러.
		// 초기값 행(id=1, total=0)을 "없을 때만" 넣는다.
		ctx.storage.sql.exec(`
			INSERT OR IGNORE INTO pongs (id, total) VALUES (1, 0);
		`);
	}

	/**
	 * RAM 카운터 — 아직은 프로퍼티에 저장한다.
	 * 다음 챕터(2.5)에서 이 값을 위의 pongs 테이블(하드디스크)로 옮긴다.
	 */
	count = 0;

	increase() {
		this.count++;
		return `count is ${this.count}`;
	}

	ping() {
		return 'pong';
	}
}
