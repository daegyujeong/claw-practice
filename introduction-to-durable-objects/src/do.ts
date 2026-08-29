/**
 * ─────────────────────────────────────────────────────────────
 * 2.9 Upgrades — 진짜로 WebSocket 연결을 연다
 * ─────────────────────────────────────────────────────────────
 * ★ WebSocketPair = 실 전화기의 양쪽 끝
 *   new WebSocketPair()는 서로 연결된 소켓 두 개를 만든다.
 *   client 끝 → 101 응답에 실어 브라우저에게 준다.
 *   server 끝 → ctx.acceptWebSocket()으로 DO가 보관한다.
 *   이제 브라우저가 client에 말하면 DO의 server에서 들린다.
 *
 * ★ acceptWebSocket을 부르는 순간 세 메서드가 활성화된다 (오버라이드만 하면 됨)
 *   webSocketMessage(ws, message)          : 메시지가 왔을 때
 *   webSocketClose(ws, code, reason, ...)  : 누가 나갔을 때
 *   webSocketError(ws, error)              : 오류가 났을 때
 *
 * ★ 함정: server.accept()가 아니라 this.ctx.acceptWebSocket(server)다!
 *   전자(표준 API)는 DO가 연결을 직접 들고 있어야 해서 하이버네이션이 안 되고
 *   연결 내내 요금이 붙는다. 후자(Hibernation API)는 DO가 잠들어도
 *   Cloudflare가 연결을 붙들고 있다가, 메시지가 오면 DO를 깨워 준다.
 *   (잠들면 메모리는 초기화되고 constructor가 다시 실행된다 — 2.3과 동일)
 *
 * ★ 개발 중 파일을 저장하면 서버가 재시작되어 연결이 전부 끊긴다 (배포도 마찬가지).
 *   버그가 아니다 — 클라이언트가 재접속하면 된다.
 *
 * 터미널 테스트: websocat "ws://localhost:8787/ws?roomId=private&nickname=nico"
 */
import { DurableObject } from 'cloudflare:workers';

export class DurablePotato extends DurableObject<Env> {
    fetch(request: Request) {
        const url = new URL(request.url);
        const nickname = url.searchParams.get('nickname') ?? 'anon';
        const webSocketPair = new WebSocketPair();

        const [client, server] = Object.values(webSocketPair);

        this.ctx.acceptWebSocket(server);

        // nickname은 아직 안 쓴다 — 2.10에서 serializeAttachment로 연결에 붙인다.

        // 101 = Switching Protocols. body 대신 webSocket에 client 끝을 실어 준다.
        return new Response(null, { status: 101, webSocket: client });
    }

    webSocketMessage(ws: WebSocket, message: string) {
        console.log(message);
    }

    webSocketClose(ws: WebSocket) {
        console.log('someone left');
    }
}
