# Section 4 — AIChatAgent (4.0 ~ 4.3)

> Nomad Coders 「Cloudflare Agents」 강의 Section 4의 학습 노트다. 4.0(셋업)부터 4.3 streamText까지 정리했다. 4.4 Tools 이후는 강의를 들으면서 이 노트에 이어 붙인다.
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
─── 이어서: 4.4 Tools → 4.5 Browser Tools → 4.6 Tool Approvals → 4.7 Sanitize Message
```

핵심 줄거리: **"Section 3에서 손수 만들던 채팅방(메시지 테이블, INSERT, broadcast, loadHistory)을 AIChatAgent가 전부 내장하고 있고, 우리는 `onChatMessage` 하나만 구현하면 된다. 거기에 AI SDK 함수 한 개를 넣으면 진짜 AI 챗봇이 된다."** 세 회차에 걸쳐 바뀌는 코드는 사실상 `onChatMessage` 안의 몇 줄뿐이고, 그 몇 줄의 의미(메시지 형식 변환, 스트리밍)를 이해하는 것이 이 섹션의 목표다.

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

## 6. 실습 코드 뜯어보기 (`ai-chat-agent-foundations/`)

### worker/index.ts (4.3 기준)

| 코드 | 하는 일 | 왜 이렇게 |
|---|---|---|
| `import { AIChatAgent } from "@cloudflare/ai-chat"` | 채팅 특화 Agent 클래스 | `agents`가 아닌 별도 패키지 (§1 📘) |
| `import { routeAgentRequest } from "agents"` | URL → DO 라우팅 | Section 3과 동일 |
| `import { convertToModelMessages, streamText } from "ai"` | AI SDK 함수 | 4.2의 `generateText`는 이제 안 쓰므로 뺐다 — `tsconfig`의 `noUnusedLocals` 때문에 남겨 두면 `npx tsc -b`가 TS6133으로 실패한다(강사 4.3 코드에는 남아 있다). generateText 버전은 4.2 커밋에 있다 |
| `import { createWorkersAI } from "workers-ai-provider"` | Cloudflare 모델용 provider | AI SDK ↔ Workers AI 연결 부품 |
| `class PotatoChatAgent extends AIChatAgent<Env>` | 에이전트 정의 | 클래스명 = DO 바인딩명 = 프론트 `agent` 이름 |
| `async onChatMessage()` | 메시지 올 때마다 실행 | AIChatAgent의 유일한 필수 구현 |
| `createWorkersAI({ binding: this.env.AI })` | 모델 공급자 연결 | AI 바인딩은 항상 원격·과금 (§2 📘) |
| `streamText({ model, messages })` | 모델 호출(스트림) | await 없음 — 첫 토큰부터 흘리기 위해 |
| `workersAi("@cf/zai-org/glm-4.7-flash")` | 모델 선택 | 자동완성 목록보다 대시보드 ID가 정확 |
| `await convertToModelMessages(this.messages)` | 저장 형식 → 모델 형식 | `id` 제거, 대화 전체 전달 = "기억" |
| `return result.toUIMessageStreamResponse()` | 스트림 응답 | 프론트 무수정으로 스트리밍 + 파트 구분 |
| `(await routeAgentRequest(request, env)) ?? 404` | 라우팅 + 폴백 | `routeAgentRequest`는 `Promise<Response \| null>`을 반환하므로 **await가 있어야 `??`가 의미가 있다.** 강사 코드는 await 없이 `?? 404`를 쓰는데 Promise는 절대 null이 아니라서 404 분기가 죽은 코드다 — 우리 코드(await 있음) 쪽이 정확하다 |

### src/App.tsx (4.3 기준)

```
useAgent({ agent: "PotatoChatAgent" })          ← WebSocket 연결 (Section 3과 동일)
  └ useAgentChat({ agent })                     ← messages / sendMessage / clearHistory
      ├ <ul> messages.map → <li key=id>          ← role + parts.map(text → span, reasoning → em)
      ├ <form onSubmit>  FormData → sendMessage({ text }) → reset()
      └ <button onClick={clearHistory}>
