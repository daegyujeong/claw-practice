/**
 * ─────────────────────────────────────────────────────────────
 * 2.9 Upgrades — /ws 경로에서만 승격을 받는다
 * ─────────────────────────────────────────────────────────────
 * 2.8과 같은 문지기 구조. 승격 요청을 /ws 경로로 한정해서
 * 일반 GET / 요청(브라우저 주소창)과 WebSocket 연결을 구분한다.
 */
export { DurablePotato } from './do';

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const { pathname, searchParams } = new URL(request.url);
		if (pathname === '/ws') {
			const roomId = searchParams.get('roomId') ?? 'public';
			const upgrade = request.headers.get('Upgrade');
			if (upgrade) {
				const dp = env.DP.getByName(roomId);
				return dp.fetch(request);
			}
		}
		return new Response(null, {
			status: 404,
		});
	},
} satisfies ExportedHandler<Env>;
