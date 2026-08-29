import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('2.9 Upgrades — WebSocket 연결 열기', () => {
	it('/ws 가 아니거나 Upgrade 헤더가 없으면 404', async () => {
		const root = await SELF.fetch('https://example.com/');
		expect(root.status).toBe(404);

		const noUpgrade = await SELF.fetch('https://example.com/ws');
		expect(noUpgrade.status).toBe(404);
	});

	it('/ws + Upgrade 헤더 → 101 응답과 client 소켓을 받는다', async () => {
		const res = await SELF.fetch('https://example.com/ws?roomId=test', {
			headers: { Upgrade: 'websocket' },
		});
		expect(res.status).toBe(101);
		expect(res.webSocket).toBeDefined();   // 101 응답에 실려 온 client 끝
		res.webSocket!.accept();               // 테스트(클라이언트) 쪽에서 연결 수락
		res.webSocket!.close();
	});

	it('연결이 DO의 메모리에 보관된다 (getWebSockets)', async () => {
		const res = await SELF.fetch('https://example.com/ws?roomId=count', {
			headers: { Upgrade: 'websocket' },
		});
		res.webSocket!.accept();

		const stub = env.DP.getByName('count');
		const sockets = await runInDurableObject(stub, (_instance, state) => state.getWebSockets().length);
		expect(sockets).toBe(1);
	});
});
