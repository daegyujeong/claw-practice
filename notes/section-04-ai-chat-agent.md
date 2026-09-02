# Section 4 — AIChatAgent (4.0 ~ 4.7)

> Nomad Coders 「Cloudflare Agents」 강의 Section 4의 학습 노트다. 4.0(셋업)부터 4.7 Sanitize Message까지 — 채팅 배선, 스트리밍, 툴 호출, 브라우저 툴, 승인, 저장 훅 — 을 정리했다.
> 📘 표시가 붙은 부분은 **Cloudflare 공식 문서(developers.cloudflare.com), AI SDK 문서(ai-sdk.dev), 설치된 SDK의 타입 정의**를 참조해 강의에 없던 사실을 보강한 것이다.

---

## 0. 강의 흐름 한눈에 보기

```
4.0 Introduction:  ai-chat-agent-foundations 프로젝트 생성 (React 프레임워크 스타터)
                   + agents / @cloudflare/ai-chat / ai / zod / workers-ai-provider 설치
                   + PotatoChatAgent extends AIChatAgent + DO 바인딩 + AI 바인딩
4.1 AIChatAgent:   useAgent → useAgentChat(messages, sendMessage) 로 채팅 UI
                   + onChatMessage 오버라이드 (필수) → "hello" 응답
                   + this.messages 에 대화가 자동 저장되는 것 확인 (parts 구조)
4.2 generateText:  createWorkersAI(env.AI) → 모델 연결
                   + convertToModelMessages(this.messages) → generateText → 텍스트 응답
                   + clearHistory 버튼 (AIChatAgent 내장)
4.3 streamText:    generateText → streamText + toUIMessageStreamResponse 로 스트리밍
                   + 브로드캐스트·기억(전체 대화 전달)·히스토리 복원은 이미 공짜
                   + reasoning 파트 렌더 (모델의 "생각 과정")
4.4 Tools:         tool() + zod 로 getWeather 정의 → streamText({ tools })
                   + stopWhen (기본 1스텝이라 툴만 부르고 멈추는 문제) + 툴 파트 UI + status
4.5 Browser Tools: execute 없는 getLocation → 프론트 onToolCall 에서 실행 → addToolOutput
4.6 Tool Approvals: needsApproval(price > 200) → approval-requested 파트
                   + addToolApprovalResponse(approve/reject) + stop() ↔ options.abortSignal
4.7 Sanitize:      sanitizeMessageForPersistence — 저장 직전에 메시지 다듬기
─── 이어서: 5.x 이메일·웹훅으로 에이전트와 대화하기
```

핵심 줄거리: **"Section 3에서 손수 만들던 채팅방(메시지 테이블, INSERT, broadcast, loadHistory)을 AIChatAgent가 전부 내장하고 있고, 우리는 `onChatMessage` 하나만 구현하면 된다. 거기에 AI SDK 함수 한 개를 넣으면 AI 챗봇이 되고(4.1~4.3), `tools`를 넘기면 에이전트가 된다(4.4~4.6)."** 앞 세 회차에서 바뀌는 코드는 `onChatMessage` 안의 몇 줄뿐이고, 뒤 네 회차에서도 서버에 직접 쓴 것은 툴 정의와 옵션 몇 줄이다. 툴 호출·승인·중단·저장은 라이브러리가 하고, 우리는 그 흐름(스텝, 파트 상태, 실행 위치)을 이해하는 것이 목표다.

---

## 1. AIChatAgent란 — Agent 위에 얹힌 채팅 전용 계층

- `AIChatAgent`는 Section 3의 `Agent` 클래스를 **상속**한다. 그러므로 `state`/`setState`, `@callable`, `this.sql`, `broadcast`, `schedule` 등 Agent의 모든 기능이 그대로 있다.
- 그 위에 **채팅에 필요한 것**이 미리 구현돼 있다: 메시지 저장, 전 클라이언트 브로드캐스트, 새로고침 시 히스토리 복원, 스트리밍 응답 전달, 대화 삭제.
- 결국 Durable Object이므로 wrangler.jsonc의 **DO 바인딩과 `new_sqlite_classes` 마이그레이션은 그대로 필요**하다.

Section 3에서 직접 짰던 것과 대조하면 이 클래스가 무엇을 대신해 주는지 분명해진다.

| Section 3에서 직접 만든 것 | Section 4에서 대신해 주는 것 |
|---|---|
| `onStart`에서 `CREATE TABLE messages` | 없음 — 내장 테이블에 자동 저장 |
| `onMessage`에서 `INSERT` + `this.broadcast` | 없음 — `sendMessage` 한 번에 저장·브로드캐스트 |
| `@callable loadHistory` + 프론트에서 호출 | 없음 — `useAgentChat`의 `messages`가 복원까지 해 준다 |
| 프론트 `agent.send` / `onMessage` 로 문자열 주고받기 | `sendMessage` / `messages` (구조화된 UIMessage) |
| 삭제용 `@callable` + `DELETE FROM` | `clearHistory()` 내장 |
| 우리가 구현할 것 | **`onChatMessage` 하나** |

> 📘 공식 문서 보강 — `AIChatAgent`는 `agents` 패키지가 아니라 **별도 패키지 `@cloudflare/ai-chat`** 에 산다(`import { AIChatAgent } from "@cloudflare/ai-chat"`). 예전 경로 `agents/ai-chat-agent`, `agents/ai-react`도 남아 있지만 지금은 새 패키지를 **재export하는 껍데기**다(설치된 `agents/dist/ai-react.d.ts`의 내용이 `export * from "@cloudflare/ai-chat/react"` 한 줄이다). 강사 저장소도 뒤 챕터 템플릿에서는 `useAgentChat`을 `@cloudflare/ai-chat/react`에서 import하도록 옮겼다. 우리 코드의 `agents/ai-react`는 그대로 동작하지만, 새로 쓴다면 `@cloudflare/ai-chat/react`가 정식 경로다.

---

## 2. 4.0 Introduction — 프로젝트 셋업

### 생성과 설치

| 단계 | 명령/선택 |
|---|---|
| 프로젝트 생성 | `npm create cloudflare@latest ai-chat-agent-foundations` |
| 템플릿 | **Framework Starter → React → TypeScript** (Section 3과 동일) |
| git / 배포 | 둘 다 No |
| 패키지 설치 | `npm install agents @cloudflare/ai-chat ai zod workers-ai-provider` |
| 타입 생성 | `npm run cf-typegen` (= `wrangler types`) — 바인딩 바꿀 때마다 |

다섯 패키지가 각각 무엇인지가 이 섹션 전체의 지도다.

| 패키지 | 역할 | 이번 범위에서 쓰는 것 |
|---|---|---|
| `agents` | Agent 클래스, `routeAgentRequest`, React 훅 `useAgent` | `routeAgentRequest`, `useAgent` |
| `@cloudflare/ai-chat` | `AIChatAgent` 클래스 + `useAgentChat` 훅 | `AIChatAgent`, `useAgentChat` |
| `ai` (**AI SDK**) | 모델과 대화하는 범용 JS 라이브러리. **Vercel이 만들었고 Cloudflare 전용이 아니다.** 어느 런타임에서든 돌아간다 | `convertToModelMessages`, `generateText`, `streamText` |
| `workers-ai-provider` | AI SDK가 **Cloudflare에 호스팅된 모델**을 쓰게 해 주는 어댑터(provider) | `createWorkersAI` |
| `zod` | 스키마 검증 라이브러리. **툴(도구)의 입력 형식을 정의**할 때 쓴다 | 아직 안 씀 — 4.4 Tools부터 |

