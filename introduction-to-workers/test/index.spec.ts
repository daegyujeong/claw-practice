import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

// 테스트 환경에서는 KV가 로컬로 에뮬레이션된다 (진짜 KV를 건드리지 않음).
// 즉, 테스트마다 깨끗한 저장소에서 시작한다고 보면 된다.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("KV counter worker", () => {
	it("루트(/) 방문 시 카운트를 증가시켜 응답한다 (unit style)", async () => {
		const request = new IncomingRequest("http://example.com/");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// ctx.waitUntil()에 넘긴 Promise들이 끝날 때까지 대기 후 검증
		await waitOnExecutionContext(ctx);
		// 카운트는 테스트 실행 순서에 따라 달라질 수 있으므로 형태만 검증
		expect(await response.text()).toMatch(/^Count is \d+$/);
	});

	it("루트가 아닌 경로(favicon 등)는 404를 반환한다", async () => {
		const request = new IncomingRequest("http://example.com/favicon.ico");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
	});

	it("integration style: 실제 요청/응답 전체 경로로도 동작한다", async () => {
		const response = await SELF.fetch("https://example.com/");
		expect(await response.text()).toMatch(/^Count is \d+$/);
	});
});
