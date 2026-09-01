# Practice #6 — Who Am I? (스무고개)

> Nomad Coders 「모두를 위한 OpenClaw」 과제. Section 4(4.1 AIChatAgent · 4.2 generateText ·
> 4.3 streamText)에서 배운 것으로, **에이전트가 몰래 정한 정체를 사용자가 맞히는 게임**을 만든다.
> 카테고리는 **나라**, 후보는 20개.

## 무엇을 만들었나

에이전트가 나라 20개 중 하나를 무작위로 골라 그 나라인 척 연기한다.
사용자는 질문을 던져 정체를 좁혀 나가고, 나라 이름을 맞히면 게임이 끝난다.

| 요구사항 | 구현 위치 |
|---|---|
| `AIChatAgent` 상속 + `onChatMessage` 구현 | `worker/index.ts` — `GuessGameAgent` |
| `createWorkersAI` + `@cf/zai-org/glm-4.7-flash` + `streamText` | `onChatMessage` |
| 상태 `{ secret, solved, questionCount }` | `GuessGameState`, `initialState` |
| `secret`은 내 코드가 무작위 선택 | `pickRandomCountry()` (`worker/countries.ts`) |
| 시스템 프롬프트에 `secret` + "밝히지 말 것", 매 턴 재생성 | `buildSystemPrompt()` |
| 정답 판정은 내 코드가 대소문자 무시 대조 | `findGuessedCountry()` + `onChatMessage` 1단계 |
| `@callable()` `newGame()` | `GuessGameAgent.newGame()` |
| 프론트는 `useAgentChat` | `src/App.tsx` |

## 한 턴에 일어나는 일

```
사용자가 질문 전송
  → AIChatAgent가 메시지를 저장하고 onChatMessage() 호출
  → ① 내 코드: 마지막 사용자 메시지 ↔ state.secret 대조
        questionCount + 1, 맞았으면 solved = true → setState (모든 탭에 브로드캐스트)
  → ② 내 코드: solved 여부에 맞는 시스템 프롬프트를 새로 생성
  → ③ streamText(model, system, 지금까지의 대화 전부)
  → 토큰이 생기는 대로 화면에 스트리밍
```

정답 여부를 모델에게 묻지 않는 것이 핵심이다. 모델은 "연기"만, 판정은 코드가 한다.

## 정답 판정을 단순 `includes`로 하면 안 되는 이유

`worker/countries.ts` 참고. `"인도네시아인가요?"` 안에는 `"인도"`가, `"한국어로 답해줘"` 안에는
`"한국"`이 들어 있다. 그래서 후보 이름 + 헷갈리는 이름(DECOY)을 한 표에 모아
**긴 이름부터** 검사하고, DECOY에 먼저 걸리면 추측하지 않은 것으로 본다.

## 알려진 한계 (학습용)

에이전트 `state`는 연결된 모든 클라이언트로 브로드캐스트된다. 즉 `state.secret`은
브라우저 개발자 도구에서 들여다볼 수 있다. 과제 요구사항이 "상태에 secret을 저장"이라
그대로 따랐고, 화면에는 `solved`가 되기 전까지 그리지 않는다.
진짜로 숨기려면 `secret`은 `this.sql`이나 스토리지에만 두고, 브로드캐스트되는 state에는
`{ solved, questionCount }`만 남기면 된다.

## 실행

```bash
npm install
npm run dev      # 로컬 (Workers AI 호출은 Cloudflare 계정 로그인 필요)
npm run deploy   # = tsc -b && vite build && wrangler deploy
```
