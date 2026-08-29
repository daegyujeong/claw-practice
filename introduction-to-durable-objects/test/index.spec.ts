import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('2.7 Alarms', () => {
	it('카운터가 SQLite에 저장된다 (RETURNING으로 한 문장에 읽고 쓴다)', async () => {
		await SELF.fetch('https://example.com/');
		const second = await SELF.fetch('https://example.com/');
		expect(await second.text()).toBe('count is 2');

		// DO 안에 들어가 하드디스크(SQLite)의 값을 직접 확인
		const stub = env.DP.getByName('anon');
		const row = await runInDurableObject(stub, (_instance, state) => {
			return state.storage.sql.exec(`SELECT total FROM pongs WHERE id = 1`).one();
		});
		expect(row).toEqual({ total: 2 });
	});

	it('닉네임마다 다른 DO를 만나 카운트가 격리된다', async () => {
		await SELF.fetch('https://example.com/?nickname=nico');
		const nico = await SELF.fetch('https://example.com/?nickname=nico');
		expect(await nico.text()).toBe('count is 2');

		const lin = await SELF.fetch('https://example.com/?nickname=lin');
		expect(await lin.text()).toBe('count is 1');
	});

	it('같은 DO에 동시에 요청해도 증가가 유실되지 않는다 (단일 스레드)', async () => {
		await Promise.all(Array.from({ length: 10 }, () => SELF.fetch('https://example.com/?nickname=race')));
		const last = await SELF.fetch('https://example.com/?nickname=race');
		expect(await last.text()).toBe('count is 11');
	});

	it('30 이상이 되면 알람이 예약된다', async () => {
		const stub = env.DP.getByName('alarmtest');
		// 카운터를 30으로 만들어 두고 increase를 한 번 더 → 31, 알람 예약 조건 충족
		await runInDurableObject(stub, (_instance, state) => {
			state.storage.sql.exec(`UPDATE pongs SET total = 30 WHERE id = 1`);
		});
		await SELF.fetch('https://example.com/?nickname=alarmtest');

		const alarmTime = await runInDurableObject(stub, (_instance, state) => state.storage.getAlarm());
		expect(alarmTime).not.toBeNull();               // 예약됨
		expect(alarmTime!).toBeGreaterThan(Date.now()); // 미래 시각
	});

	it('alarm()이 실행되면 카운터가 0으로 리셋된다', async () => {
		const stub = env.DP.getByName('resettest');
		await SELF.fetch('https://example.com/?nickname=resettest');

		const total = await runInDurableObject(stub, async (instance: any, state) => {
			await instance.alarm();
			return state.storage.sql.exec(`SELECT total FROM pongs WHERE id = 1`).one();
		});
		expect(total).toEqual({ total: 0 });
	});

	it('/ping 은 pong, 그 외 경로는 404', async () => {
		const ping = await SELF.fetch('https://example.com/ping');
		expect(await ping.text()).toBe('pong');

		const favicon = await SELF.fetch('https://example.com/favicon.ico');
		expect(favicon.status).toBe(404);
	});
});
