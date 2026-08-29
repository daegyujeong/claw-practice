/**
 * ─────────────────────────────────────────────────────────────
 * 2.7 Alarms — DO가 정해진 시각에 스스로 깨어난다
 * ─────────────────────────────────────────────────────────────
 * 이번 챕터: 카운터가 30 이상이 되면 10초 뒤 알람을 걸고,
 *            알람이 울리면 alarm()이 카운터를 0으로 되돌린다.
 *
 * ★ 알람의 두 가지 규칙
 *   ① DO 하나에 알람은 동시에 하나만 (setAlarm은 기존 알람을 덮어쓴다!)
 *   ② 시각이 되면 Cloudflare가 alarm() 메서드를 호출한다
 *   하이버네이션돼도 알람은 저장소에 남아 있다가 제때 DO를 깨운다.
 *   1년 뒤 알람도 가능 — "가입 일주일 뒤 이메일" 같은 예약 작업의 토대다.
 *
 * ★ 단일 스레드의 조건 (2.5 보충)
 *   "한 번에 한 요청"은 자기 저장소 안에서 일할 때만이다.
 *   메서드 안에서 await fetch(...) 같은 외부 대기를 만나면 잠금이 풀려서
 *   같은 메서드 두 개가 동시에 돌 수 있다. (increase 안의 await getAlarm은
 *   저장소 작업이라 안전하다.)
 *
 * ★ 알람이 여러 개 필요하면
 *   alarms 테이블에 예약 목록을 저장해 두고, alarm()이 울릴 때마다
 *   "다음으로 빠른 알람"을 찾아 setAlarm으로 이어 건다 (체인).
 *   Section 3의 Agent 클래스는 이 패턴을 schedule()로 내장하고 있다.
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
     * 카운터를 1 올리고 현재 값을 돌려준다. 30 이상이면 10초 뒤 리셋 알람을 건다.
     *
     * ★ RETURNING (SQLite 문법): 2.5의 "SELECT로 읽고 → UPDATE로 쓰기" 두 단계를
     *   한 문장으로 합쳤다. 읽기와 쓰기 사이의 틈이 문법적으로 사라지므로
     *   외부 await가 끼어들 자리도 없다.
     */
    async increase() {
        const { total } = this.sql.exec('UPDATE pongs SET total = total + 1 WHERE id = 1 RETURNING total;').one() as { total: number };

        if (total >= 30) {
            // ★ 함정: getAlarm()은 Promise다! (sql.exec만 동기, storage의 나머지는 비동기)
            //   await를 빼면 Promise 객체와 null을 비교해 항상 false → 알람이 영영 안 걸린다.
            const currentAlarm = await this.ctx.storage.getAlarm();
            console.log('alarm', currentAlarm);
            if (currentAlarm === null) {
                // 이미 걸린 알람이 없을 때만 예약한다. 확인 없이 매번 setAlarm하면
                // 요청마다 알람이 10초씩 뒤로 밀려(덮어쓰기) 영영 안 울릴 수 있다.
                this.ctx.storage.setAlarm(Date.now() + 10_000);
                // await를 안 붙여도 동작한다(출력 게이트: 쓰기가 확정되기 전엔 응답이
                // 안 나감). 다만 실패를 잡으려면 await this.ctx.storage.setAlarm(...)이 안전.
            }
        }

        return `count is ${total}`;
    }

    /**
     * 알람이 울리면 Cloudflare가 호출한다. 여기서 카운터를 리셋.
     * 잡히지 않은 예외가 나면 실패로 간주 → 최대 6회 재시도(2초부터 지수 백오프).
     * 핸들러는 alarm(info)로 { retryCount, isRetry }를 받을 수 있다.
     */
    alarm() {
        this.sql.exec('UPDATE pongs SET total = 0 WHERE id = 1');
        // 알람이 여러 개라면: 여기서 alarms 테이블을 조회해 다음 알람을 setAlarm (체인)
    }

    ping() {
        return 'pong';
    }
}
