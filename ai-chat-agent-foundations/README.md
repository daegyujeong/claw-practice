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

## 실습 코드 흐름 (4.3 기준)

```
브라우저                                  워커                          PotatoChatAgent (DO)
useAgent ──WS──▶ routeAgentRequest ────────────────────────────▶ (연결, 저장된 messages 복원 → useAgentChat.messages)
useAgentChat
   ├─ sendMessage({ text }) ──────────────────────────────────▶ user 메시지 저장 → onChatMessage()
   │                                                              createWorkersAI(env.AI)
   │                                                              convertToModelMessages(this.messages)
   │                                                              streamText(model, messages)  ── 원격 GPU ─▶ glm-4.7-flash
   ◀── reasoning-delta / text-delta 조각 (전 탭 브로드캐스트) ◀── toUIMessageStreamResponse()
   │        └ messages[].parts 가 조각조각 채워짐 → 화면 갱신          조각 저장 → 완료 시 assistant 메시지 확정
   └─ clearHistory() ─────────────────────────────────────────▶ 저장소 비움 + 브로드캐스트
```

## 커밋 로드맵

- [x] 4.0 Introduction — 프로젝트 생성, 5개 패키지 설치, `PotatoChatAgent extends AIChatAgent<Env>`, DO 바인딩/마이그레이션 + AI 바인딩, 프론트 보일러플레이트 정리
- [x] 4.1 AIChatAgent — `useAgent` + `useAgentChat(messages, sendMessage)`, `onChatMessage` 오버라이드("hello"), `this.messages`와 parts 구조 확인
- [x] 4.2 generateText — `createWorkersAI(env.AI)`, `convertToModelMessages`, `generateText` 응답, `clearHistory` 버튼
- [x] 4.3 streamText — `streamText` + `toUIMessageStreamResponse`, reasoning 파트 렌더
- [x] 과제 (Practice #6) — Who Am I? 스무고개 (`../agent-guess-game-practice/`)
- [ ] 4.4 Tools — `tool()` + zod로 모델이 호출하는 함수 정의
- [ ] 4.5 Browser Tools — 클라이언트에서 실행되는 도구
- [ ] 4.6 Tool Approvals — 승인 후 실행되는 도구
- [ ] 4.7 Sanitize Message — 저장 전 메시지 정리 훅
- 다음 섹션: 이메일로 에이전트와 대화하기 (5.x Email)

강사 코드와 다른 점: `vite.config.ts`의 `agents/vite`·Tailwind 플러그인(이전 과제 설정을 이어 온 것, 이번 범위에는 불필요), `routeAgentRequest`에 `await`를 둔 것(강사 코드는 await 없이 `?? 404`라서 404 분기가 죽은 코드), 4.3에서 안 쓰는 `generateText` import를 제거한 것(`noUnusedLocals` 때문에 남기면 `tsc -b` 실패).
