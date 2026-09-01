/**
 * ============================================================
 * Section 4 — AIChatAgent (4.0 Introduction ~ 4.3 streamText)
 * ============================================================
 *
 * 이 챕터의 핵심 개념:
 * - AIChatAgent는 Section 3의 Agent 클래스를 상속한 "채팅 특화" 에이전트다.
 *   Agent가 주던 것(state, @callable, SQL, broadcast, schedule)은 그대로 있고,
 *   그 위에 ① 메시지 저장 ② 메시지 브로드캐스트 ③ 스트리밍 응답이 얹혀 있다.
 *   Section 3에서 손수 만들던 messages 테이블·INSERT·broadcast·loadHistory가
 *   전부 내장돼 있어서, 우리가 구현할 것은 onChatMessage 하나뿐이다.
 * - 4.1(AIChatAgent): 프론트가 sendMessage 하면 onChatMessage가 불리고,
 *   주고받은 메시지는 this.messages에 자동 저장된다 (테이블 생성 없음).
 * - 4.2(generateText): AI 바인딩(env.AI) + AI SDK로 모델에 대화를 보내고
 *   완성된 텍스트를 한 번에 응답한다.
 * - 4.3(streamText): generateText → streamText로 바꾸면 토큰 단위 스트리밍.
 *   프론트 코드는 한 줄도 안 바꿔도 된다 — useAgentChat이 스트림을 이해한다.
 */

// AIChatAgent: `agents`가 아니라 별도 패키지 `@cloudflare/ai-chat`에서 온다.
//   (예전에는 `agents/ai-chat-agent`였고 지금도 그 경로가 남아 있지만,
//    새 프로젝트는 강사 코드처럼 @cloudflare/ai-chat을 쓴다.)
import { AIChatAgent } from "@cloudflare/ai-chat";
// routeAgentRequest: Section 3과 같다 — /agents/:클래스/:인스턴스 URL을
//   해당 Agent(DO)로 넘겨주는 라우터. 채팅 WebSocket도 이 경로로 들어온다.
import { routeAgentRequest } from "agents";
// AI SDK(패키지 이름 `ai`): Vercel이 만든 범용 라이브러리로 Cloudflare 전용이 아니다.
//   convertToModelMessages: 저장용 UIMessage[] → 모델 입력용 ModelMessage[] 변환
//   streamText: 모델 응답을 스트림으로 받는다 (4.2의 generateText를 대체)
// 4.2에서 쓰던 generateText import는 뺐다 — tsconfig의 noUnusedLocals 때문에
//   안 쓰는 import가 남아 있으면 `npx tsc -b`가 실패한다(TS6133).
//   generateText 버전의 코드는 4.2 커밋에 남아 있다.
import { convertToModelMessages, streamText } from "ai";
// workers-ai-provider: AI SDK가 "Cloudflare에 호스팅된 모델"을 쓰게 해주는 어댑터.
//   AI SDK 자체는 OpenAI/Anthropic 등 어떤 공급자든 쓸 수 있고, 공급자마다
//   이런 provider 패키지가 하나씩 있다.
import { createWorkersAI } from "workers-ai-provider";

/**
 * 채팅 에이전트. 클래스 이름 = wrangler.jsonc의 DO 바인딩 이름
 * = 프론트 useAgent({ agent: "PotatoChatAgent" })의 이름. 셋이 같아야 한다.
 *
 * AIChatAgent도 결국 Durable Object라서 wrangler.jsonc에
 * durable_objects 바인딩 + new_sqlite_classes 마이그레이션이 그대로 필요하다.
 * 메시지는 인스턴스 전용 SQLite의 cf_ai_chat_agent_messages 테이블에
 * 자동으로 쌓인다 — Section 3의 onStart/CREATE TABLE이 사라진 이유다.
 */
export class PotatoChatAgent extends AIChatAgent<Env> {
  /**
   * AIChatAgent가 요구하는 유일한 구현. 프론트에서 sendMessage 할 때마다 불린다.
   * 이 시점에 방금 온 사용자 메시지는 이미 this.messages 맨 뒤에 저장돼 있고,
   * 여기서 반환한 응답은 assistant 역할로 자동 저장 + 전 클라이언트에 브로드캐스트된다.
   *
   * 시그니처는 원래 onChatMessage(onFinish, options?)이지만 지금은 둘 다 안 쓰므로
   * 생략했다 (options.abortSignal은 사용자가 중단 버튼을 눌렀을 때 모델 호출을
   * 끊는 용도 — 뒤 회차에서 쓴다).
   */
  async onChatMessage() {
    // 4.2 — "모델들이 사는 곳"으로의 연결. this.env.AI는 wrangler.jsonc의
    //   "ai": { "binding": "AI" } 로 만든 바인딩이다(4.0에서 추가, cf-typegen으로
    //   Env 타입 생성). KV/DO 바인딩과 달리 AI 바인딩은 로컬 dev에서도 항상
    //   원격 GPU를 호출한다 — 오프라인 개발 불가, 무료 한도(뉴런) 소모.
    const workersAi = createWorkersAI({
      binding: this.env.AI,
    });

    // 4.3 — streamText는 await 하지 않는다. 반환값이 Promise가 아니라
    //   StreamTextResult 객체이고, 모델이 첫 토큰을 뱉는 순간부터 흘려보내는 게
    //   목적이기 때문이다. (강의 따라 치며 붙였던 await는 뺐다 — 동작엔 지장
    //   없지만 "다 기다렸다 준다"는 오해를 부르는 코드라서.)
    const result = streamText({
      // 모델 ID는 문자열. TS 자동완성 목록은 최신이 아닐 수 있으니 대시보드
      //   Workers AI 모델 카탈로그에서 ID를 복사해 온다. glm-4.7-flash는
      //   reasoning(생각 과정)을 내보내는 모델이라 4.3의 reasoning 파트 데모에 쓰였다.
      model: workersAi("@cf/zai-org/glm-4.7-flash"),
      // this.messages(UIMessage: id·parts 구조)를 모델이 받는 형태(role·content)로
      //   변환한다. id 같은 저장용 필드가 여기서 떨어져 나간다.
      //   과거 대화 전체가 매번 들어가므로 모델은 "기억"을 갖는 것처럼 보인다 —
      //   대신 대화가 길어질수록 입력 토큰(=비용)이 늘어난다.
      messages: await convertToModelMessages(this.messages),
    });

    // 4.2에서는 `const { text } = await generateText(...)` 후 new Response(text).
    //   스트림을 "UI 메시지 스트림 프로토콜"(text-delta, reasoning-delta …)로
    //   변환한 Response를 돌려주면 AIChatAgent가 조각마다 저장·브로드캐스트하고,
    //   프론트 useAgentChat이 messages를 실시간으로 갱신한다.
    return result.toUIMessageStreamResponse();
  }
}

export default {
  // routeAgentRequest는 Promise<Response | null>을 반환하므로 반드시 await 한 뒤
  //   ?? 로 404 처리해야 한다. await 없이 `routeAgentRequest(...) ?? 404`라고 쓰면
  //   Promise는 절대 null이 아니어서 404 분기가 죽은 코드가 된다 (강사 코드는
  //   그렇게 돼 있는데, 우리 코드처럼 await를 두는 쪽이 정확하다).
  async fetch(request, env) {
    return (
      (await routeAgentRequest(request, env)) ??
      new Response(null, { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
