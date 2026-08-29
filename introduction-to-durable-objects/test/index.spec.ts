import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('2.8 WebSockets — 요청 전달', () => {
	it('Upgrade 헤더가 없으면 404 (문지기가 돌려보낸다)', async () => {
		const res = await SELF.fetch('https://example.com/');
		expect(res.status).toBe(404);
	});

	it('Upgrade 헤더가 있으면 요청이 DO의 fetch까지 전달된다', async () => {
		// 아직 진짜 승격은 안 한다 — DO의 fetch가 응답을 만들었다는 사실만 확인.
		// 응답을 만든 주체가 워커가 아니라 DO라는 것이 이번 챕터의 핵심이다.
		const res = await SELF.fetch('https://example.com/?roomId=test', {
			headers: { Upgrade: 'websocket' },
		});
		expect(await res.text()).toBe('hello');
	});
});