```

### 강사 코드와 다른 점 (우리 프로젝트의 선택)

- `vite.config.ts`에 `agents/vite` 플러그인과 `@tailwindcss/vite`가 들어 있고 `index.css`가 Tailwind 한 줄이다 — Section 3 과제·스무고개 과제에서 쓰던 설정을 이어 온 것. 강의의 이번 범위에는 데코레이터도 Tailwind도 안 나오므로 없어도 된다.
- 위 표의 두 가지(`generateText` import 제거, `routeAgentRequest` await)와 `streamText` 앞 `await` 제거.

### 왜 이 코드가 학습용 예제인가 (한계)

- 시스템 프롬프트가 없다 — 모델이 "나는 AI 어시스턴트"라고 답하는 이유. 성격·규칙을 주려면 `streamText({ system: "…" })`(스무고개 과제에서 한 것).
- 에러 처리가 없다 — 모델 호출 실패가 스트림 안으로 조용히 들어간다(§5 📘).
- 사용자 구분이 없다 — 모든 탭이 같은 인스턴스(`default`)의 같은 대화를 본다. `useAgent({ name: … })`으로 인스턴스를 나누면 사용자별 대화가 된다(Section 3의 인스턴스 개념 그대로).
- `parts`를 두 종류만 그린다 — 4.4에서 툴 파트가 오면 화면에 아무것도 안 보이는 구간이 생긴다.

---

## 7. 핵심 요약

1. **AIChatAgent = Agent + 채팅 내장.** 메시지 저장·브로드캐스트·히스토리 복원·삭제가 들어 있고, 우리는 `onChatMessage` 하나만 구현한다. 결국 DO이므로 wrangler의 DO 바인딩·마이그레이션은 그대로.
2. **프론트는 `useAgent` → `useAgentChat` 두 줄.** `messages`, `sendMessage`, `clearHistory`(+ `status` 등)가 나오고 메시지 상태를 직접 관리하지 않는다.
3. **메시지는 `UIMessage` — `id`, `role`, `parts[]`.** 문자열이 아니라 조각 배열인 이유는 텍스트·reasoning·툴 호출 등 여러 종류가 섞이기 때문. 프론트는 `parts.map`에서 `type`별로 그린다.
4. **AI 바인딩(`"ai": { "binding": "AI" }`)** 한 줄로 Cloudflare의 모든 모델에 접근. 로컬에서도 항상 원격 호출이며 뉴런 단위로 과금(하루 10,000 뉴런 무료). 📘
5. **AI SDK(`ai`)는 Vercel의 범용 라이브러리**, `workers-ai-provider`가 Cloudflare 모델용 어댑터. `createWorkersAI(env.AI)` → `workersAi("모델ID")`가 `model` 자리에 들어간다.
6. **`convertToModelMessages`** 로 저장 형식을 모델 형식으로 바꿔 대화 전체를 넘긴다 — 이것이 "기억"의 정체이고 토큰 비용의 원인이다.
7. **`generateText`(await, 완성본) → `streamText`(await 없음, `toUIMessageStreamResponse`)** 로 바꾸면 프론트 수정 없이 스트리밍. 에러는 throw 되지 않고 스트림 안으로 들어가므로 `onError`로 잡는다. 📘

---

## 8. 다음 섹션 미리보기

- **4.4 Tools** — 지금 모델은 말만 한다. `tool()`과 **zod**(4.0에서 설치만 해 둔 그것)로 "모델이 호출할 수 있는 함수"를 정의하면 모델이 필요할 때 도구를 쓴다. 이때 `parts`에 `tool-…` 타입 조각이 나타나고, 지금의 `text`/`reasoning`만 그리는 UI가 비어 보이기 시작한다.
- **4.5 Browser Tools** — 도구가 브라우저(클라이언트) 쪽에서 실행되는 경우. `useAgentChat`의 `onToolCall`/`addToolOutput`.
- **4.6 Tool Approvals** — 위험한 도구는 사용자 승인 후 실행. `needsApproval`.
- **4.7 Sanitize Message** — 저장 전에 메시지를 다듬는 훅(Anthropic·OpenAI 공급자별 메타데이터 정리).

---

## 부록 — 헷갈렸던 것 Q&A

**Q. AI는 언제 추가된 거지? 뭘 해서 바인딩된 거지?** (4.1 녹화 메모)
A. **4.0 셋업 회차**에서 wrangler.jsonc에 `"ai": { "binding": "AI" }`를 넣고 `npm run cf-typegen`을 돌린 순간이다. 강사가 "다음 영상에서 설명하겠다"며 DO 바인딩과 함께 미리 넣어 두었기 때문에 4.1에서 갑자기 나타난 것처럼 보인다. 바인딩이 하는 일은 `Env` 객체에 `AI`라는 속성을 만들어 주는 것이고(KV 바인딩이 `env.CLAW_KV`를 만들던 것과 같은 메커니즘), 실제로 쓰는 건 4.2의 `createWorkersAI({ binding: this.env.AI })`가 처음이다. 4.1에서는 있기만 하고 안 썼다.

**Q. `streamText`는 왜 await를 안 하나? await를 붙이면 안 되나?**
A. `streamText`는 Promise가 아니라 `StreamTextResult` 객체를 **즉시** 돌려준다(`generateText`는 `Promise<GenerateTextResult>`). Promise가 아닌 값을 await 하면 그 값이 그대로 나오므로 붙여도 깨지지는 않지만, "여기서 기다린다"는 잘못된 인상을 준다. 스트리밍의 핵심이 "기다리지 않는 것"이므로 관례대로 뺀다.

**Q. `agents/ai-react`와 `@cloudflare/ai-chat/react` 중 뭘 써야 하나?**
A. 둘 다 같은 것이다 — 전자가 후자를 재export한다. 강의 시점 코드는 전자, 강사의 최신 템플릿은 후자. 새로 쓰는 코드는 후자를 권한다.

**Q. 이건 어디 문법?** (초보용 구분)

| 코드 | 어디 것 |
|---|---|
| `new FormData(form)`, `form.reset()` | 브라우저 표준 Web API |
| `React.SyntheticEvent<HTMLFormElement>` | React 타입 |
| `satisfies ExportedHandler<Env>` | TypeScript 문법 (`satisfies`) + Cloudflare 타입 |
| `part.type === "text" ? … : … ? … : null` | JS 삼항 연산자 중첩 |
| `message.parts`, `UIMessage`, `convertToModelMessages` | AI SDK(`ai`) 규격 |
| `AIChatAgent`, `onChatMessage`, `useAgentChat`, `clearHistory` | Cloudflare `@cloudflare/ai-chat` |
| `this.env.AI`, `"ai": { "binding" }` | Cloudflare Workers 바인딩 |
