/**
 * ─────────────────────────────────────────────────────────────
 * Practice #4: Realtime Chat Room — ChatRoom DO (여기가 과제)
 * ─────────────────────────────────────────────────────────────
 * 요구사항 체크리스트 (제출 전 전부 ✓ 인지 확인):
 *   [ ] 1. WebSocket 연결을 수락한다
 *   [ ] 2. 들어온 모든 메시지를 연결된 모든 클라이언트에게 전송한다 (broadcast)
 *   [ ] 3. 메시지를 SQL 스토리지에 저장한다
 *   [ ] 4. alarm()이 5분 지난 메시지를 삭제하고, 60초 뒤 알람을 다시 건다
 *   [ ] 5. npx wrangler deploy 로 배포하고 workers.dev URL 제출
 *
 * 노트 참조: notes/section-02-durable-objects.md
 *   8절(알람) · 10절(WebSocket 열기) · 11절(attachment/broadcast)
 */
import { DurableObject } from 'cloudflare:workers';

export class ChatRoom extends DurableObject<Env> {
	sql: SqlStorage;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;

		// 메시지 저장용 테이블. constructor는 깨어날 때마다 실행되므로 멱등하게(IF NOT EXISTS).
		// created_at은 ms 단위 UNIX 시각 — "5분 지난 메시지"를 숫자 비교로 지우기 위해서다.
		this.sql.exec(`
			CREATE TABLE IF NOT EXISTS messages (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				nickname TEXT,
				content TEXT,
				created_at INTEGER
			);
		`);
	}

	/**
	 * 워커가 /ws 요청을 통째로 넘겨주는 곳. (요구사항 1)
	 *
	 * TODO:
	 *  ① request.url에서 nickname 쿼리 파라미터를 꺼낸다 (없으면 'anon')
	 *  ② new WebSocketPair() → [client, server]
	 *  ③ server 쪽: this.ctx.acceptWebSocket(server)  ← Hibernation API. server.accept()가 아니다!
	 *  ④ server.serializeAttachment({ nickname })     ← 나중에 누가 보냈는지 알기 위해
	 *  ⑤ (알람 부트스트랩) 알람이 하나도 안 걸려 있으면 60초 뒤로 하나 건다
	 *     — getAlarm()은 Promise다. await를 빼면 null 비교가 항상 false! (노트 8절의 함정)
	 *  ⑥ client 쪽을 101 응답에 실어 반환: new Response(null, { status: 101, webSocket: client })
	 */
	async fetch(request: Request) {
		// TODO: 위 ①~⑥ 구현
		return new Response('not implemented yet', { status: 501 });
	}

	/**
	 * 받은 메시지를 나 빼고 전원에게 전송. (요구사항 2)
	 *
	 * TODO: this.ctx.getWebSockets()를 순회하며 exclude가 아닌 소켓에 socket.send(message)
	 */
	broadcast(message: string, exclude?: WebSocket) {
		// TODO
	}

	/**
	 * 누군가 메시지를 보냈을 때. (요구사항 2 + 3)
	 *
	 * TODO:
	 *  ① ws.deserializeAttachment()에서 nickname을 꺼낸다
	 *  ② messages 테이블에 INSERT — 값은 반드시 ? 파라미터로! (SQL 인젝션)
	 *     created_at에는 Date.now()
	 *  ③ this.broadcast(`${nickname}: ${message}`, ws)
	 *     (본인 화면에는 클라이언트가 직접 그리게 하거나, exclude 없이 전원에게 보내도 된다 — 선택)
	 */
	webSocketMessage(ws: WebSocket, message: string) {
		// TODO
	}

	/**
	 * 누군가 나갔을 때. (선택이지만 있으면 좋다)
	 * TODO: nickname을 꺼내 `${nickname} has left` 브로드캐스트
	 */
	webSocketClose(ws: WebSocket) {
		// TODO
	}

	/**
	 * 60초마다 깨어나 5분 지난 메시지를 지운다. (요구사항 4)
	 *
	 * TODO:
	 *  ① DELETE FROM messages WHERE created_at < ?  — ?에는 Date.now() - 5분(300_000)
	 *  ② 알람을 다시 건다: this.ctx.storage.setAlarm(Date.now() + 60_000)
	 *     — alarm() 실행 중에는 getAlarm()이 null이므로 확인 없이 바로 걸면 된다 (노트 8절 📘)
	 *
	 * 생각해 볼 것: 이 체인의 "첫" 알람은 누가 거는가? → fetch ⑤ (연결이 처음 생길 때)
	 */
	async alarm() {
		// TODO
	}
}
