import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

/** 같은 방에 nickname으로 접속해 client 소켓을 돌려받는다 */
async function connect(roomId: string, nickname: string): Promise<WebSocket> {
	const res = await SELF.fetch(`https://example.com/ws?roomId=${roomId}&nickname=${nickname}`, {
		headers: { Upgrade: 'websocket' },
	});
	expect(res.status).toBe(101);
	const ws = res.webSocket!;
	ws.accept();
	return ws;
}

/** 다음 메시지 한 개를 기다린다 */
function nextMessage(ws: WebSocket): Promise<string> {
	return new Promise((resolve) => {
		ws.addEventListener('message', (e) => resolve(e.data as string), { once: true });
	});
}

describe('2.10 Messages — 채팅방', () => {
	it('한 명이 말하면 나머지에게만 닉네임과 함께 전달된다', async () => {
		const nico = await connect('room1', 'nico');
		const lin = await connect('room1', 'lin');

		const heardByLin = nextMessage(lin);
		nico.send('hello');
		expect(await heardByLin).toBe('nico said: hello');
	});

	it('다른 방에는 메시지가 새지 않는다 (방 = DO 격리)', async () => {
		const a = await connect('roomA', 'nico');
		const b = await connect('roomB', 'lin');

		let leaked = false;
		b.addEventListener('message', () => { leaked = true; });
		a.send('secret');
		await new Promise((r) => setTimeout(r, 100));
		expect(leaked).toBe(false);
	});

	it('누가 나가면 남은 사람에게 알림이 간다', async () => {
		const nico = await connect('room2', 'nico');
		const lin = await connect('room2', 'lin');

		const heardByNico = nextMessage(nico);
		lin.close();
		expect(await heardByNico).toBe('lin has left the building.');
	});
});
