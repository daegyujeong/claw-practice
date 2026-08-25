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

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === 'GET') {
			const parts = url.pathname.split('/');

			if (parts[1] === 'notes') {
				if (parts[2]) {
					const note = await env.NOTE_KV.get(parts[2]);
					return new Response(JSON.stringify(note));
				}
				else {
					const notes = await env.NOTE_KV.list();
					return new Response(JSON.stringify(notes));
				}
			}
			else if (url.pathname === '/') {
				return new Response(`KV Note Store API
			
			POST /notes/:key  - 요청 본문을 :key로 저장
			GET  /notes/:key  - :key의 노트 조회
			GET  /notes       - 저장된 키 목록 조회`);
			}
			else {
				return new Response(` Wrong path: ${url.pathname} !!!
				Correct path:
				POST /notes/:key  - 요청 본문을 :key로 저장
				GET  /notes/:key  - :key의 노트 조회
				GET  /notes       - 저장된 키 목록 조회`);
			}
		} else if (request.method === 'POST') {
			console.log(url.pathname);
			const parts = url.pathname.split('/');   // "/notes/hello" → ["", "notes", "hello"]
			if (parts[1] === 'notes') {
				if (parts[2]) {  // /notes/ 뒤에 뭔가 있는지 확인
					const key = parts[2];                   // ← 이게 {id} 역할
					const note = await request.text();
					if (note === null) {
						return new Response('Note not found', { status: 404 });  // 404 처리
					}
					await env.NOTE_KV.put(key, note);
					return new Response(`Saved note: Key: ${key} Note: ${note}`);
				}
				else {
					return new Response(` Wrong path: ${url.pathname} !!!
					Correct path:
					POST /notes/:key  - 요청 본문을 :key로 저장
					GET  /notes/:key  - :key의 노트 조회
					GET  /notes       - 저장된 키 목록 조회`);
				}
			}
			else {
				return new Response(` Wrong path: ${url.pathname} !!!
				Correct path:
				POST /notes/:key  - 요청 본문을 :key로 저장
				GET  /notes/:key  - :key의 노트 조회
				GET  /notes       - 저장된 키 목록 조회`);
			}
		}
		return new Response("Hello World!");
	},
} satisfies ExportedHandler<Env>;
