/**
 * ─────────────────────────────────────────────────────────────
 * 2.2 Using Durable Objects — 워커에서 DO 호출하기
 * ─────────────────────────────────────────────────────────────
 * 역할 분담:
 *   index.ts (워커) : HTTP 요청을 받아서 "어떤 DO에게" 일을 시킬지 정한다 (문지기)
 *   do.ts   (DO)    : 실제 상태와 로직을 가진 "작은 컴퓨터"
 */

// Cloudflare가 클래스를 찾을 수 있도록 워커 진입 파일에서 다시 export 한다.
// wrangler.jsonc의 class_name("DurablePotato")과 이름이 같아야 한다.
export { DurablePotato } from './do';

export default {
	async fetch(request, env, ctx): Promise<Response> {
		// ★ new DurablePotato()는 절대 하지 않는다.
		//   클래스는 "설계도"일 뿐이고, 인스턴스는 Cloudflare에게 "이름"으로 요청한다.
		//   - 그 이름의 DO가 있으면 가져오고, 없으면 만들어서 준다
		//   - 돌려받는 것은 실제 객체가 아니라 stub(스텁): DO에게 요청을 보내는 리모컨
		//   - 보장: 'default'라는 이름의 DurablePotato는 Cloudflare 전체에 딱 하나
		const stub = env.DP.getByName('default');

		// ping()은 async가 아닌데 왜 await가 필요할까?
		// 메서드 호출처럼 보이지만 실제로는 DO가 사는 서버로 가는 "네트워크 요청"(RPC)이다.
		// 그래서 반환 타입이 string이 아니라 Promise<string>이 된다.
		return new Response(await stub.ping());
	},
} satisfies ExportedHandler<Env>;
