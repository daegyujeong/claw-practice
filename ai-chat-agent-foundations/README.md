# Section 4 — AI Chat Agent Foundations

> Nomad Coders 「Cloudflare Agents」 강의 4챕터 실습 프로젝트.
> Section 3의 Agent 클래스 위에 **AIChatAgent**를 얹어 진짜 AI 챗봇을 만든다. 메시지 저장·브로드캐스트·히스토리는 내장이고, 우리는 `onChatMessage` 하나만 구현한다.
> 회차 구성은 강의 코드 저장소(nomadcoders/nomadclaw)의 커밋 체계를 따른다: 4.0 Introduction → 4.1 AIChatAgent → 4.2 generateText → 4.3 streamText → 4.4 Tools → 4.5 Browser Tools → 4.6 Tool Approvals → 4.7 Sanitize Message.
> 개념 정리는 `../notes/section-04-ai-chat-agent.md`.

## 이 챕터에서 배운 것

### 1. AIChatAgent = Agent + 채팅 내장 (4.0)
`@cloudflare/ai-chat`의 `AIChatAgent`는 `Agent`를 상속하므로 state·@callable·SQL·broadcast·schedule이 전부 있고, 그 위에 메시지 저장(`cf_ai_chat_agent_messages` 테이블 자동 생성), 전 클라이언트 브로드캐스트, 새로고침 시 히스토리 복원, 스트리밍 전달, `clearHistory`가 얹혀 있다. 결국 DO라서 wrangler.jsonc의 DO 바인딩 + `new_sqlite_classes` 마이그레이션은 그대로 필요하고, 여기에 **AI 바인딩 `"ai": { "binding": "AI" }`** 를 추가한다. 설치 패키지는 `agents`, `@cloudflare/ai-chat`, `ai`(AI SDK — Vercel의 범용 라이브러리), `workers-ai-provider`(Cloudflare 모델용 어댑터), `zod`(4.4 툴 검증용).

### 2. onChatMessage와 자동 메시지 저장 (4.1 AIChatAgent)
프론트는 `useAgent({ agent })` → `useAgentChat({ agent })` 두 줄로 `messages`, `sendMessage`(+ `clearHistory`, `status` 등)를 얻는다. 서버는 `onChatMessage`를 반드시 오버라이드해야 하며(안 하면 첫 전송에서 에러), 불리는 시점에 방금 온 사용자 메시지는 이미 `this.messages` 맨 뒤에 저장돼 있다. 반환한 `Response`는 assistant 역할로 저장·브로드캐스트된다. 메시지는 AI SDK의 `UIMessage`(`id`, `role`, `parts[]`) 형식 — 문자열이 아니라 **조각 배열**이라서 프론트는 `parts.map`에서 `type`별로 그린다.

### 3. 모델에게 묻기 (4.2 generateText)
`createWorkersAI({ binding: this.env.AI })`로 공급자를 만들고, `convertToModelMessages(this.messages)`로 저장 형식(`id` 포함)을 모델 형식으로 바꾼 뒤, `generateText({ model: workersAi("@cf/zai-org/glm-4.7-flash"), messages })`의 `text`를 응답한다. 모델은 대화 전체를 매번 받으므로 "기억"하는 것처럼 보인다(= 토큰 비용의 원인). 모델 ID는 TS 자동완성보다 대시보드 카탈로그가 정확하다. AI 바인딩은 로컬에서도 항상 원격 호출이며 뉴런 단위 과금(하루 10,000 뉴런 무료).

### 4. 스트리밍과 reasoning (4.3 streamText)
`generateText`는 답을 다 쓸 때까지 아무것도 안 보여 준다. `streamText`(await 없음 — Promise가 아닌 `StreamTextResult`를 즉시 반환) + `result.toUIMessageStreamResponse()`로 바꾸면 **프론트 수정 없이** 글자 단위로 흐른다. 브로드캐스트·히스토리 복원도 스트림 조각 단위로 이미 된다. reasoning 모델은 답 전에 생각 과정을 `type: "reasoning"` 파트로 보내므로 `<em>`으로 구분해 그렸다. streamText의 에러는 throw 되지 않고 스트림 안으로 들어가므로 `onError` 콜백으로 잡는다.

### 5. 툴 = 모델이 호출을 요청하는 함수 (4.4 Tools)
`tool({ description, inputSchema: z.object(…), execute })`로 정의하고 `streamText({ tools: { getWeather } })`로 넘긴다. 모델은 이름·설명·스키마만 보고 "언제·어떤 인자로" 부를지 정하고, `execute`는 서버(DO)에서 실행된다. zod는 ① 모델에게 보낼 입력 형식 ② 모델 출력의 런타임 검증 ③ `execute` 인자 타입 추론을 맡는다. **"툴 호출 + 결과 회신" = 1스텝**이고 `stopWhen` 기본값이 `stepCountIs(1)`이라 툴만 부르고 답을 안 한다 → `stepCountIs(N)` / `hasToolCall` / `isLoopFinished()` / 배열. 프론트는 `isToolUIPart`·`getToolName`으로 `tool-*` 파트(이름·`state`·`input`·`output`)를 그리고 `status`를 표시한다.

### 6. execute가 없으면 브라우저 툴 (4.5 Browser Tools)
`getLocation`처럼 `execute`를 빼면 서버는 tool call만 내려보내고, 프론트 `useAgentChat({ onToolCall })`이 `toolCall.toolName`으로 분기해 `navigator.geolocation`을 실행한 뒤 `addToolOutput({ toolCallId, output })`으로 돌려준다. `toolCallId`는 병렬·중복 호출의 요청-응답을 짝짓는 ID. 결과가 오면 서버가 자동으로 모델 호출을 이어 간다.