AI SDK는 "모델 API마다 다른 호출 방식"을 하나의 함수(`generateText` 등)로 통일해 주는 층이고, provider는 그 뒤에서 실제 공급자(OpenAI, Anthropic, Cloudflare …)와 통신하는 부품이다. Cloudflare에서는 provider 자리에 `workers-ai-provider`가 들어간다.

### 워커 쪽 — 클래스 하나 + 라우터

```ts
import { AIChatAgent } from "@cloudflare/ai-chat";
import { routeAgentRequest } from "agents";

export class PotatoChatAgent extends AIChatAgent<Env> {}

export default {
  async fetch(request, env) {
    return (
      (await routeAgentRequest(request, env)) ??
      new Response(null, { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
```

Section 3의 셋업과 다른 점은 상속하는 클래스가 `Agent`에서 `AIChatAgent`로 바뀐 것뿐이다. `routeAgentRequest`는 `/agents/:클래스이름/:인스턴스이름` URL을 알아서 해당 DO로 넘긴다 — 채팅 WebSocket도 이 경로로 들어온다.

### wrangler.jsonc — DO 바인딩 + AI 바인딩

```jsonc
"ai": { "binding": "AI" },
"durable_objects": {
  "bindings": [{ "class_name": "PotatoChatAgent", "name": "PotatoChatAgent" }]
},
"migrations": [{ "new_sqlite_classes": ["PotatoChatAgent"], "tag": "1" }]
```

- DO 바인딩과 마이그레이션은 Section 2·3과 같다. 바인딩 이름은 클래스 이름과 맞춘다.
- **`"ai": { "binding": "AI" }` 가 이번에 새로 들어간 것이다.** 이 한 줄이 Cloudflare가 호스팅하는 모든 AI 모델(텍스트, 이미지, 임베딩, reasoning 모델 …)에 접근하는 열쇠다. 바인딩 이름(`AI`)은 자유지만 관례적으로 `AI`를 쓴다. 이 설정을 넣고 `cf-typegen`을 돌리면 `Env`에 `AI: Ai` 타입이 생기고, 4.2에서 `this.env.AI`로 꺼내 쓴다.

> 📘 공식 문서 보강 — **AI 바인딩은 로컬에서도 항상 원격이다.** KV나 DO는 `wrangler dev`가 로컬에서 흉내 내지만, AI 모델은 GPU가 필요하므로 로컬 시뮬레이션이 없다. 개발 중에도 실제 Cloudflare 모델을 호출하고, **개발 중 호출도 과금·한도에 포함된다.** Workers AI는 "뉴런(neuron)"이라는 단위로 GPU 사용량을 잰다. 무료·유료 플랜 공통으로 **하루 10,000 뉴런까지 무료**, 초과분은 Workers Paid($5/월) 플랜에서 1,000 뉴런당 $0.011이다. 강의에서 "$5 결제를 권한" 이유가 이것이다 — 무료 플랜은 하루 한도를 넘는 순간 막힌다. 모델마다 뉴런 소모량이 다르므로 비싼 모델일수록 한도가 빨리 소진된다.

---

## 3. 4.1 AIChatAgent — 채팅 배선과 자동 메시지 저장

이 강의는 순서가 특이하다. 보통은 백엔드를 먼저 만들고 프론트를 붙이는데, 여기서는 **프론트(폼)를 먼저 만들고 보내 본 뒤, 에러를 보고 백엔드를 채운다.** "AIChatAgent가 우리에게 무엇을 요구하는지"를 에러로 보여 주기 위해서다.

### 프론트 — useAgent 위에 useAgentChat

```tsx
const agent = useAgent({ agent: "PotatoChatAgent" });
const { messages, sendMessage } = useAgentChat({ agent });
```

- `useAgent`는 Section 3과 같은 훅이다 — WebSocket 연결 객체를 만든다. 이름은 워커 클래스 이름과 같아야 한다. `agent.state`, `agent.stub`, `agent.send`도 여전히 쓸 수 있다.
- **`useAgentChat`에 그 연결을 넘기면 채팅에 필요한 것이 한 번에 나온다.** `messages`(전체 대화 배열), `sendMessage`(보내기), 그리고 뒤에서 쓸 `status`, `clearHistory` 등. 메시지 상태를 직접 관리하는 `useState`가 하나도 없다.
- 폼은 비제어(uncontrolled) 방식: `new FormData(e.currentTarget).get("input")`으로 값을 꺼내고 `reset()`으로 비운다. **FormData·reset은 React 문법이 아니라 브라우저 표준 Web API**다.
- `sendMessage({ text: message })` — `{ text }`만 주면 훅이 `{ role: "user", parts: [{ type: "text", text }] }` 형태의 메시지로 감싸 서버로 보낸다.

### 워커 — onChatMessage는 필수

폼을 만들고 보내면 에러가 난다: **`onChatMessage`를 오버라이드하지 않았기 때문**이다. 이것이 AIChatAgent가 요구하는 유일한 구현이다.

```ts
export class PotatoChatAgent extends AIChatAgent<Env> {
  async onChatMessage() {
    console.log(JSON.stringify(this.messages));
    return new Response("hello");
  }
}
```

- 프론트에서 `sendMessage` 할 때마다 자동으로 불린다. 반환한 `Response`가 사용자에게 보이는 답이다.
- **`this.messages`** — 이 대화에서 오간 모든 메시지. 테이블도 안 만들고 INSERT도 안 했는데 이미 들어 있다. `onChatMessage`가 불리는 시점에 방금 온 사용자 메시지는 **이미 맨 뒤에 저장돼 있다.**
- 규칙 두 가지: ① `sendMessage`로 보낸 것은 `role: "user"`로 저장된다. ② `onChatMessage`가 반환한 것은 `role: "assistant"`로 저장된다. 우리는 아무것도 안 했다.
- 실시간이다. 다른 탭을 열어 두면 보내는 즉시 거기에도 나타난다(브로드캐스트 내장 — 4.3에서 다시 확인).

### 메시지의 모양 — UIMessage와 parts

`console.log`로 본 메시지 하나는 이렇게 생겼다.

```json
{
  "id": "…",
  "role": "user",
  "parts": [{ "type": "text", "text": "hello" }]
}
```

- `id`: 서버(AIChatAgent)가 붙여 준다. React `key`로 바로 쓴다.
- `role`: `"user"` / `"assistant"`(/ `"system"`) — 모델 API들이 공통으로 쓰는 역할 이름.
- **`parts`**: 문자열 하나가 아니라 **조각의 배열**이다. 모델 메시지는 텍스트, 이미지, 파일, 툴 호출, reasoning 등 여러 종류의 조각으로 이뤄질 수 있다는 것이 AI SDK(그리고 모델 API들)의 표준이기 때문이다. 그래서 프론트에서 `message.text`가 아니라 `message.parts.map(...)`으로 돌면서 `part.type === "text"`인 것만 골라 그린다. 4.3의 reasoning도, 4.4의 툴 호출도 전부 "새로운 type의 part"로 온다.

> 📘 공식 문서 보강 — 이 형식의 이름은 AI SDK의 **`UIMessage`** 다(`this.messages: UIMessage[]`). 저장소는 인스턴스 전용 SQLite의 **`cf_ai_chat_agent_messages`** 테이블이다 — Section 3에서 우리가 만든 `messages` 테이블과 같은 DB에, 이름만 다르게 자동 생성된다(스트리밍 조각용 `cf_ai_chat_stream_chunks` 등 몇 개가 더 생긴다). 무한히 쌓이는 것이 싫으면 클래스 속성 **`maxPersistedMessages = 100`** 처럼 저장 개수 상한을 둘 수 있다(저장만 자르고, 모델에 보낼 개수는 별개 — 그건 AI SDK의 `pruneMessages`로). 또 `onChatMessage`의 실제 시그니처는 `onChatMessage(onFinish, options?)`이고, `options`에는 `abortSignal`(사용자가 중단을 눌렀을 때 모델 호출을 끊는 신호), `requestId`, 클라이언트가 함께 보낸 `body` 등이 들어 있다. 강의에서는 둘 다 안 쓰므로 인자를 생략했다.

