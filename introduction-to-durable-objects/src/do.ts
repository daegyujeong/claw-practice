/**
 * ─────────────────────────────────────────────────────────────
 * 2.8 WebSockets — 요청을 통째로 DO에게 넘기기
 * ─────────────────────────────────────────────────────────────
 * 카운터에서 채팅방으로 전환한다. 이전의 constructor / increase / alarm은
 * 강의를 따라 모두 삭제했다 (알람 예제는 커밋 "2.7 Alarms"에 남아 있다).
 *
 * ★ 구조가 바뀐다 — 이번 챕터의 전부
 *   [지금까지] 워커가 dp.increase()를 호출하고, 응답은 워커가 만들었다.
 *              DO는 HTTP를 전혀 몰랐다 (RPC 메서드만 있었다).
 *   [이제부터] 워커는 요청을 통째로 dp.fetch(request)로 넘기고,
 *              DO가 직접 HTTP 응답을 만든다. 워커 = 문지기.
 *
 * 왜? WebSocket 연결을 열려면 "그 요청"이 필요하고, 연결을 계속 들고 있을
 * 수 있는 쪽은 곧 죽는 워커가 아니라 DO이기 때문이다. 실제 연결 열기는 2.9에서.
 *
 * fetch는 DO의 특별한 메서드다: Request를 받아 Response를 돌려주는
 * "작은 HTTP 서버" 역할. (HTTP 흐름이 아닌 일은 여전히 RPC 메서드가 권장)
 */
import { DurableObject } from 'cloudflare:workers';

export class DurablePotato extends DurableObject<Env> {
	fetch(request: Request) {
		return new Response('hello');
	}
}
