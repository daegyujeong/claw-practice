/**
 * ============================================================
 * Section 4 — AIChatAgent (4.0 Introduction ~ 4.7 Sanitize Message)
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
 * - 4.4(Tools): streamText에 tools를 넘기면 모델이 필요할 때 함수를 호출한다.
 *   "툴 호출 → 결과 회신"이 한 스텝이고, stopWhen이 없으면 1스텝에서 멈춰
 *   툴만 부르고 답을 안 한다 — 그래서 stopWhen이 필요하다.
 * - 4.5(Browser Tools): execute가 없는 툴은 브라우저로 넘어간다. 서버는 tool call만
 *   내려보내고, 프론트 onToolCall이 실행해 addToolOutput으로 결과를 돌려준다.
 * - 4.6(Tool Approvals): needsApproval이 있는 툴은 사용자 승인 후에만 실행된다.
 *   + onChatMessage의 두 번째 인자 options.abortSignal을 streamText에 넘기면
 *   프론트의 stop() 버튼이 진행 중인 모델 호출을 실제로 끊는다.
 * - 4.7(Sanitize Message): sanitizeMessageForPersistence를 오버라이드하면 메시지가
 *   SQLite에 저장되기 직전에 내용을 바꾸거나 가릴 수 있다 (반드시 메시지를 반환).
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
//   isLoopFinished: 4.4 — stopWhen 조건 중 하나 ("모델이 스스로 끝낼 때까지")
// 4.2에서 쓰던 generateText import는 뺐다 — tsconfig의 noUnusedLocals 때문에
//   안 쓰는 import가 남아 있으면 `npx tsc -b`가 실패한다(TS6133).
//   generateText 버전의 코드는 4.2 커밋에 남아 있다.
//   StreamTextOnFinishCallback / ToolSet: 4.6 — onChatMessage 시그니처를 정확히
//   쓰기 위한 타입. import type 이므로 런타임 코드에는 남지 않는다.
import {
  convertToModelMessages,
  isLoopFinished,
  streamText,
  type StreamTextOnFinishCallback,
  type ToolSet,
  type UIMessage,
} from "ai";
// workers-ai-provider: AI SDK가 "Cloudflare에 호스팅된 모델"을 쓰게 해주는 어댑터.
//   AI SDK 자체는 OpenAI/Anthropic 등 어떤 공급자든 쓸 수 있고, 공급자마다
//   이런 provider 패키지가 하나씩 있다.
import { createWorkersAI } from "workers-ai-provider";
// 4.4 — 툴 정의는 별도 파일로 분리했다 (인라인으로 써도 된다).
// 4.5 — getLocation은 execute가 없는 "브라우저 툴"이지만 등록은 똑같이 서버에서 한다.
//   모델은 툴이 어디서 실행되는지 모른다 — 이름·설명·스키마만 본다.
// 4.6 — getTickets(검색) + buyPlaneTicket(needsApproval 조건부 승인).
import { buyPlaneTicket, getLocation, getTickets, getWeather } from "./tools";

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
   * 4.6 — 시그니처를 원래 형태 onChatMessage(onFinish, options?)로 되돌렸다.
   *   _onFinish: 스트림이 끝났을 때의 콜백. 안 쓰므로 `_` 접두어로 "의도적으로
   *     안 씀"을 표시한다 (noUnusedParameters 경고 회피 관례).
   *   options.abortSignal: 프론트가 stop()을 누르면 abort 되는 신호. streamText에
   *     그대로 넘겨야 모델 호출이 실제로 중단된다 — 안 넘기면 화면만 멈추고 서버는
   *     끝까지 토큰을 생성(= 비용)한다. 강의 메모 "abort signal 받아야 함"의 답.
   *   options에는 requestId(이 대화 턴의 ID)와 tools(클라이언트가 동적으로 등록한
   *     툴 스키마)도 들어 있다 — 지금은 안 쓴다.
   *   타입: 강사는 처음 `unknown`으로 두었다가 라이브러리가 요구하는 타입
   *     StreamTextOnFinishCallback<ToolSet>을 import해 맞췄다 — 부모 클래스의
   *     메서드를 오버라이드할 때는 시그니처가 호환돼야 TS가 통과한다.
   */
  async onChatMessage(
    _onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: { abortSignal?: AbortSignal },
  ) {
    // 4.2 — "모델들이 사는 곳"으로의 연결. this.env.AI는 wrangler.jsonc의
    //   "ai": { "binding": "AI" } 로 만든 바인딩이다(4.0에서 추가, cf-typegen으로
    //   Env 타입 생성). KV/DO 바인딩과 달리 AI 바인딩은 로컬 dev에서도 항상
    //   원격 GPU를 호출한다 — 오프라인 개발 불가, 무료 한도(뉴런) 소모.
    const workersAi = createWorkersAI({
      binding: this.env.AI,
    });

    // 4.3 — streamText는 await 하지 않는다. 반환값이 Promise가 아니라
    //   StreamTextResult 객체이고, 모델이 첫 토큰을 뱉는 순간부터 흘려보내는 게
    //   목적이기 때문이다.
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
      // 4.4 — 모델에게 주는 도구 목록. 객체의 **키**가 모델이 부르는 툴 이름이다
      //   (tools.ts의 title이 아니다). 모델은 각 툴의 description·inputSchema를
      //   읽고 "지금 이 툴이 필요한가"를 스스로 판단한다.
      tools: {
        getWeather,
        getLocation,
        getTickets,
        buyPlaneTicket,
      },
      // 4.6 — 중단 신호 연결. options는 optional이므로 ?. 로 접근한다
      //   (강사 코드는 options.abortSignal — strict 모드에서는 "possibly undefined"
      //   에러가 날 수 있는 형태라 우리 코드는 ?. 를 붙였다).
      abortSignal: options?.abortSignal,
      // 4.4 — 멈춤 조건. 기본값은 stepCountIs(1): "툴을 부르고 결과를 받으면
      //   1스텝 끝" → 모델이 툴만 호출하고 최종 답을 안 하는 이유가 이것이다.
      //   선택지: stepCountIs(N) — N스텝 후 정지(비용 상한, 안전),
      //          hasToolCall("이름") — 특정 툴이 불리면 정지,
      //          isLoopFinished() — 모델이 스스로 끝낼 때까지 (무한 루프·토큰
      //          폭주 위험이 있어 강의도 "더 위험한 선택"이라 했다).
      //   배열로 넘기면 하나라도 만족할 때 멈춘다: [isLoopFinished(), stepCountIs(50)]
      //   강사 최종 코드가 isLoopFinished()라서 그대로 따르되, 실서비스라면
      //   stepCountIs를 함께 두는 편이 안전하다.
      stopWhen: isLoopFinished(),
    });

    // 4.2에서는 `const { text } = await generateText(...)` 후 new Response(text).
    //   스트림을 "UI 메시지 스트림 프로토콜"(text-delta, reasoning-delta,
    //   tool-input-*, tool-output-* …)로 변환한 Response를 돌려주면 AIChatAgent가
    //   조각마다 저장·브로드캐스트하고, 프론트 useAgentChat이 messages를 실시간으로
    //   갱신한다. 4.4부터는 툴 호출 조각도 이 스트림에 섞여 온다.
    return result.toUIMessageStreamResponse();
  }

  /**
   * 4.7 — 저장 직전 훅. 사용자 메시지든 모델 응답이든, AIChatAgent가 SQLite에
   * 쓰기 전에 메시지 하나씩 이 메서드를 거친다. 규칙은 하나 — **반드시 UIMessage를
   * 반환**한다 (수정했든 안 했든). 이메일·전화번호 마스킹, 긴 툴 출력 잘라내기
   * 같은 "저장본만 다듬기"에 쓴다. 화면에 흐르는 스트림은 그대로이고, 새로고침해서
   * 히스토리를 다시 불러올 때 바뀐 내용이 보인다.
   *
   * 이름 주의: 강의 녹취는 "sanitizeMessageForPersistent"로 들리지만 실제 메서드는
   * sanitizeMessageForPersistence 다. 또 강의에서 message.data.parts 라고 했다가
   * 고쳤는데, UIMessage의 parts는 message.parts 다 (강사 최종 코드도 그렇다).
   *
   * 라이브러리는 이 훅 **앞에서** 자체 정리를 먼저 한다 — OpenAI 응답의 itemId 같은
   * 일회성 메타데이터 제거, 공급자가 서버에서 실행한 툴의 거대한 입출력 잘라내기,
   * 빈 reasoning 파트 삭제. 우리 훅은 그 뒤의 "사용자 정의 단계"다.
   */
  sanitizeMessageForPersistence(message: UIMessage): UIMessage {
    // 스프레드로 복사해 새 객체를 돌려준다 — 원본을 제자리에서 고치지 않는 관례.
    return {
      ...message,
      // parts는 배열이므로 map으로 하나씩 검사한다. text 파트만 바꾸고 나머지
      //   (reasoning, tool-*)는 그대로 통과시킨다.
      parts: message.parts.map((part) => {
        if (part.type === "text") {
          return {
            ...part,
            // 데모용 치환. replace(문자열)은 **첫 번째** 일치만 바꾼다 — 전부
            //   바꾸려면 replaceAll("food", …) 또는 정규식 /food/g 를 쓴다.
            text: part.text.replace("food", "❌ stop eating u fat ❌"),
          };
        }
        return part;
      }),
    };
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