---

## 4. 4.2 generateText — 진짜 모델에게 묻기

바뀌는 것은 `onChatMessage` 안쪽뿐이다.

```ts
import { convertToModelMessages, generateText } from "ai";
import { createWorkersAI } from "workers-ai-provider";

async onChatMessage() {
  const workersAi = createWorkersAI({ binding: this.env.AI });
  const { text } = await generateText({
    model: workersAi("@cf/zai-org/glm-4.7-flash"),
    messages: await convertToModelMessages(this.messages),
  });
  return new Response(text);
}
```

세 단계로 읽는다.

**① `createWorkersAI({ binding: this.env.AI })` — 모델들이 사는 곳에 연결.** `this.env.AI`는 4.0에서 wrangler.jsonc에 넣은 AI 바인딩이다. 이 호출은 AI SDK에게 "공급자는 Cloudflare Workers AI다"라고 알려 주는 것이다. (강의에서 "AI Gateway"를 잠깐 언급했는데, Cloudflare에 호스팅되지 않은 모델 — OpenAI, Anthropic 등 — 을 Cloudflare를 거쳐 쓰는 방법이다. 배포 챕터에서 다룬다.)

**② `convertToModelMessages(this.messages)` — 저장용 형식 → 모델용 형식.** 저장된 `UIMessage`에는 `id` 같은 저장용 필드가 있는데 모델은 그런 걸 모른다. 이 함수가 모델이 받는 형식(`ModelMessage`)으로 바꿔 준다. 강의에서 두 배열을 나란히 `console.log` 해서 `id`가 빠지는 것을 보여 줬다.

| | UIMessage (저장/화면용) | ModelMessage (모델 입력용) |
|---|---|---|
| 어디에 | `this.messages`, 프론트 `messages` | `generateText`/`streamText`의 `messages` |
| 식별자 | `id` 있음 | 없음 |
| 본문 | `parts: [{ type, text }]` | `content` (문자열 또는 파트 배열) |
| 변환 | — | `convertToModelMessages(uiMessages)` |

**③ `generateText({ model, messages })` — AI SDK 문서 첫 페이지의 예제 그대로.** 다른 점은 `model` 자리에 `openai("gpt-…")` 대신 `workersAi("@cf/…")`가 온다는 것뿐이다. 결과의 `text`를 `Response`로 돌려주면 끝 — 4.1의 `"hello"`가 진짜 답변으로 바뀐다.

- 모델 ID는 문자열이다. TypeScript 자동완성 목록이 뜨지만 **최신이 아닐 수 있다**(강의 시점에 원하던 모델이 목록에 없었다). 대시보드의 Workers AI 모델 카탈로그에서 ID를 복사해 붙이면 된다. 강의는 `@cf/zai-org/glm-4.7-flash`를 골랐다.
- **모델은 `this.messages` 전체를 매번 받는다.** 그래서 "내 이름은 니꼬야" → "니꼬, 반가워"가 되고 새로고침해도 이름을 기억한다. 기억이 아니라 **매번 대화 전체를 다시 읽는 것**이다 — 대화가 길수록 입력 토큰(비용)이 늘어나는 이유이기도 하다.

### clearHistory — 이미 있는 삭제 버튼

```tsx
const { messages, sendMessage, clearHistory } = useAgentChat({ agent });
<button onClick={clearHistory}>clear convo</button>
```

Section 3이었으면 `@callable` 메서드를 만들어 `DELETE FROM messages`를 실행했을 일이다. `AIChatAgent`는 `Agent`를 상속하므로 그렇게 해도 되지만, 이미 `clearHistory`가 있다. 서버 저장소를 비우고 브로드캐스트하므로 다른 탭도 함께 비워진다.

> 📘 공식 문서 보강 — `@cf/zai-org/glm-4.7-flash`의 가격은 입력 100만 토큰당 $0.06(5,500 뉴런), 출력 100만 토큰당 $0.40(36,400 뉴런)이다. 무료 한도 10,000 뉴런은 대략 **출력 27만 토큰** 정도 — 한글 채팅 실습에는 넉넉하지만, 대화 전체를 매번 보내므로 긴 대화를 반복하면 입력 쪽이 먼저 쌓인다. 개발 중 `clear convo`를 자주 누르는 것이 비용 면에서도 좋다.

---

## 5. 4.3 streamText — 글자 단위로 흘려보내기

### 문제: 다 쓸 때까지 아무것도 안 보인다

`generateText`는 모델이 답을 **끝까지 다 쓴 뒤에** 텍스트를 돌려준다. 긴 질문("스트리밍과 SSE의 차이를 설명해 줘")을 하면 몇 초간 화면이 멈춘 듯 보인다. 모델은 이미 쓰고 있는데 우리가 안 보여 주는 것이다.

### 해결: 세 군데 수정

```ts
import { convertToModelMessages, streamText } from "ai";

async onChatMessage() {
  const workersAi = createWorkersAI({ binding: this.env.AI });
  const result = streamText({                         // ① await 없음
    model: workersAi("@cf/zai-org/glm-4.7-flash"),
    messages: await convertToModelMessages(this.messages),
  });
  return result.toUIMessageStreamResponse();          // ② 텍스트 대신 스트림 응답
}
```

- ① **`streamText`는 `await` 하지 않는다.** 반환값이 Promise가 아니라 `StreamTextResult` 객체다. 모델이 첫 토큰을 뱉는 순간부터 흘려보내는 것이 목적이므로 "끝날 때까지 기다리는" await가 있으면 안 된다. (따라 치면서 붙인 `await`는 동작을 막지는 않지만 — 객체를 await 하면 그냥 그 객체가 나온다 — 의도를 오해하게 만드는 코드라서 뺐다.)
- ② **`result.toUIMessageStreamResponse()`** — 스트림을 프론트가 이해하는 형식의 `Response`로 바꾼다. `AIChatAgent`가 이 스트림을 받아 조각마다 저장·브로드캐스트하고, 프론트 `useAgentChat`이 `messages`를 실시간으로 갱신한다.
- ③ **프론트는 한 줄도 안 바꿨다.** `messages.map(...)`이 그대로인데 글자가 차례로 나타난다. 스트리밍이란 "메시지의 `parts`가 조각조각 채워지는 것"이고, `useAgentChat`이 그 조각을 이어 붙여 `messages`에 반영하기 때문이다.

### 이미 공짜인 것들 — 브로드캐스트, 기억, 히스토리

이 회차에서 강사가 확인만 하고 넘어간 것들이지만 Section 3과 비교하면 전부 우리가 짰던 기능이다.

| 기능 | Section 3 | Section 4 |
|---|---|---|
| 다른 탭에도 실시간 반영 | `this.broadcast` 직접 호출 | 내장 — 스트리밍 조각까지 전 탭에 |
| 새로고침 후 대화 복원 | `loadHistory` RPC 직접 구현 | 내장 — `messages`가 복원돼 나온다 |
| 이전 대화 기억 | (AI 없음) | `this.messages` 전체를 모델에 전달 |

### reasoning 파트 — 모델의 생각 과정 보여 주기

`glm-4.7-flash`는 답하기 전에 **내부 독백(reasoning)** 을 먼저 생성하는 모델이다. 이것도 스트림으로 오지만 프론트가 `text` 파트만 그리고 있어서 그동안 화면이 비어 보인다.

