# Agent 클래스 따라 만들기 (3.0 ~ 3.1)

> 강의를 다시 보지 않고도 처음부터 따라 만들 수 있도록, **순서대로 어디에 무엇을 쓰는지**만 모은 자료다. 개념 설명은 `section-03-agent-class.md`에 있다.
> 이름(`agent-foundations`, `ChattingRoomAgent`, `PingPongState`)은 이 저장소에서 실제로 쓴 것 그대로다. 진행 중 섹션이라 3.2부터는 이어서 추가한다.

---

## 전체 순서 한눈에

```
[터미널]  npm create cloudflare@latest agent-foundations     ① 뼈대 (Framework Starter → React → TS)
[터미널]  npm install agents                                  ② Agent SDK 설치
[worker/index.ts]  ChattingRoomAgent extends Agent            ③ 에이전트 클래스
[wrangler.jsonc]   DO 바인딩 + migrations                     ④ 연결 (Agent도 DO다!)
[src/]    보일러플레이트 삭제                                  ⑤ 프론트 비우기          ← 여기까지 3.0
[worker/index.ts]  initialState + setState 메서드              ⑥ 상태
[src/App.tsx]      useAgent 훅으로 연결                        ⑦ 프론트 구독
[worker/index.ts]  routeAgentRequest 라우팅                    ⑧ WebSocket 연결 완성
[터미널]  npx wrangler types && npx tsc -b && npm run dev      ⑨ 검증 + 확인            ← 여기까지 3.1
```

이전 챕터와 다른 점 두 가지: 템플릿이 **Hello World가 아니라 Framework Starter**(React 프론트가 같이 생긴다)이고, 검증이 `npx tsc --noEmit`이 아니라 **`npx tsc -b`**(프로젝트가 app/worker 여러 개로 쪼개져 있어서)다.

---

## ① 프로젝트 생성 (3.0)

```
npm create cloudflare@latest agent-foundations
```

선택지: **Framework Starter** → **React** → (platform은 Workers with Assets) → **TypeScript** → git **No** → deploy **No**.

생기는 구조 — Hello World 템플릿과 달리 둘로 나뉜다:

| 폴더 | 역할 |
|---|---|
| `src/` | Vite 기반 React 프론트엔드 |
| `worker/` | 워커 (진입점 `worker/index.ts`) |

체크포인트: `npm run dev` → 템플릿 환영 페이지가 뜨면 성공.

## ② Agent SDK 설치

```
npm install agents
```

이 패키지 하나에 백엔드용 `Agent` 클래스와 프론트엔드용 React 훅(`agents/react`)이 다 들어 있다.

## ③ 에이전트 클래스 (`worker/index.ts`)

기존 내용을 지우고:

```ts
import { Agent } from "agents";

export class ChattingRoomAgent extends Agent<Env> {}

export default {
  async fetch() {
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

지난 섹션의 `extends DurableObject` 자리에 `extends Agent`가 들어온 것.

## ④ DO 바인딩 + 마이그레이션 (`wrangler.jsonc`)

Agent도 결국 Durable Object라서 설정도 DO 그대로:

```jsonc
"durable_objects": {
  "bindings": [{ "name": "ChattingRoomAgent", "class_name": "ChattingRoomAgent" }]
},
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["ChattingRoomAgent"] }]
```

⚠️ **바인딩 `name`을 클래스 이름과 똑같이** 둘 것. 다르게 두면 나중에 `routeAgentRequest`가 에이전트를 못 찾아 "cannot find ChattingRoomAgent" 에러가 난다 (강사도 데모에서 겪음). 바꾼 뒤 `npx wrangler types`로 Env 타입 재생성.

## ⑤ 프론트 비우기

- 삭제: `src/assets/`, `src/App.css`, `src/index.css`
- `src/main.tsx`: CSS import 줄 삭제
- `src/App.tsx`: 빈 컴포넌트만 남기기 (`return <></>;`)

CSS는 코스 후반에 AI가 짜 줄 예정이라 지금은 안 만든다. **── 여기까지가 3.0.**

---

## ⑥ 상태 만들기 (3.1, `worker/index.ts`)

```ts
export type PingPongState = {   // export! 프론트가 가져다 쓴다
  pingPongCount: number;
};

