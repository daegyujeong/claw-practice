/**
 * ============================================================
 * Section 4 — AIChatAgent (4.0 Introduction)
 * ============================================================
 *
 * 이 챕터의 핵심 개념:
 * - AIChatAgent는 Section 3의 Agent 클래스를 상속한 "채팅 특화" 에이전트다.
 *   Agent가 주던 것(state, @callable, SQL, broadcast, schedule)은 그대로 있고,
 *   그 위에 메시지 저장·브로드캐스트·스트리밍 응답이 얹혀 있다.
 * - 4.0은 셋업만: 프로젝트 생성, 패키지 설치, 클래스 선언, wrangler 바인딩.
 */

// AIChatAgent: `agents`가 아니라 별도 패키지 `@cloudflare/ai-chat`에서 온다.
import { AIChatAgent } from "@cloudflare/ai-chat";
// routeAgentRequest: Section 3과 같다 — /agents/:클래스/:인스턴스 URL을
//   해당 Agent(DO)로 넘겨주는 라우터.
import { routeAgentRequest } from "agents";

/**
 * 클래스 이름 = wrangler.jsonc의 DO 바인딩 이름 = 프론트 useAgent의 agent 이름.
 * AIChatAgent도 결국 Durable Object라서 wrangler.jsonc에
 * durable_objects 바인딩 + new_sqlite_classes 마이그레이션이 그대로 필요하다.
 * 여기에 "ai": { "binding": "AI" } 바인딩을 미리 추가해 두었다(4.2에서 사용).
 * 바인딩을 바꿨으면 `npm run cf-typegen`으로 Env 타입을 다시 만든다.
 */
export class PotatoChatAgent extends AIChatAgent<Env> {}

export default {
  // routeAgentRequest는 Promise<Response | null>을 반환하므로 await 한 뒤
  //   ?? 로 404 처리한다 (await 없이 ?? 를 쓰면 404 분기는 죽은 코드가 된다).
  async fetch(request, env) {
    return (
      (await routeAgentRequest(request, env)) ??
      new Response(null, { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
