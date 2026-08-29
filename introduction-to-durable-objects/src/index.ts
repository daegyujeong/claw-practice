/**
 * ─────────────────────────────────────────────────────────────
 * 2.8 WebSockets — 워커는 문지기, 응답은 DO가 직접
 * ─────────────────────────────────────────────────────────────
 * ★ WebSocket은 HTTP 요청으로 시작한다
 *   브라우저가 `Upgrade` 헤더를 붙여 보내면 "WebSocket으로 갈아타자"는 뜻.
 *   워커는 이 헤더가 있는지만 확인하고, 요청을 통째로 DO에 넘긴다.
 *
 * ★ DO 이름이 nickname → roomId로 바뀌었다
 *   방 하나 = DO 하나. 같은 roomId로 접속한 사람들은 같은 DO를 만나므로
 *   그 DO가 방의 연결 목록을 들고 브로드캐스트할 수 있다 (2.6 격리의 응용).
 *
 * ★ return dp.fetch(request)
 *   DO가 만든 Response가 그대로 사용자에게 간다. 워커는 내용을 만들지 않는다.
 */
export { DurablePotato } from './do';

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const { pathname, searchParams } = new URL(request.url);
		const roomId = searchParams.get('roomId') ?? 'public';   // 방 이름이 없으면 public
		const upgrade = request.headers.get('Upgrade');
		if (upgrade) {
			const dp = env.DP.getByName(roomId);
			return dp.fetch(request);
		}
		return new Response(null, {
			status: 404,
		});
	},
} satisfies ExportedHandler<Env>;