```tsx
{message.parts.map((part, index) =>
  part.type === "text" ? (
    <span key={index}>{part.text}</span>
  ) : part.type === "reasoning" ? (
    <em key={index}>{part.text}</em>
  ) : null,
)}
```

- `part.type`이 `"reasoning"`인 조각을 `<em>`으로 구분해 그리면 생각 과정이 먼저 흐르고 이어서 답이 나온다. 새로고침해도 reasoning까지 복원된다(저장되므로).
- 이름 주의: 강의에서 잠깐 "thinking"이라고 했다가 고쳤다 — AI SDK의 타입 이름은 **`reasoning`** 이다.
- 타입 목록에는 `text`, `reasoning` 외에 `file`, `source-url`, `dynamic-tool`, `tool-…`, `step-start` 등이 더 있다. 지금은 두 가지만 그리고, 나머지는 툴이 등장하는 4.4부터 필요해진다. 강사도 "이대로 두면 지저분해지니 UI는 나중에 AI에게 시켜 정리하겠다"고 했다.
- 스무고개 과제에서 정답이 새어 나간 통로가 바로 이 reasoning 파트였다 — 모델이 "생각"하면서 정답을 입 밖에 내기 때문이다.

> 📘 공식 문서 보강 — AI SDK 문서에 따르면 **`streamText`의 에러는 throw 되지 않고 스트림의 일부로 흘러간다**(서버가 죽는 것을 막기 위해). 그래서 `try/catch`로는 못 잡고 `streamText({ onError({ error }) { … } })` 콜백으로 잡아야 한다. 또 스트림은 **소비되는 만큼만 생성된다**(backpressure) — 반환된 스트림을 누군가 읽어야 모델 호출이 끝까지 진행되는데, `toUIMessageStreamResponse()`로 돌려주면 `AIChatAgent`가 읽어 준다. `toUIMessageStreamResponse`가 만드는 것은 "UI 메시지 스트림 프로토콜"(text-delta, reasoning-delta, tool-call … 조각의 연속)이라서 프론트의 `useAgentChat`/`useChat`이 그대로 해석한다. 문자열만 흘리는 `toTextStreamResponse()`도 있지만 그러면 reasoning·툴 조각이 구분되지 않는다.

---

## 6. 4.4 Tools — 모델에게 손을 달아 주기

지금까지의 에이전트는 "말만" 한다. 툴(도구)을 주면 모델이 **필요할 때 우리 함수를 호출**한다. 강사의 표현대로 "이제야 챗봇이 아니라 에이전트"다.

### 툴 호출의 원리

모델은 우리 코드를 직접 실행하지 못한다. 대신 이렇게 돌아간다.

```
① 우리 → 모델: "getWeather라는 툴이 있다. 설명은 ~, 입력은 { city: string }"   (tools 옵션)
② 모델 → 우리: "getWeather를 city=Bilbao 로 불러 달라"                          (tool call, 응답에 섞여 옴)
③ 우리(서버): execute({ city: "Bilbao" }) 실행 → "The weather in the Bilbao is sunny."
④ 우리 → 모델: "③의 결과다"                                                     (tool result)
⑤ 모델 → 우리: "빌바오는 맑습니다"                                              (최종 답)
```

②~④가 **한 스텝(step)** 이고, ⑤까지 가려면 두 스텝이 필요하다. 이것이 뒤의 `stopWhen` 이야기로 이어진다.

### 툴 정의 — `tool()` + zod

```ts
// worker/tools.ts
import { tool } from "ai";
import z from "zod";

export const getWeather = tool({
  title: "GetWeather",                              // 표시용 이름 (선택)
  description: "Get the weather of a city",         // 모델이 "언제 쓸지" 판단하는 근거
  inputSchema: z.object({                           // 모델이 채워야 하는 입력의 모양
    city: z.string().meta({
      description: "The name of the city you want to get the weather from (ie: Malaga)",
    }),
  }),
  execute: ({ city }) => {                          // 모델이 호출하면 서버에서 실행
    return `The weather in the ${city} is sunny.`;
  },
});
```

| 필드 | 역할 | 비고 |
|---|---|---|
| `description` | 모델이 이 툴을 **언제** 쓸지 판단 | 명확할수록 오호출이 준다 |
| `inputSchema` | 모델이 **어떤 인자**로 부를지 + 런타임 검증 | zod 객체. 필드마다 `.meta({ description })` |
| `execute` | 모델이 부르면 **서버(DO)에서** 실행 | 인자는 스키마를 통과한 값. 반환값이 모델에게 감 |
| `title` | 사람이 읽는 이름 | 모델이 실제로 쓰는 이름은 `tools: { getWeather }`의 **키** |

강사는 `onChatMessage` 안에 인라인으로 만들어도 된다고 보여 준 뒤 `tools.ts`로 분리했다 — 툴이 늘어날수록 분리가 낫다.

**zod가 여기서 하는 일 세 가지** (4.5 메모 "zod의 용도?"의 답):

1. **모델에게 보낼 입력 형식 설명** — zod 스키마는 JSON Schema로 변환돼 툴 설명과 함께 모델에 전달된다. 모델은 이걸 보고 `{ "city": "Bilbao" }`를 만든다.
2. **런타임 검증** — 모델이 보낸 인자가 스키마에 안 맞으면(`city`가 없거나 숫자거나) 툴이 실행되지 않고 에러 파트가 된다. 모델 출력은 신뢰할 수 없는 입력이므로 검증이 필요하다.
3. **TypeScript 타입 추론** — `execute: ({ city }) => …`에서 `city`가 `string`으로 자동 추론된다. 타입을 두 번 쓰지 않아도 된다.

> 📘 공식 문서 보강 — `inputSchema`는 zod 전용이 아니다. Valibot, ArkType 등 Standard Schema를 따르는 라이브러리나 순수 JSON Schema(`jsonSchema()`)도 받는다. 강의가 zod를 고른 이유는 가장 널리 쓰이고 타입 추론이 좋기 때문이다. `.meta({ description })`은 **zod 4** 문법이고(설치된 것은 zod 4.x), zod 3에서는 `.describe("…")`를 쓴다 — 둘 다 모델에게 가는 설명이 된다. `execute`는 문자열뿐 아니라 객체·배열도 반환할 수 있다(4.6의 `getTickets`가 배열을 돌려준다).

### 서버 — `tools`와 `stopWhen`

```ts
const result = streamText({
  model: workersAi("@cf/zai-org/glm-4.7-flash"),
  messages: await convertToModelMessages(this.messages),
  tools: { getWeather },          // 키 = 모델이 부르는 툴 이름
  stopWhen: isLoopFinished(),     // 멈춤 조건
});
```

처음 `tools`만 넣고 "What is the weather in Bilbao?"를 보내면 모델이 reasoning → 툴 호출까지 하고 **답을 안 한 채 멈춘다.** `status`는 `ready`, 에러도 없다. 이유는 **`stopWhen`의 기본값이 `stepCountIs(1)`** — 툴을 부르고 결과를 받으면(1스텝) 거기서 끝이기 때문이다. 툴 결과를 보고 답을 만드는 두 번째 스텝이 필요하다.

| `stopWhen` 값 | 의미 | 언제 |
|---|---|---|
| `stepCountIs(N)` | N스텝 후 정지 (강의: 50 ≈ 툴 호출 25번) | 비용 상한이 필요할 때 — 가장 안전 |
| `hasToolCall("이름")` | 특정 툴이 불리면 정지 | "이 툴이 불리면 끝"인 흐름 |
| `isLoopFinished()` | 모델이 스스로 끝낼 때까지 | 강사 최종 코드. 무한 루프·토큰 폭주 위험 |
| `[a, b]` 배열 | 하나라도 만족하면 정지 | `[isLoopFinished(), stepCountIs(50)]` 같은 안전망 |