### 7. 승인 후 실행 + 응답 중단 (4.6 Tool Approvals)
`needsApproval: true | (input) => boolean`(`price > 200`)을 주면 호출이 `approval-requested` 파트로 멈추고, 프론트가 `addToolApprovalResponse({ id: part.approval.id, approved })`로 결정을 보낸다. 거부는 `output-denied`. 승인은 일시정지가 아니라 "한 번 끝나고 새 호출". Stop 버튼은 `stop()` + `onChatMessage(_onFinish, options?)`의 `options.abortSignal`을 `streamText`에 넘겨야 서버까지 실제로 멈춘다. `execute`에 `return`을 빼먹으면 모델이 브라우저 툴로 오해한다.

### 8. 저장 직전 훅 (4.7 Sanitize Message)
`sanitizeMessageForPersistence(message): UIMessage`를 오버라이드하면 SQLite에 쓰기 직전에 메시지를 바꿀 수 있다(반드시 반환). 화면 스트림은 그대로, 새로고침한 히스토리에만 반영. 라이브러리의 자체 정리(OpenAI 메타데이터·거대 툴 출력·빈 reasoning) 뒤에 실행된다.

## 명령어

| 명령어 | 역할 |
|---|---|
| `npm create cloudflare@latest ai-chat-agent-foundations` | Framework Starter → React → TypeScript로 생성 |
| `npm install agents @cloudflare/ai-chat ai zod workers-ai-provider` | Agent SDK + AIChatAgent + AI SDK + provider 설치 |
| `npm run cf-typegen` | 바인딩(AI, DO) 변경 후 `Env` 타입 재생성 |
| `npm run dev` | 로컬 개발 서버 (프론트+워커 동시, AI 호출은 원격) |
| `npx tsc -b` | 타입 체크 (app/worker/node 프로젝트 전부) |
| `npx eslint src worker` | 린트 |
| `npm run deploy` | 빌드 + 배포 |

## 실습 코드 흐름 (4.7 기준)

```
브라우저                                        워커 / PotatoChatAgent (DO)
useAgent ──WS──▶ routeAgentRequest ───────────▶ (연결, 저장된 messages 복원)
useAgentChat({ agent, onToolCall })
   ├─ sendMessage({ text }) ──────────────────▶ user 메시지 저장 → sanitizeMessageForPersistence → onChatMessage(_, { abortSignal })
   │                                              streamText({ model, messages, tools, abortSignal, stopWhen })
   │                                                 ├ 텍스트/reasoning ──── text-delta / reasoning-delta ──▶ (브로드캐스트)
   │                                                 ├ getWeather / getTickets  → execute (서버) → 결과 → 다음 스텝
   │                                                 ├ getLocation (execute 없음) ── tool call ──▶ onToolCall ─▶ addToolOutput ──▶ 자동 재개
   │                                                 └ buyPlaneTicket (needsApproval) ── approval-requested ──▶ Approve/Reject
   │                                                        ◀── addToolApprovalResponse ── 승인이면 execute, 거부면 output-denied
   ◀── 조각 반영: messages[].parts (text / reasoning / tool-* state) → renderMessage
   ├─ stop() ────── abort ─────────────────────▶ abortSignal → 모델 호출 중단
   └─ clearHistory() ─────────────────────────▶ 저장소 비움 + 브로드캐스트
                                                assistant 메시지 확정 → sanitizeMessageForPersistence → 저장
```

## 커밋 로드맵

- [x] 4.0 Introduction — 프로젝트 생성, 5개 패키지 설치, `PotatoChatAgent extends AIChatAgent<Env>`, DO 바인딩/마이그레이션 + AI 바인딩, 프론트 보일러플레이트 정리
- [x] 4.1 AIChatAgent — `useAgent` + `useAgentChat(messages, sendMessage)`, `onChatMessage` 오버라이드("hello"), `this.messages`와 parts 구조 확인
- [x] 4.2 generateText — `createWorkersAI(env.AI)`, `convertToModelMessages`, `generateText` 응답, `clearHistory` 버튼
- [x] 4.3 streamText — `streamText` + `toUIMessageStreamResponse`, reasoning 파트 렌더
- [x] 과제 (Practice #6) — Who Am I? 스무고개 (`../agent-guess-game-practice/`)
- [x] 4.4 Tools — `worker/tools.ts`의 `getWeather`(tool + zod), `streamText({ tools, stopWhen })`, Tailwind UI + `renderMessage`(tool 파트) + `status`
- [x] 4.5 Browser Tools — `execute` 없는 `getLocation`, `onToolCall`에서 geolocation 실행 → `addToolOutput`
- [x] 4.6 Tool Approvals — `getTickets` + `buyPlaneTicket(needsApproval)`, `approval-requested`/`output-denied` UI + `addToolApprovalResponse`, `stop()` ↔ `options.abortSignal`
- [x] 4.7 Sanitize Message — `sanitizeMessageForPersistence` 오버라이드
- 다음 섹션: 이메일·웹훅으로 에이전트와 대화하기 (5.x Email)

강사 코드와 다른 점: `routeAgentRequest`에 `await`를 둔 것(강사 코드는 await 없이 `?? 404`라서 404 분기가 죽은 코드), 4.3에서 안 쓰는 `generateText` import를 제거한 것(`noUnusedLocals` 때문에 남기면 `tsc -b` 실패), 4.6의 `options.abortSignal`을 `options?.abortSignal`로 쓴 것(optional 인자). `vite.config.ts`의 `agents/vite`·Tailwind 플러그인은 이전 과제부터 있었고 4.4에서 강사도 같은 구성으로 맞췄다.
