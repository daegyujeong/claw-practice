/**
 * ─────────────────────────────────────────────────────────────
 * 1.4 Workers KV — 방문자 카운터
 * ─────────────────────────────────────────────────────────────
 * 이 파일 하나가 "워커" 전체다.
 * 워커 = 서버가 아니라, 요청이 올 때마다 사용자 근처에서
 * 생겼다가(V8 isolate) 즉시 사라지는 "함수".
 *
 * 그래서 워커는 stateless(무상태):
 *   - `let count = 0` 같은 전역 변수는 요청/지역마다 초기화됨
 *   - 기억해야 할 데이터는 반드시 외부 저장소(KV 등)에 둔다
 *
 * 실행 흐름:
 *   브라우저가 URL 호출 → Cloudflare가 fetch() 실행 → Response 반환 → 워커 소멸
 */

export default {
	/**
	 * fetch 트리거: HTTP 요청이 올 때마다 실행된다.
	 * (이 함수가 있어서 워커에 공개 URL이 생긴다.
	 *  cron으로 실행하려면 fetch 대신 scheduled 함수를 쓴다)
	 *
	 * @param request - 요청 정보 (URL, 경로, 헤더, IP, body 등)
	 * @param env     - 바인딩 모음. wrangler.jsonc에 선언한 CLAW_KV가 여기 들어있다
	 * @param ctx     - 실행 컨텍스트 (ctx.waitUntil 등, 지금은 안 씀)
	 */
	async fetch(request, env, ctx): Promise<Response> {
		// 워커 런타임은 Node.js가 아니라 표준 Web API 기반.
		// 그래서 URL, Response 같은 브라우저 표준 객체를 그대로 쓴다.
		const url = new URL(request.url);

		// request.cf에는 Cloudflare가 넣어주는 부가 정보(국가, 도시 등)가 있다.
		// 이 로그는 로컬은 터미널, 프로덕션은 `npx wrangler tail`로 볼 수 있다.
		console.log(request.cf?.country);

		// ★ 루트(/)만 카운트하는 이유:
		// 브라우저는 페이지를 열 때 /favicon.ico도 자동으로 요청한다.
		// 이 체크가 없으면 새로고침 1번에 워커가 2번 실행돼서 카운트가 2씩 오른다.
		if (url.pathname === '/') {
			// KV에서 읽기. 주의 ①: KV의 값은 전부 "문자열"이다.
			// 주의 ②: 키가 없으면 null이 오므로 `?? 0`으로 기본값 처리.
			const count = Number((await env.CLAW_KV.get('count')) ?? 0);

			// 1 증가시켜 다시 저장 (숫자 → 문자열로 변환해서 put).
			// 이 데이터는 워커가 죽어도, 어느 지역에서 실행돼도 유지된다.
			await env.CLAW_KV.put('count', `${count + 1}`);

			return new Response(`Count is ${count + 1}`);
		}

		// 루트가 아닌 경로(favicon.ico 포함)는 404로 끝낸다.
		return new Response(null, { status: 404 });
	},

	/*
	 * ⚠️ 이 카운터는 "KV 사용법 학습용"이다. 실전 카운터로는 부적합:
	 *   1. KV는 같은 키에 초당 1회만 쓸 수 있다 (초과 시 429 에러)
	 *   2. get→put 사이에 다른 요청이 끼면 카운트가 유실된다 (last write wins)
	 *   3. KV는 최종 일관성: 다른 지역에는 최대 60초 늦게 반영된다
	 * → 정확한 카운터/실시간 상태는 다음 섹션의 Durable Objects가 정답.
	 */
} satisfies ExportedHandler<Env>;
// ↑ Env 타입은 worker-configuration.d.ts에 자동 생성되어 있다.
//   바인딩을 추가/변경하면 `npm run cf-typegen`으로 재생성해야
//   env.CLAW_KV 자동완성이 동작한다.
