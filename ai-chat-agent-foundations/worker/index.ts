/**
 * ============================================================
 * Section 4 — AIChatAgent (4.0 Introduction ~ 4.2 generateText)
 * ============================================================
 *
 * 이 챕터의 핵심 개념:
 * - AIChatAgent는 Section 3의 Agent 클래스를 상속한 "채팅 특화" 에이전트다.
 *   Agent가 주던 것(state, @callable, SQL, broadcast, schedule)은 그대로 있고,
 *   그 위에 ① 메시지 저장 ② 메시지 브로드캐스트 ③ 스트리밍 응답이 얹혀 있다.
 * - 4.1(AIChatAgent): 프론트가 sendMessage 하면 onChatMessage가 불리고,
 *   주고받은 메시지는 this.messages에 자동 저장된다 (테이블 생성 없음).
 * - 4.2(generateText): AI 바인딩(env.AI) + AI SDK로 모델에 대화를 보내고
 *   완성된 텍스트를 한 번에 응답한다. 4.1의 "hello"가 진짜 AI 답변이 된다.
 */

// AIChatAgent: `agents`가 아니라 별도 패키지 `@cloudflare/ai-chat`에서 온다.
import { AIChatAgent } from "@cloudflare/ai-chat";
// routeAgentRequest: Section 3과 같다 — /agents/:클래스/:인스턴스 URL을
//   해당 Agent(DO)로 넘겨주는 라우터. 채팅 WebSocket도 이 경로로 들어온다.
import { routeAgentRequest } from "agents";
// AI SDK(패키지 이름 `ai`): Vercel이 만든 범용 라이브러리로 Cloudflare 전용이 아니다.
//   convertToModelMessages: 저장용 UIMessage[] → 모델 입력용 ModelMessage[] 변환
//   generateText: 모델 응답이 "끝날 때까지" 기다렸다가 텍스트를 통째로 받는다
import { convertToModelMessages, generateText } from "ai";
// workers-ai-provider: AI SDK가 "Cloudflare에 호스팅된 모델"을 쓰게 해주는 어댑터.
//   AI SDK 자체는 OpenAI/Anthropic 등 어떤 공급자든 쓸 수 있고, 공급자마다
//   이런 provider 패키지가 하나씩 있다.
import { createWorkersAI } from "workers-ai-provider";

/**
 * 클래스 이름 = wrangler.jsonc의 DO 바인딩 이름 = 프론트 useAgent의 agent 이름.
 * 메시지는 인스턴스 전용 SQLite의 cf_ai_chat_agent_messages 테이블에
 * 자동으로 쌓인다 — Section 3의 onStart/CREATE TABLE이 사라진 이유다.
 */
export class PotatoChatAgent extends AIChatAgent<Env> {
  /**
   * AIChatAgent가 요구하는 유일한 구현. 프론트에서 sendMessage 할 때마다 불린다.
   * 이 시점에 방금 온 사용자 메시지는 이미 this.messages 맨 뒤에 저장돼 있고,
   * 여기서 반환한 응답은 assistant 역할로 자동 저장 + 전 클라이언트에 브로드캐스트된다.
   */
  async onChatMessage() {
    // "모델들이 사는 곳"으로의 연결. this.env.AI는 wrangler.jsonc의
    //   "ai": { "binding": "AI" } 로 만든 바인딩이다(4.0에서 추가, cf-typegen으로
    //   Env 타입 생성). KV/DO 바인딩과 달리 AI 바인딩은 로컬 dev에서도 항상
    //   원격 GPU를 호출한다 — 오프라인 개발 불가, 무료 한도(뉴런) 소모.
    const workersAi = createWorkersAI({
      binding: this.env.AI,
    });

    // AI SDK 문서의 기본 예제와 똑같은 모양이다: model + messages → { text }.
    //   차이는 model 자리에 openai("gpt-…") 대신 workersAi("@cf/…")가 온다는 것뿐.
    const { text } = await generateText({
      // 모델 ID는 문자열. TS 자동완성 목록은 최신이 아닐 수 있으니 대시보드
      //   Workers AI 모델 카탈로그에서 ID를 복사해 온다.
      model: workersAi("@cf/zai-org/glm-4.7-flash"),
      // this.messages(UIMessage: id·parts 구조)를 모델이 받는 형태(role·content)로
      //   변환한다. id 같은 저장용 필드가 여기서 떨어져 나간다 — 강의에서 둘을
      //   나란히 console.log 해 비교한 부분. 과거 대화 전체가 매번 들어가므로
      //   모델은 "기억"을 갖는 것처럼 보인다.
      messages: await convertToModelMessages(this.messages),
    });

    // 완성된 텍스트를 한 번에 응답 — 모델이 다 쓸 때까지 화면엔 아무것도 안 뜬다.
    //   (4.3에서 streamText로 바꾸는 이유)
    return new Response(text);
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
