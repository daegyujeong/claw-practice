/**
 * ─────────────────────────────────────────────────────────────
 * 2.10 Messages — 닉네임을 붙이고, 모두에게 뿌린다 (채팅방 완성)
 * ─────────────────────────────────────────────────────────────
 * ★ serializeAttachment — 연결에 작은 데이터를 붙인다
 *   URL로 받은 닉네임을 연결 자체에 저장해 두면, 이후 핸들러에서
 *   ws.deserializeAttachment()로 "누가 보냈는지"를 바로 안다.
 *   하이버네이션을 넘어 유지된다 (메모리 프로퍼티에 두면 잠들 때 날아간다!).
 *   한도 16 KiB — 식별 정보용이다. 큰 데이터는 SQLite에 두고 키만 붙인다.
 *
 * ★ broadcast — 클라이언트끼리는 서로 모른다 (P2P가 아니다)
 *   전원이 같은 DO에 붙어 있을 뿐이므로, 서버가 받은 메시지를
 *   ctx.getWebSockets()(이 DO의 모든 연결)를 순회하며 전달해야 채팅이 된다.
 *   exclude: 보낸 본인에게 자기 메시지를 되돌려주지 않기 위한 제외 인자.
 *
 * 방(roomId)마다 DO가 다르므로 getWebSockets()도 방 단위로 격리된다 —
 * private 방의 메시지는 public 방에 절대 새지 않는다.
 *
 * 터미널 두 개로 테스트:
 *   websocat "ws://localhost:8787/ws?roomId=private&nickname=nico"
 *   websocat "ws://localhost:8787/ws?roomId=private&nickname=lin"
 */
import { DurableObject } from 'cloudflare:workers';

export class DurablePotato extends DurableObject<Env> {
    fetch(request: Request) {
        const url = new URL(request.url);
        const nickname = url.searchParams.get('nickname') ?? 'anon';
        const webSocketPair = new WebSocketPair();

        const [client, server] = Object.values(webSocketPair);

        this.ctx.acceptWebSocket(server);

        server.serializeAttachment({ nickname });   // 이 연결의 주인 이름표

        return new Response(null, { status: 101, webSocket: client });
    }

    broadcast(message: string, exclude?: WebSocket) {
        for (const socket of this.ctx.getWebSockets()) {
            if (socket !== exclude) {
                socket.send(message);
            }
        }
    }

    webSocketMessage(ws: WebSocket, message: string) {
        // Cloudflare가 "지금 말한 사람의 연결"을 ws로 넘겨준다.
        const { nickname } = ws.deserializeAttachment() as { nickname: string };
        this.broadcast(`${nickname} said: ${message}`, ws);   // 본인 제외
    }

    webSocketClose(ws: WebSocket) {
        const { nickname } = ws.deserializeAttachment() as { nickname: string };
        this.broadcast(`${nickname} has left the building.`); // 나간 사람은 이미 없으니 제외 불필요
    }
}
