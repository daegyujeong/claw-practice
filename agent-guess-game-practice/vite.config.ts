import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

import { cloudflare } from "@cloudflare/vite-plugin";
// @callable() 데코레이터는 V8이 그대로 못 읽는 문법이라 빌드 단계에서 변환해 줘야 한다.
// 이 플러그인이 빠지면 dev 서버가 SyntaxError: Invalid or unexpected token 으로 죽는다.
import agents from "agents/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [agents(), react(), cloudflare()],
});
