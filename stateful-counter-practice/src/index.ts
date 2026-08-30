/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
export { DurableCounter } from './do';

const USAGE = `Stateful Counter API

POST /increment  - count를 1 늘리고 이력 기록
POST /decrement  - count를 1 줄이고 이력 기록
GET  /count      - 현재 count
GET  /history    - 최근 변경 100건 (ip, city, country 포함)`;

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const { pathname } = new URL(request.url);

		// 카운터는 전 세계에 하나 → 이름을 고정한다 (닉네임별 격리가 필요 없는 과제)
		const counter = env.DP.getByName('global');

		// IP·위치는 request에만 있으므로 여기서 뽑아 DO에 인자로 넘긴다.
		// 로컬 dev/테스트에서는 비어 있을 수 있어 기본값을 둔다.
		const visitor = {
			ip: request.headers.get('CF-Connecting-IP') ?? 'unknown',
			city: request.cf?.city ?? 'unknown',
			country: request.cf?.country ?? 'unknown',
		};

		// "메서드 + 경로"를 하나의 키로 만들어 한 번에 분기한다.
		// 지난 과제처럼 method → path 로 중첩하지 않아도 되고, 잘못된 조합은 전부 default로 떨어진다.
		switch (`${request.method} ${pathname}`) {
			case 'POST /increment':
				return Response.json({ count: await counter.increase(visitor) });
			case 'POST /decrement':
				return Response.json({ count: await counter.decrease(visitor) });
			case 'GET /count':
				return Response.json({ count: await counter.getCount() });
			case 'GET /history':
				return Response.json(await counter.getHistory());
			case 'GET /':
				return new Response(USAGE);
			default:
				return new Response(`Unknown route: ${request.method} ${pathname}\n\n${USAGE}`, { status: 404 });
		}
	},
} satisfies ExportedHandler<Env>;
