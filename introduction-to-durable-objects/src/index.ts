/**
 * ─────────────────────────────────────────────────────────────
 * 2.3 Durable Object Lifecycle — 워커에서 카운터 DO 호출하기
 * ─────────────────────────────────────────────────────────────
 * 역할 분담:
 *   index.ts (워커) : HTTP 요청을 받아서 "어떤 DO에게" 일을 시킬지 정한다 (문지기)
 *   do.ts   (DO)    : 실제 상태와 로직을 가진 "작은 컴퓨터"
 */

// Cloudflare가 클래스를 찾을 수 있도록 워커 진입 파일에서 다시 export 한다.
export { DurablePotato } from './do';

export default {
	async fetch(request, env, ctx): Promise<Response> {
		// 워커 런타임은 표준 Web API 기반 → URL 객체로 경로를 꺼낸다.
		const { pathname } = new URL(request.url);

		// ★ 루트(/)만 카운트하는 이유 (Section 1 KV 카운터와 같은 함정):
		// 브라우저는 페이지를 열 때 /favicon.ico도 자동으로 요청한다.
		// 이 체크가 없으면 새로고침 1번에 increase()가 2번 실행돼 카운트가 2씩 오른다.
		if (pathname === '/') {
			// 'default'라는 이름의 DO는 Cloudflare 전체에 딱 하나.
			// 있으면 가져오고 없으면 만든다 (new DurablePotato()는 절대 하지 않는다).
			const dp = env.DP.getByName('default');
			return new Response(await dp.increase());
		}

		// 루트가 아닌 경로(favicon.ico 포함)는 404로 끝낸다.
		return new Response(null, { status: 404 });
	},
} satisfies ExportedHandler<Env>;
