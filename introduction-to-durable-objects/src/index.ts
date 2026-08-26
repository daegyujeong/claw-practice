/**
 * ─────────────────────────────────────────────────────────────
 * 2.5 Concurrency + Isolated Storage — 닉네임마다 다른 DO
 * ─────────────────────────────────────────────────────────────
 * 역할 분담:
 *   index.ts (워커) : HTTP 요청을 받아서 "어떤 DO에게" 일을 시킬지 정한다 (문지기)
 *   do.ts   (DO)    : 실제 상태와 로직을 가진 "작은 컴퓨터"
 *
 * ★ 이름마다 저장소가 완전히 격리된다
 *   ?nickname=nico 는 'nico' DO, ?nickname=lin 은 'lin' DO를 만난다.
 *   각각 자기만의 RAM·KV·SQLite를 가지므로 nico의 카운트를 올려도 lin은 그대로다.
 *   이름을 사용자/채팅방/게임 세션/대화로 바꾸면 그대로 "사용자별 서버", "방별 서버"가 된다.
 *   AI 에이전트(Agents SDK)도 이 구조 위에 만들어진다 — 대화별로 자기 DB를 가진 DO.
 *
 * 배포 후 Cloudflare 대시보드 → 워커 → Bindings → Durable Object → Data Studio에서
 * 이름별 DO의 SQLite를 직접 조회할 수 있다.
 */

// Cloudflare가 클래스를 찾을 수 있도록 워커 진입 파일에서 다시 export 한다.
export { DurablePotato } from './do';

export default {
	async fetch(request, env, ctx): Promise<Response> {
		// URL에서 경로와 쿼리스트링을 한 번에 꺼낸다.
		const { pathname, searchParams } = new URL(request.url);

		// ?nickname=... 이 없으면 'anon' DO로 보낸다.
		const nickname = searchParams.get('nickname') ?? 'anon';

		// 루트(/)만 카운트 — 브라우저의 /favicon.ico 자동 요청으로 2번 세는 것을 막는다.
		if (pathname === '/') {
			// 닉네임 = DO 이름. 같은 닉네임은 전 세계 어디서 와도 같은 DO를 만난다.
			// (이전 코드의 getByName('defualt') 오타를 고치고, 만들어 두고 안 쓰던
			//  nickname 변수를 실제로 연결했다 — 이래야 격리 데모가 재현된다)
			const dp = env.DP.getByName(nickname);
			return new Response(await dp.increase());
		}

		// 2.2에서 만든 ping()은 /ping 경로로 남겨 둔다 (DO 연결 확인용).
		if (pathname === '/ping') {
			const dp = env.DP.getByName(nickname);
			return new Response(await dp.ping());
		}

		// 그 외 경로(favicon.ico 포함)는 404.
		return new Response(null, { status: 404 });
	},
} satisfies ExportedHandler<Env>;
