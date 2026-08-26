import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('2.4 Durable Object Storage', () => {
	it('카운터는 아직 RAM — 요청마다 이어진다', async () => {
		const first = await SELF.fetch('https://example.com/');
		expect(await first.text()).toBe('count is 1');

		const second = await SELF.fetch('https://example.com/');
		expect(await second.text()).toBe('count is 2');
	});

	it('constructor가 pongs 테이블과 초기 행(id=1, total=0)을 만든다', async () => {
		// runInDurableObject: 테스트에서 DO 인스턴스 "안"에 들어가 storage를 직접 들여다본다.
		const stub = env.DP.getByName('peter');
		const row = await runInDurableObject(stub, (_instance, state) => {
			return state.storage.sql.exec(`SELECT id, total FROM pongs`).one();
		});
		expect(row).toEqual({ id: 1, total: 0 });
	});

	it('루트가 아닌 경로(favicon 등)는 404', async () => {
		const response = await SELF.fetch('https://example.com/favicon.ico');
		expect(response.status).toBe(404);
	});
});
