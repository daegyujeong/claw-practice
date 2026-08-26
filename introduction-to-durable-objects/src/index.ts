/**
 * ─────────────────────────────────────────────────────────────
 * 2.4 Durable Object Storage — 워커에서 카운터 DO 호출하기
 * ─────────────────────────────────────────────────────────────
 * 역할 분담:
 *   index.ts (워커) : HTTP 요청을 받아서 "어떤 DO에게" 일을 시킬지 정한다 (문지기)
 *   do.ts   (DO)    : 실제 상태와 로직을 가진 "작은 컴퓨터"
 *
 * DO는 어디에 만들어지나?
 *   기본: 처음 요청한 사용자와 가까운 지역 (싱가포르 사용자가 처음 부르면 아시아에 생김)
 *   - locationHint: "이 근처에 만들어줘" (최선을 다하지만 보장 없음)
 *       env.DP.getByName('peter', { locationHint: 'eeur' })
 *   - jurisdiction: "반드시 이 관할권 안에" (법적 보장, getByName 전에 지정)
 *       env.DP.jurisdiction('eu').getByName('peter')
 *   DO는 한 번 만들어지면 위치를 옮기지 않는다 — 데이터를 들고 있는 컴퓨터라서
 *   개인정보 보호법 등으로 데이터 위치를 통제해야 할 때 jurisdiction을 쓴다.
 */

// Cloudflare가 클래스를 찾을 수 있도록 워커 진입 파일에서 다시 export 한다.
export { DurablePotato } from './do';

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const { pathname } = new URL(request.url);

		// 루트(/)만 카운트 — 브라우저의 /favicon.ico 자동 요청으로 2번 세는 것을 막는다.
		if (pathname === '/') {
			// 이름은 무엇이든 된다. 'peter'라는 이름의 DO가 없으면 만들고, 있으면 가져온다.
			const dp = env.DP.getByName('peter');
			return new Response(await dp.increase());
		}

		return new Response(null, { status: 404 });
	},
} satisfies ExportedHandler<Env>;
