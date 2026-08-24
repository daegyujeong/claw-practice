import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
			// wrangler.jsonc의 CLAW_KV에 remote: true가 있어도
			// 테스트만큼은 항상 로컬 에뮬레이션 KV를 쓰게 한다.
			// (안 그러면 테스트가 진짜 KV에 count를 쓰고, Cloudflare 로그인도 요구함)
			remoteBindings: false,
		}),
	],
});
