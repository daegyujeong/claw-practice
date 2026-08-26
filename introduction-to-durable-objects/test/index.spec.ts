import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

// SELF.fetch = 배포된 워커에 HTTP 요청을 보내는 것과 같은 통합 테스트.
// 워커 → 바인딩(env.DP) → DO 메서드 호출까지 한 번에 검증된다.
describe('2.2 Using Durable Objects', () => {
	it('워커가 DO의 ping()을 호출해 pong을 돌려준다', async () => {
		const response = await SELF.fetch('https://example.com/');
		expect(await response.text()).toBe('pong');
	});
});