강의에서 "stepCount"라고 말한 함수의 실제 이름은 **`stepCountIs`** 다(강사 4.4 코드가 `isLoopFinished()`로 끝나 우리 코드도 그걸 따랐다).

> 📘 공식 문서 보강 — `stopWhen`은 **마지막 스텝에 툴 결과가 있을 때만** 평가된다. 툴을 안 부른 일반 답변은 조건과 무관하게 한 스텝에서 끝난다. 기본값이 1인 것은 `streamText`/`generateText`이고, AI SDK의 상위 추상화인 `ToolLoopAgent`는 기본값이 `stepCountIs(20)`이다. 루프가 멈추는 조건은 stopWhen 외에도 세 가지가 더 있다: 모델이 툴 호출 없이 답을 끝냈을 때, `execute`가 없는 툴이 불렸을 때(→ 4.5 브라우저 툴), 승인이 필요한 툴이 불렸을 때(→ 4.6). 스텝마다 모델·툴 목록·메시지를 바꾸는 `prepareStep` 콜백도 있다.

### 프론트 — `renderMessage`, 툴 파트, `status`

4.4에서 UI를 Tailwind로 갈아입혔지만(강사: "링크의 코드를 복사하라"), 구조상 바뀐 것은 세 가지다.

```tsx
import { getToolName, isToolUIPart, type UIMessage } from "ai";

function renderMessage(msg: UIMessage) {
  return msg.parts.map((part, i) => {
    if (part.type === "text") return <p key={i}>{part.text}</p>;
    if (part.type === "reasoning") return <p key={i} className="italic">{part.text}</p>;
    if (isToolUIPart(part)) {                      // "tool-getWeather" 같은 파트
      return (
        <div key={i}>
          {getToolName(part)} {part.state}          // 이름 + 상태
          {"input" in part && <pre>{JSON.stringify(part.input)}</pre>}
          {part.state === "output-available" && <pre>{JSON.stringify(part.output)}</pre>}
        </div>
      );
    }
    return null;
  });
}
```

- **툴 파트의 `type`은 `"tool-getWeather"`처럼 툴마다 다르다.** 그래서 문자열 비교 대신 `isToolUIPart(part)`로 판별하고, `getToolName(part)`로 이름만 꺼낸다.
- **파트 하나가 `state`를 바꿔 가며 갱신된다.** `input-streaming`(모델이 인자를 쓰는 중) → `input-available`(인자 확정, 실행 중) → `output-available`(결과 도착). `input`은 앞 단계에서 아직 없을 수 있어 `"input" in part`로 확인하고, `output`은 타입상 `output-available`일 때만 있다.
- **`status`** — `useAgentChat`이 주는 `"submitted" | "streaming" | "ready" | "error"`. 지금은 헤더에 날것으로 찍지만, 로딩 스피너·전송 버튼 비활성화의 재료다(스무고개 과제의 타이핑 인디케이터가 이것).

> 📘 공식 문서 보강 — 툴 파트의 `state` 전체 목록: `input-streaming` → `input-available` → (`approval-requested` → `approval-responded`) → `output-available` | `output-error` | `output-denied`. 괄호 안은 4.6 승인 흐름에서만 나온다. 툴 이름을 배포 시점에 모르는 경우(런타임에 로드되는 MCP 툴 등)는 `type: "dynamic-tool"` 파트로 오며 `isToolUIPart`가 이것도 잡는다.

---

## 7. 4.5 Browser Tools — 브라우저에서 실행되는 툴

위치, 카메라, 클립보드, 현재 페이지 조작처럼 **브라우저에만 있는 능력**을 모델에게 주는 방법이다. 강사는 "고객지원 에이전트가 사용자 대신 페이지를 넘기고 파일을 올리는" 그림을 그렸다.

### 서버 — `execute`만 빼면 된다

```ts
export const getLocation = tool({
  title: "getLocation",
  description: "Use this to get the user location",
  inputSchema: z.object({}),     // 입력 없음도 빈 객체로 명시
  // execute 없음!
});
```

`tools: { getWeather, getLocation }`로 등록은 똑같이 서버에서 한다. **`execute`가 없다는 것 자체가 신호**다 — AI SDK는 "서버가 실행 못 하는 툴"이라 보고 tool call만 프론트로 내려보낸 뒤 결과를 기다린다. 모델은 툴이 어디서 실행되는지 모른다(이름·설명·스키마만 본다).

### 프론트 — `onToolCall` + `addToolOutput`

```tsx
const { messages, sendMessage, … } = useAgentChat({
  agent,
  onToolCall: async ({ toolCall, addToolOutput }) => {
    if (toolCall.toolName === "getLocation") {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject),
      );
      addToolOutput({ toolCallId: toolCall.toolCallId, output: position.toJSON() });
    }
  },
});
```

네 단계로 읽는다.

1. **`onToolCall`이 불린다** — 서버가 `execute` 없는 툴의 호출을 내려보낼 때. 인자로 `toolCall`(`toolCallId`, `toolName`, `input`)과 `addToolOutput` 함수가 온다. 강사는 먼저 `console.log(toolCall)`만 해서 이 모양을 보여 줬다.
2. **이름으로 분기** — 브라우저 툴이 여러 개일 수 있으므로 `toolCall.toolName === "getLocation"`.
3. **브라우저 API 실행** — `navigator.geolocation.getCurrentPosition(success, error)`는 오래된 콜백 방식 API라 `new Promise`로 감싸 `await` 할 수 있게 했다. `resolve`가 성공 콜백, `reject`가 실패 콜백 자리에 들어간다. **이 부분은 순수 JavaScript**(React·Cloudflare·AI SDK 무관).
4. **`addToolOutput({ toolCallId, output })`** — 결과를 서버(→ 모델)로 돌려준다. 결과가 도착하면 서버가 **자동으로** 모델 호출을 이어 가고, 모델이 좌표를 보고 "당신의 시간대는 …"이라 답한다. `sendMessage`를 다시 부를 필요가 없다.

**`toolCallId`가 왜 필요한가** — 모델은 여러 툴을 병렬로, 같은 툴을 다른 인자로 여러 번 부를 수 있다. 각 호출은 "요청 ID"를 받고, 결과를 돌려줄 때 그 ID를 붙여야 모델이 "어느 요청의 결과"인지 짝지을 수 있다. 서버 툴에서는 SDK가 알아서 하지만, 브라우저 툴은 우리가 결과를 돌려주므로 직접 붙인다.

> 📘 공식 문서 보강 — `navigator.geolocation`은 **보안 컨텍스트(HTTPS 또는 localhost)** 에서만 동작하고, 사용자에게 권한 프롬프트가 뜬다. 거부하면 `reject` → `onToolCall`이 throw 되고 결과가 안 돌아가 대화가 멈추므로, 실전에서는 `try/catch`로 잡아 `addToolOutput({ …, output: { error: "denied" } })`처럼 실패도 결과로 돌려주는 편이 낫다. `GeolocationPosition`은 일반 객체가 아니라 `JSON.stringify`하면 `{}`가 되므로 `toJSON()`으로 `coords`·`timestamp`를 꺼내 보낸 것이다. 자동 재개는 `useAgentChat`의 `autoContinueAfterToolResult`(기본 `true`) 옵션이 담당하며, `false`로 두면 결과 후 직접 `sendMessage`를 불러야 한다. `useAgentChat({ tools })`로 서버가 모르는 툴을 클라이언트가 동적으로 등록하는 방식도 있지만(JSON Schema 필요), 문서는 "대부분의 앱은 서버 `tool()` + `onToolCall`"을 권한다.

---

