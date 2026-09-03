/**
 * ============================================================
 * Section 7 — Browser Agents (7.0 Introduction)
 * ============================================================
 *
 * 이 챕터의 핵심 개념:
 * - 에이전트에게 "브라우저"를 준다. Cloudflare가 자기 서버에서 진짜 Chrome을
 *   띄워 주고(Browser Rendering), 우리 워커는 바인딩(env.BROWSER)으로 그 브라우저에
 *   접속한다. 브라우저 자체가 워커 안에서 도는 게 아니다 — "연결"을 받는 것이다.
 * - 7.0(Introduction): 프로젝트 셋업. Section 4의 채팅 UI(App.tsx)를 그대로 가져오고,
 *   서버는 AIChatAgent를 상속한 빈 BrowserAgent 하나. wrangler.jsonc에 바인딩 두 개
 *   (browser, worker_loaders)를 추가하고 `npm run cf-typegen`으로 Env 타입을 만든다.
 * - 7.3(Browser Tools)부터 onChatMessage를 구현한다 — 지금은 비어 있어서
 *   메시지를 보내면 에러가 난다(Section 4.1에서 본 것과 같은 이유).
 *
 * 이 챕터의 로드맵 (강사 저장소 커밋 기준):
 *   7.0 Introduction → 7.3 Browser Tools(Cloudflare가 주는 자동 툴)
 *   → 7.4 Puppeteer Tools(직접 만드는 툴) → 7.5 File Uploads(스크린샷 → R2)
 *   → 7.6 Public Files → 7.9 Live View(사람과 에이전트가 브라우저를 공유)
 */

// AIChatAgent: Section 4와 같다 — 메시지 저장·브로드캐스트·스트리밍이 내장된
//   채팅 에이전트. 우리는 onChatMessage만 구현하면 된다.
import { AIChatAgent } from "@cloudflare/ai-chat";
// routeAgentRequest: /agents/:클래스/:인스턴스 URL을 해당 Agent(DO)로 넘기는 라우터.
import { routeAgentRequest } from "agents";

/**
 * 브라우저 에이전트. 클래스 이름 = wrangler.jsonc의 DO 바인딩 이름
 * = 프론트 useAgent({ agent: "BrowserAgent" })의 이름. 셋이 같아야 한다.
 *
 * 7.0에서는 비어 있다. Env에는 이미 AI / BrowserAgent(DO) / BROWSER / LOADER
 * 네 바인딩이 들어 있고(worker-configuration.d.ts), 7.3부터 이걸 꺼내 쓴다.
 */
export class BrowserAgent extends AIChatAgent<Env> {}

export default {
  // routeAgentRequest는 Promise<Response | null>을 반환하므로 반드시 await 한 뒤
  //   ?? 로 404 처리한다. Section 4와 같은 이유 — await 없이 `?? 404`라고 쓰면
  //   Promise는 절대 null이 아니라서 404 분기가 죽은 코드가 되고, strict 타입에서는
  //   `Promise<Response | null>`이 핸들러 반환 타입에 안 맞아 tsc가 실패한다.
  async fetch(request, env) {
    return (
      (await routeAgentRequest(request, env)) ??
      new Response(null, { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
