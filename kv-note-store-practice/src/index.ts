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
				const notes = await env.NOTE_KV.list();
				return new Response(JSON.stringify(notes));
			}

		} else if (request.method === 'POST') {
			console.log(url.pathname);
			const parts = url.pathname.split('/');   // "/notes/hello" → ["", "notes", "hello"]
			if (parts[1] === 'notes' && parts[2]) {  // /notes/ 뒤에 뭔가 있는지 확인
				const key = parts[2];                   // ← 이게 {id} 역할
				const note = await request.text();
				await env.NOTE_KV.put(key, note);
				return new Response(`Saved note: Key: ${key} Note: ${note}`);
			}
		}
		return new Response("Hello World!");
	},
} satisfies ExportedHandler<Env>;