## 8. 4.6 Tool Approvals — 승인 후 실행되는 툴 (+ 응답 중단)

### 먼저 — Stop 버튼과 `abortSignal`

ChatGPT·Claude처럼 답변 도중 멈추는 버튼. 프론트는 한 줄, 서버는 시그니처 복원이다.

```tsx
const { …, stop } = useAgentChat({ agent, … });
<button onClick={stop}>Stop</button>
```

```ts
async onChatMessage(
  _onFinish: StreamTextOnFinishCallback<ToolSet>,
  options?: { abortSignal?: AbortSignal },
) {
  const result = streamText({
    …,
    abortSignal: options?.abortSignal,   // 이걸 안 넘기면 화면만 멈춘다
  });
}
```

- 4.1에서 생략했던 `onChatMessage`의 인자를 되살렸다. 첫 인자 `onFinish`는 안 쓰므로 `_onFinish`(밑줄 = "의도적으로 안 씀"), 둘째 `options`에 **`abortSignal`** 이 들어 있다.
- **`abortSignal`을 `streamText`에 넘겨야 실제로 끊긴다.** 안 넘기면 프론트는 멈춘 것처럼 보이지만 서버는 끝까지 토큰을 생성한다(= 비용). 4.6 메모 "abort signal 받아야 함"이 이 지점이다.
- 타입: 강사는 처음 `unknown`으로 두었다가 라이브러리가 요구하는 `StreamTextOnFinishCallback<ToolSet>`을 import해 맞췄다. 부모 클래스 메서드를 오버라이드할 때는 시그니처가 호환돼야 TS가 통과한다. 강사 코드는 `options.abortSignal`인데 `options`가 optional이라 우리 코드는 `options?.abortSignal`로 썼다.

> 📘 공식 문서 보강 — `AbortSignal`은 **브라우저/Web 표준**(fetch 취소에 쓰는 그것)이고 AI SDK가 같은 규격을 받는다. `options`에는 `abortSignal` 외에 `requestId`(이 턴의 ID)와 `tools`(클라이언트가 동적으로 등록한 툴 스키마)도 있다. 중단된 스트림도 그때까지의 조각은 저장되며, `streamText`의 `onAbort` 콜백으로 중단 시점을 잡을 수 있다.

### 승인이 필요한 툴 — `needsApproval`

```ts
export const buyPlaneTicket = tool({
  title: "BuyPlaneTicket",
  description: "Use this when the user asks you to buy a ticket.",
  inputSchema: z.object({
    ticketCode: z.string().meta({ description: "The ticket code that you want to buy" }),
    price: z.number().meta({ description: "The price of the ticket" }),
  }),
  execute: async ({ price, ticketCode }) => `Ticket #${ticketCode} bought for ${price}`,
  needsApproval: ({ price }) => price > 200,   // ← 이 한 줄
});
```

| `needsApproval` | 동작 |
|---|---|
| `true` | 항상 사용자 승인 요구 |
| `(input) => boolean` | **모델이 채운 입력**을 보고 조건부 — 200달러 초과만 |
| 없음 | 승인 없이 바로 실행 (4.4까지의 툴들) |

시연 흐름: `getTickets`(가짜 항공권 3개, $342/$289/$195 — 결과가 **객체 배열**)로 검색 → "제일 싼 것 사 줘" → $195는 조건 미달이라 **그냥 산다** → "제일 비싼 것" → $342는 **Approve/Reject 카드**가 뜬다 → Reject하면 "거부됨", "다시 해 봐"하면 다시 카드 → Approve → 구매 완료.

중간 사고: `buyPlaneTicket`의 `execute`에 `return`을 빼먹자 모델이 이 툴을 **브라우저 툴로 취급**해 대화가 멈췄다 — 4.5에서 배운 "`execute`(결과)의 유무 = 실행 위치 결정"이 그대로 적용된 것이다.

### 승인 UI — `approval-requested` / `output-denied` / `addToolApprovalResponse`

```tsx
const { …, addToolApprovalResponse } = useAgentChat({ … });

