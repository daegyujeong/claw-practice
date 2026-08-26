import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

// SELF.fetch = 배포된 워커에 HTTP 요청을 보내는 것과 같은 통합 테스트.
// 워커 → 바인딩(env.DP) → DO 메서드 호출까지 한 번에 검증된다.
describe('2.3 Durable Object Lifecycle', () => {
	it('같은 이름의 DO는 하나뿐이라 요청마다 카운트가 이어진다 (RAM)', async () => {
		const first = await SELF.fetch('https://example.com/');
		expect(await first.text()).toBe('count is 1');

		const second = await SELF.fetch('https://example.com/');
		expect(await second.text()).toBe('count is 2');
	});

	it('루트가 아닌 경로(favicon 등)는 카운트하지 않고 404', async () => {
		const response = await SELF.fetch('https://example.com/favicon.ico');
		expect(response.status).toBe(404);
	});
});
