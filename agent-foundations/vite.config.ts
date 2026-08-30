import { defineConfig } from 'vite'
// 3.2 — @callable 데코레이터 문법을 Vite가 이해하게 해주는 플러그인.
// 이거 없이 데코레이터를 쓰면 Vite가 문법 에러를 낸다.
import agents from 'agents/vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [agents(), react(), cloudflare()],
})