if (isToolUIPart(part)) {
  if ("approval" in part && part.state === "approval-requested") {
    return (
      <div>
        Approve {getToolName(part)}? <pre>{JSON.stringify(part.input)}</pre>
        <button onClick={() => addToolApprovalResponse({ id: part.approval.id, approved: true })}>Approve</button>
        <button onClick={() => addToolApprovalResponse({ id: part.approval.id, approved: false })}>Reject</button>
      </div>
    );
  }
  if (part.state === "output-denied") return <div>{getToolName(part)} — Rejected</div>;
  … // 4.4의 일반 툴 카드
}
```

- 승인이 필요한 호출은 `execute`가 실행되지 않은 채 **`state: "approval-requested"`** 파트로 내려온다. `part.approval.id`가 이 승인 요청의 ID다. `"approval" in part`로 좁혀야 TS가 `approval` 필드를 허용한다(state마다 파트 모양이 다른 유니언 타입).
- **`addToolApprovalResponse({ id, approved })`** — 4.5의 `addToolOutput`과 같은 계열이다. 4.5는 "결과"를, 여기서는 "결정"을 서버로 돌려준다. `approved: true`면 서버가 `execute`를 실행하고 모델 호출을 재개, `false`면 파트가 **`output-denied`** 가 되고 모델은 거부됐음을 전달받아 답한다.
- 강사 말대로 "UI는 버튼 두 개가 함수 하나를 부르는 것뿐"이다 — 승인 대기·재개·거부 전달은 전부 라이브러리가 한다.

> 📘 공식 문서 보강 — 승인은 실행을 "일시정지"하는 것이 아니다. 모델 호출은 `approval-requested`에서 **한 번 끝나고**, 결정이 오면 그 결정이 메시지에 기록된 채 **새 호출**이 시작된다(AIChatAgent가 이 재호출을 같은 assistant 메시지에 이어 붙인다). 그래서 승인 대기 중에 새로고침해도 카드가 그대로 복원된다. 파트 상태 흐름은 `approval-requested` → `approval-responded` → `output-available`(승인) 또는 `output-denied`(거부). 승인 결정은 서버가 검증하므로 프론트에서 `approved: true`를 조작해도 `needsApproval` 자체를 우회할 수는 없다 — 다만 이 예제는 **누가 승인하는지**를 구분하지 않으므로(모든 탭이 같은 인스턴스), 실서비스에서는 3.5의 인증과 결합해야 한다.

---

## 9. 4.7 Sanitize Message — 저장 직전에 메시지 다듬기

기본적으로 `sendMessage`로 보낸 메시지와 모델 응답은 **즉시 그대로** 저장된다. 저장본을 바꾸고 싶으면(이메일 마스킹, 비밀 정보 제거, 거대한 툴 출력 잘라내기) 메서드 하나를 오버라이드한다.

```ts
sanitizeMessageForPersistence(message: UIMessage): UIMessage {
  return {
    ...message,
    parts: message.parts.map((part) => {
      if (part.type === "text") {
        return { ...part, text: part.text.replace("food", "❌ stop eating u fat ❌") };
      }
      return part;
    }),
  };
}
```

- 메시지가 SQLite에 쓰이기 **직전에** 하나씩 이 메서드를 거친다. 규칙은 하나 — **반드시 `UIMessage`를 반환**한다(수정했든 안 했든).
- 메시지는 `parts` 배열이므로 `map`으로 돌면서 `text` 파트만 고치고 나머지(reasoning, tool-*)는 그대로 돌려준다. 스프레드(`...message`, `...part`)로 **복사본**을 만드는 것은 원본을 제자리에서 고치지 않는 JS 관례다.
- 시연: "spicy food에 대해 알려 줘" → 화면에는 원문이 흐르지만 **새로고침**하면 히스토리에 치환된 문장이 보인다. 즉 스트림은 그대로이고 저장본만 바뀐다.
- 이름 주의: 녹취는 "sanitizeMessageForPersistent"로 들리지만 실제 메서드는 **`sanitizeMessageForPersistence`** 다. 강의 중 `message.data.parts`라고 했다가 고친 것도 `message.parts`가 맞다.
- `replace("food", …)`는 **첫 번째** 일치만 바꾼다. 전부 바꾸려면 `replaceAll` 또는 정규식 `/food/g`.

> 📘 공식 문서 보강 — 이 훅은 라이브러리의 **자체 정리 뒤에** 실행된다. 라이브러리가 먼저 ① OpenAI Responses API가 붙이는 일회성 `itemId`·암호화된 reasoning 메타데이터 제거(저장했다 다시 보내면 OpenAI가 중복 ID로 거부하기 때문), ② 공급자가 서버에서 실행한 툴(코드 실행 등)의 200KB급 입출력 잘라내기, ③ 텍스트도 메타데이터도 없는 빈 reasoning 파트 삭제를 하고, 그다음 우리 훅을 부른다. 강의 마지막에 "Anthropic·OpenAI 공급자별 메타데이터 정리"라고 한 것이 이것이다. 저장 **개수**를 제한하려면 클래스 속성 `maxPersistedMessages = 100`처럼 두면 오래된 것부터 지워진다.

---

## 10. 실습 코드 뜯어보기 (`ai-chat-agent-foundations/`, 4.7 기준)

### worker/tools.ts

| 툴 | `execute` | `needsApproval` | 실행 위치 | 배우는 것 |
|---|---|---|---|---|
| `getWeather` | 있음 | 없음 | 서버 | 툴의 기본 형태, zod 스키마 |
| `getLocation` | **없음** | 없음 | **브라우저** | `execute` 유무 = 실행 위치 |
| `getTickets` | 있음 (배열 반환) | 없음 | 서버 | 툴 결과가 다음 툴의 입력이 됨 |
| `buyPlaneTicket` | 있음 | `price > 200` | 서버 (승인 후) | 조건부 승인 |

### worker/index.ts — 4.0~4.3 골격

| 코드 | 하는 일 | 왜 이렇게 |
|---|---|---|
| `import { AIChatAgent } from "@cloudflare/ai-chat"` | 채팅 특화 Agent 클래스 | `agents`가 아닌 별도 패키지 (§1 📘) |
| `import { routeAgentRequest } from "agents"` | URL → DO 라우팅 | Section 3과 동일 |
| `import { createWorkersAI } from "workers-ai-provider"` | Cloudflare 모델용 provider | AI SDK ↔ Workers AI 연결 부품 |
| `class PotatoChatAgent extends AIChatAgent<Env>` | 에이전트 정의 | 클래스명 = DO 바인딩명 = 프론트 `agent` 이름 |
| `createWorkersAI({ binding: this.env.AI })` | 모델 공급자 연결 | AI 바인딩은 항상 원격·과금 (§2 📘) |
| `streamText({ model, messages, … })` | 모델 호출(스트림) | await 없음 — 첫 토큰부터 흘리기 위해 |
| `await convertToModelMessages(this.messages)` | 저장 형식 → 모델 형식 | `id` 제거, 대화 전체 전달 = "기억" |
| `return result.toUIMessageStreamResponse()` | 스트림 응답 | 프론트 무수정으로 스트리밍 + 파트 구분 |
| `(await routeAgentRequest(request, env)) ?? 404` | 라우팅 + 폴백 | `Promise<Response \| null>`이라 **await가 있어야 `??`가 의미 있다** (강사 코드는 await 없음 → 404 분기가 죽은 코드) |

### worker/index.ts — 4.3 이후 추가된 줄

| 코드 | 하는 일 | 왜 이렇게 |
|---|---|---|
| `import { …, isLoopFinished, type StreamTextOnFinishCallback, type ToolSet, type UIMessage } from "ai"` | 4.4~4.7 추가 import | `type` import는 런타임에 사라진다 |
| `import { buyPlaneTicket, getLocation, getTickets, getWeather } from "./tools"` | 툴 4개 | 인라인 대신 분리 |
| `async onChatMessage(_onFinish, options?)` | 시그니처 복원 | `options.abortSignal`을 받기 위해. `_` = 안 쓰는 인자 |
| `tools: { getWeather, getLocation, getTickets, buyPlaneTicket }` | 모델에 툴 제공 | 키가 모델이 부르는 이름 |
| `abortSignal: options?.abortSignal` | Stop 버튼 연결 | 안 넘기면 서버는 계속 생성 |
| `stopWhen: isLoopFinished()` | 멈춤 조건 | 기본 `stepCountIs(1)`이면 툴만 부르고 끝. 실서비스는 `stepCountIs`와 배열로 |
| `sanitizeMessageForPersistence(message)` | 저장 직전 훅 | 반드시 메시지 반환 |

### src/App.tsx — 데이터 흐름

```
useAgent({ agent: "PotatoChatAgent" })
  └ useAgentChat({ agent, onToolCall })                 ← 4.5: 브라우저 툴 실행
      ├ messages / sendMessage / clearHistory
      ├ status  (4.4)   stop (4.6)   addToolApprovalResponse (4.6)
      └ messages.map → renderMessage(message) → parts.map
            ├ text → <p>          reasoning → <p italic>
            └ isToolUIPart(part)
                  ├ approval-requested → Approve / Reject 버튼 (4.6)
                  ├ output-denied      → "Rejected" (4.6)
                  └ 그 외 → 이름 + state + input + output 카드 (4.4)
