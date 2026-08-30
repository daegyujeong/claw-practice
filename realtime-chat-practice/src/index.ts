/**
 * Practice #4: Realtime Chat Room — 워커(문지기)
 *
 * 워커는 두 가지만 한다 (2.8에서 배운 구조 그대로):
 *   GET /    → 채팅 UI(HTML)를 그냥 돌려준다 (브라우저 탭 두 개로 테스트하는 용도)
 *   GET /ws  → Upgrade 헤더가 있으면 요청을 통째로 ChatRoom DO에 넘긴다
 *
 * 이 파일은 완성본이다 — 과제의 핵심은 do.ts에 있다.
 */
export { ChatRoom } from './do';

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const { pathname, searchParams } = new URL(request.url);

		if (pathname === '/') {
			return new Response(HTML, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
		}

		if (pathname === '/ws') {
			const roomId = searchParams.get('roomId') ?? 'public';
			const upgrade = request.headers.get('Upgrade');
			if (upgrade === 'websocket') {
				const room = env.CHAT.getByName(roomId);   // 방 이름 = DO 이름
				return room.fetch(request);                 // 요청을 통째로 전달, 응답도 DO 것 그대로
			}
			return new Response('Expected WebSocket upgrade', { status: 426 });
		}

		return new Response(null, { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * 테스트용 채팅 UI. 과제 채점 대상이 아니므로 그대로 쓰면 된다.
 * 접속하면 닉네임을 묻고, wss://<이 워커 주소>/ws?roomId=...&nickname=... 으로 연결한다.
 * 서버가 보내는 문자열을 그대로 화면에 한 줄씩 추가한다.
 */
const HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Realtime Chat</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; }
  #log { border: 1px solid #ccc; border-radius: 8px; height: 320px; overflow-y: auto; padding: .75rem; margin-bottom: .5rem; }
  #log div { margin: .15rem 0; }
  .meta { color: #888; font-size: .85em; }
  form { display: flex; gap: .5rem; }
  input[type=text] { flex: 1; padding: .5rem; }
  button { padding: .5rem 1rem; }
</style>
</head>
<body>
<h3>Realtime Chat <span id="room" class="meta"></span></h3>
<div id="log"></div>
<form id="f"><input id="m" type="text" autocomplete="off" placeholder="메시지 입력" /><button>보내기</button></form>
<script>
  const params = new URLSearchParams(location.search);
  const roomId = params.get('roomId') ?? 'public';
  const nickname = params.get('nickname') ?? prompt('닉네임?') ?? 'anon';
  document.getElementById('room').textContent = '#' + roomId + ' (' + nickname + ')';

  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const ws = new WebSocket(proto + location.host + '/ws?roomId=' + encodeURIComponent(roomId) + '&nickname=' + encodeURIComponent(nickname));

  const log = document.getElementById('log');
  const add = (text, cls) => {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  };

  ws.onopen = () => add('연결됨', 'meta');
  ws.onmessage = (e) => add(e.data);
  ws.onclose = () => add('연결 끊김 — 새로고침하면 재접속', 'meta');

  document.getElementById('f').onsubmit = (e) => {
    e.preventDefault();
    const input = document.getElementById('m');
    if (input.value) { ws.send(input.value); input.value = ''; }
  };
</script>
</body>
</html>`;