export class ChattingRoomAgent extends Agent<Env, PingPongState> {
  initialState: PingPongState = { pingPongCount: 0 };

  increment() {
    this.setState({ pingPongCount: this.state.pingPongCount + 1 });
  }
  decrement() {
    this.setState({ pingPongCount: this.state.pingPongCount - 1 });
  }
}
```

- `setState`만 하면 내장 SQLite에 자동 저장 + 연결된 프론트 전원에게 브로드캐스트. 테이블 안 만든다.
- ⚠️ `initialState`는 **인스턴스 최초 생성 때 딱 한 번**. 값을 바꿔도 기존 인스턴스에는 적용 안 된다 (로컬에서 초기화하고 싶으면 `.wrangler/` 삭제).

## ⑦ 프론트에서 구독 (`src/App.tsx`)

```tsx
import { useState } from "react";
import { useAgent } from "agents/react";
import type { ChattingRoomAgent, PingPongState } from "../worker";

function App() {
  const [pingPongs, setPingPongs] = useState(0);
  const [isConnected, setIsConnected] = useState(false);

  const agent = useAgent<ChattingRoomAgent, PingPongState>({
    agent: "chatting-room-agent",          // 클래스 이름의 kebab-case
    onOpen() { setIsConnected(true); },
    onStateUpdate(state) { setPingPongs(state.pingPongCount); },
  });
  void agent;                              // 3.2에서 호출에 사용 (noUnusedLocals 회피)

  if (!isConnected) return <h1>Connecting...</h1>;

  return (
    <div>
      <h1>Ping Pong Agent</h1>
      <h3>Ping pong count: {pingPongs}</h3>
    </div>
  );
}

export default App;
```

훅이 마운트되면 `/agents/chatting-room-agent/<이름>`으로 WebSocket 업그레이드 요청을 **자동으로** 보낸다. API·fetch 코드가 없는 게 정상이다.

⚠️ 이 import 때문에 워커 파일이 프론트 컴파일에도 포함된다. `tsconfig.app.json`의 types에 워커 타입 파일을 추가해야 `Cannot find name 'Env'` 에러가 안 난다:

```jsonc
"types": ["vite/client", "./worker-configuration.d.ts"],
```

## ⑧ 워커 라우팅 완성 (`worker/index.ts`의 fetch 교체)

```ts
import { Agent, routeAgentRequest } from "agents";

export default {
  async fetch(request, env) {
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

훅이 보낸 URL을 파싱해 에이전트를 찾고 WebSocket으로 업그레이드하는 것까지 이 한 줄이 다 한다 — 지난 섹션의 `idFromName → get → fetch` 수동 라우팅의 자동화판.

## ⑨ 검증 + 확인

```
npx wrangler types     # 바인딩 바꿨으면
npx tsc -b             # 타입 체크 (app/worker 전부)
npm run dev
```

체크포인트: 브라우저에 **"Ping pong count: 0"**. 이 0은 프론트 값이 아니라 에이전트의 SQLite state에서 WebSocket으로 실시간으로 온 값이다. **── 여기까지가 3.1.** (버튼으로 increment/decrement 호출은 3.2에서.)

---

## 막히면 여기부터

| 증상 | 원인/해결 |
|---|---|
| `cannot find ChattingRoomAgent` | ④의 바인딩 `name` ≠ 클래스 이름 → 똑같이 맞추고 dev 재시작 |
| `Cannot find name 'Env'` (tsc) | ⑦의 tsconfig.app.json types 누락 |
| `pingPongCount is not defined` 류 | App.tsx에서 state 프로퍼티 이름 오타 — 제네릭을 넘겼는지 확인(자동완성이 잡아준다) |
| 화면이 "Connecting..."에서 안 넘어감 | ⑧ routeAgentRequest를 아직 안 넣었거나 dev 서버 재시작 필요 |
| initialState 바꿨는데 반영 안 됨 | 정상 — 최초 생성 때만 적용. `.wrangler/` 지우고 dev 재시작 |