```

### 강사 코드와 다른 점 (우리 프로젝트의 선택)

- 4.3에서 안 쓰는 `generateText` import 제거(`noUnusedLocals` 때문에 남기면 `tsc -b` 실패), `streamText` 앞 `await` 제거, `routeAgentRequest`에 `await`.
- 4.6의 `options.abortSignal` → `options?.abortSignal` (optional 인자라 strict 모드에서 안전).
- `vite.config.ts`의 `agents/vite`·Tailwind 플러그인은 이전 과제부터 있었고, 4.4에서 강사도 같은 구성(`agents(), react(), tailwindcss(), cloudflare()`)으로 맞췄다 — 이제 차이가 아니다.

### 왜 이 코드가 학습용 예제인가 (한계)

- `getWeather`는 항상 "sunny" — 진짜 API 호출(`fetch`)로 바꾸는 순간 실제 에이전트가 된다. 다만 `execute` 안의 `fetch`도 Worker의 서브리퀘스트 한도에 든다.
- `isLoopFinished()`만 두면 모델이 툴을 무한히 부를 수 있다. `stepCountIs`를 함께 두는 것이 안전하다.
- 브라우저 툴의 실패(권한 거부)를 처리하지 않는다 → 대화가 멈춘다.
- 승인자를 구분하지 않는다 — 같은 인스턴스를 보는 누구나 Approve를 누를 수 있다.
- `sanitizeMessageForPersistence`의 치환은 데모용이다. 실전 용도는 PII 마스킹·거대 출력 절단.

---

## 11. 핵심 요약

1. **툴 = 모델이 호출을 "요청"하는 함수.** 모델은 이름·`description`·`inputSchema`만 보고 판단하고, 실행은 우리가 한다. `tool()` + zod로 정의하고 `streamText({ tools })`로 넘긴다.
2. **zod의 세 역할** — 모델에게 보낼 입력 형식(JSON Schema로 변환), 모델 출력의 런타임 검증, `execute` 인자의 타입 추론.
3. **스텝과 `stopWhen`.** "툴 호출 + 결과 회신"이 1스텝. 기본값 `stepCountIs(1)`이라 툴만 부르고 답을 안 한다 → `stepCountIs(N)` / `hasToolCall` / `isLoopFinished()` / 배열. `isLoopFinished()`만 두면 무한 루프 위험. 📘
4. **`execute`가 없으면 브라우저 툴.** 서버는 tool call만 내려보내고, 프론트 `onToolCall`이 실행해 `addToolOutput({ toolCallId, output })`으로 돌려주면 서버가 자동으로 이어 간다. `toolCallId`는 병렬·중복 호출의 요청-응답을 짝짓는 ID.
5. **`needsApproval: true | (input) => boolean`.** 승인 대기 파트는 `approval-requested`, 프론트가 `addToolApprovalResponse({ id: part.approval.id, approved })`로 결정을 보낸다. 거부는 `output-denied`. 승인은 일시정지가 아니라 "한 번 끝나고 새 호출". 📘
6. **Stop = `stop()` + `options.abortSignal`을 `streamText`에 전달.** 안 넘기면 화면만 멈추고 서버는 계속 토큰을 만든다.
7. **`sanitizeMessageForPersistence`** — 저장 직전 훅, 반드시 메시지 반환. 라이브러리의 자체 정리(OpenAI 메타데이터, 거대 툴 출력, 빈 reasoning) 뒤에 실행된다. 📘
8. **파트 상태 목록**: `input-streaming` → `input-available` → (`approval-requested` → `approval-responded`) → `output-available` | `output-error` | `output-denied`. UI는 이 상태를 보고 그린다. 📘

---

## 12. 다음 섹션 미리보기

- **5.x Email** — 지금은 입력창으로만 말을 건다. 에이전트에 **이메일을 보내면** 받아서 처리하고 답장까지 보내는 방법(Cloudflare Email Routing + `onEmail`). 결국 `sendMessage` 대신 다른 입구로 `this.messages`에 메시지를 넣는 것이다.
- **Webhook** — UI 없이 **URL을 호출**해 응답을 트리거한다. 데모에서 본 "외부 이벤트로 에이전트 깨우기".
- 이 섹션 전체를 돌아보면 `PotatoChatAgent`에 직접 쓴 메서드는 `onChatMessage`와 `sanitizeMessageForPersistence` 둘뿐이다. 툴 호출·승인·중단·저장·브로드캐스트는 전부 라이브러리가 했다 — 강사가 "코드를 거의 안 쓰고 이만큼 만들었다"고 한 이유다.

---

## 부록 — 헷갈렸던 것 Q&A

**Q. AI는 언제 추가된 거지? 뭘 해서 바인딩된 거지?** (4.1 녹화 메모)
A. **4.0 셋업 회차**에서 wrangler.jsonc에 `"ai": { "binding": "AI" }`를 넣고 `npm run cf-typegen`을 돌린 순간이다. 강사가 "다음 영상에서 설명하겠다"며 DO 바인딩과 함께 미리 넣어 두었기 때문에 4.1에서 갑자기 나타난 것처럼 보인다. 바인딩이 하는 일은 `Env` 객체에 `AI`라는 속성을 만들어 주는 것이고(KV 바인딩이 `env.CLAW_KV`를 만들던 것과 같은 메커니즘), 실제로 쓰는 건 4.2의 `createWorkersAI({ binding: this.env.AI })`가 처음이다. 4.1에서는 있기만 하고 안 썼다.

**Q. zod의 용도?** (4.5 녹화 메모)
A. §6의 "zod가 하는 일 세 가지" — ① 모델에게 보낼 입력 형식 설명(JSON Schema로 변환) ② 모델이 보낸 인자의 런타임 검증 ③ `execute` 인자의 TS 타입 추론. 4.0에서 설치만 해 둔 이유는 4.4의 툴이 첫 사용처였기 때문이다. zod 자체는 AI와 무관한 범용 검증 라이브러리라 폼 입력·API 응답 검증에도 널리 쓰인다. 브라우저 콘솔 실험은 안 되지만 워커에서 한 줄: `z.object({ city: z.string() }).parse({ city: 1 })` → 에러(숫자는 string이 아님).

**Q. abort signal 받아야 함** (4.6 녹화 메모)
A. §8의 Stop 부분. 두 군데를 맞춰야 한다 — ① `onChatMessage(_onFinish, options?)`로 시그니처를 되살려 `options.abortSignal`을 받고, ② 그것을 `streamText({ abortSignal })`에 넘긴다. 프론트의 `stop()`은 이 신호를 abort 시키는 것뿐이라 ②가 빠지면 서버는 끝까지 돈다. 우리 코드는 `options?.abortSignal`(optional chaining)로 썼다.

**Q. `streamText`는 왜 await를 안 하나? await를 붙이면 안 되나?**
A. `streamText`는 Promise가 아니라 `StreamTextResult` 객체를 **즉시** 돌려준다(`generateText`는 `Promise<GenerateTextResult>`). Promise가 아닌 값을 await 하면 그 값이 그대로 나오므로 붙여도 깨지지는 않지만, "여기서 기다린다"는 잘못된 인상을 준다. 스트리밍의 핵심이 "기다리지 않는 것"이므로 관례대로 뺀다.

**Q. `agents/ai-react`와 `@cloudflare/ai-chat/react` 중 뭘 써야 하나?**
A. 둘 다 같은 것이다 — 전자가 후자를 재export한다. 강의 시점 코드는 전자, 강사의 최신 템플릿은 후자. 새로 쓰는 코드는 후자를 권한다.

**Q. 툴을 서버에 등록했는데 왜 브라우저에서 실행되지?**
A. `execute`가 없기 때문이다. 등록 위치가 아니라 **`execute`의 유무**가 실행 위치를 정한다. 4.6에서 `return`을 빼먹은 `buyPlaneTicket`이 브라우저 툴처럼 굴어 대화가 멈춘 것도 같은 원리(결과가 안 돌아오니 SDK가 클라이언트 결과를 기다림).

**Q. 이건 어디 문법?** (초보용 구분)

| 코드 | 어디 것 |
|---|---|
| `new FormData(form)`, `form.reset()` | 브라우저 표준 Web API |
| `navigator.geolocation.getCurrentPosition(ok, err)` | 브라우저 표준 Web API (보안 컨텍스트 필요) |
| `new Promise((resolve, reject) => …)`, `position.toJSON()` | JS 기본 (콜백 → Promise 변환 관용구) |
| `AbortSignal` | Web 표준 (fetch 취소용) — AI SDK가 같은 규격을 받음 |
| `{ ...message, parts: … }`, `_onFinish`, `options?.x`, `replace` vs `replaceAll` | JS 기본 (스프레드, 밑줄 관례, optional chaining) |
| `React.SyntheticEvent<HTMLFormElement>` | React 타입 |
| `satisfies ExportedHandler<Env>`, `import { type X }`, `"approval" in part` | TypeScript 문법 (satisfies, type-only import, in 타입 좁히기) |
| `z.object`, `z.string().meta()` | zod (범용 검증 라이브러리, zod 4) |
| `tool()`, `inputSchema`, `execute`, `needsApproval`, `stopWhen`, `stepCountIs`, `isLoopFinished`, `isToolUIPart`, `getToolName`, `UIMessage` | AI SDK(`ai`) 규격 |
| `AIChatAgent`, `onChatMessage(onFinish, options)`, `sanitizeMessageForPersistence`, `useAgentChat`, `onToolCall`, `addToolOutput`, `addToolApprovalResponse`, `stop`, `status` | Cloudflare `@cloudflare/ai-chat` (일부는 AI SDK `useChat`을 감싼 것) |
| `this.env.AI`, `"ai": { "binding" }` | Cloudflare Workers 바인딩 |
