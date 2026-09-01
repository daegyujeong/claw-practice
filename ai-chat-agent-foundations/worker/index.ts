/**
 * ============================================================
 * Section 4 — AIChatAgent (4.0 Introduction ~ 4.1 AIChatAgent)
 * ============================================================
 *
 * 이 챕터의 핵심 개념:
 * - AIChatAgent는 Section 3의 Agent 클래스를 상속한 "채팅 특화" 에이전트다.
 *   Agent가 주던 것(state, @callable, SQL, broadcast, schedule)은 그대로 있고,
 *   그 위에 ① 메시지 저장 ② 메시지 브로드캐스트 ③ 스트리밍 응답이 얹혀 있다.
 * - 4.1(AIChatAgent): 프론트가 sendMessage 하면 onChatMessage가 불리고,
 *   주고받은 메시지는 this.messages에 자동 저장된다 (테이블 생성 없음).
 *   아직 AI 모델은 없다 — 항상 "hello"라고만 답하는 "순진한" 버전.
 */

// AIChatAgent: `agents`가 아니라 별도 패키지 `@cloudflare/ai-chat`에서 온다.
import { AIChatAgent } from "@cloudflare/ai-chat";
// routeAgentRequest: Section 3과 같다 — /agents/:클래스/:인스턴스 URL을
//   해당 Agent(DO)로 넘겨주는 라우터. 채팅 WebSocket도 이 경로로 들어온다.
import { routeAgentRequest } from "agents";

/**
 * 클래스 이름 = wrangler.jsonc의 DO 바인딩 이름 = 프론트 useAgent의 agent 이름.
 * 메시지는 인스턴스 전용 SQLite의 cf_ai_chat_agent_messages 테이블에
 * 자동으로 쌓인다 — Section 3의 onStart/CREATE TABLE이 사라진 이유다.
 */
export class PotatoChatAgent extends AIChatAgent<Env> {
  /**
   * AIChatAgent가 요구하는 유일한 구현. 이걸 안 만들면 첫 sendMessage에서
   * 에러가 난다(강의에서 일부러 보여 준 장면). 프론트에서 sendMessage 할 때마다
   * 불리며, 이 시점에 방금 온 사용자 메시지는 이미 this.messages 맨 뒤에 있다.
   * 여기서 반환한 응답은 assistant 역할로 자동 저장 + 전 클라이언트에 브로드캐스트된다.
   */
  async onChatMessage() {
    // 저장된 대화 전체를 확인해 보는 로그. 출력 형태:
    //   [{ id, role: "user", parts: [{ type: "text", text: "hello" }] },
    //    { id, role: "assistant", parts: [...] }, ...]
    // "parts 배열" 구조는 AI SDK의 UIMessage 표준 — 텍스트·이미지·툴 호출 등
    // 여러 조각으로 이뤄질 수 있어서 문자열 하나가 아니라 배열이다.
    console.log(JSON.stringify(this.messages));
    // 일반 Response 문자열도 AIChatAgent가 assistant 메시지로 저장해 준다.
    return new Response("hello");
  }
}

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
