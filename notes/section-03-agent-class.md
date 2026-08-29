# Section 3 — Agent 클래스 (진행 중: 3.0 ~ 3.1)

> Nomad Coders 「Cloudflare Agents」 강의 Section 3의 학습 노트다. 지금은 3.0(프로젝트 셋업)과 3.1(상태 동기화)까지만 정리했고, 섹션이 진행되면 이어서 채운다.
> 📘 표시가 붙은 부분은 **Cloudflare 공식 문서(developers.cloudflare.com)** 를 참조해 강의에 없던 사실을 보강한 것이다.

---

## 0. 강의 흐름 한눈에 보기

```
3.0 셋업: agent-foundations 프로젝트 생성 (React 프레임워크 스타터)
          + `agents` 패키지 설치 + ChattingRoomAgent 클래스 + wrangler 설정
3.1 상태: Agent의 state/setState → SQLite 자동 저장
          + useAgent 훅으로 프론트엔드가 WebSocket으로 실시간 구독   ← 여기까지 정리
3.2 예고: 프론트엔드에서 에이전트의 increment/decrement 호출하기
```

핵심 줄거리: **"지난 섹션에서 Durable Object로 손수 만들던 것(WebSocket 업그레이드, 브로드캐스트)을 Agent 클래스가 얼마나 쉽게 만들어 주는지 본다."** 아직 AI는 없다. 지난 섹션의 채팅방을 Agent 클래스로 다시 만드는 것이 이 섹션의 목표다.

---

## 1. Agent 클래스란 — Durable Object의 편한 옷

- **Agent 클래스 = Durable Object 위에 얹힌 고수준 추상화.** DO가 주는 것(이름당 하나뿐인 고유 인스턴스, 내장 SQLite, WebSocket)을 전부 가지면서 API가 훨씬 편하다. `agents` npm 패키지로 설치한다.
- Agent도 결국 DO이므로 **wrangler.jsonc에 DO 바인딩과 마이그레이션이 그대로 필요**하다.
- 이번 섹션의 큰 차이: 지난 섹션은 프론트엔드 없이 콘솔에서 WebSocket을 시험했지만, 이번에는 **React 프론트엔드**를 만든다. `agents` 패키지가 프론트엔드용 React 훅까지 제공하기 때문에 가능해진 일이다.

> 📘 공식 문서 보강 — Agent 인스턴스는 **이름(또는 ID)당 전 세계에 단 하나**다. 같은 이름으로 접근하면 언제나 같은 인스턴스를 받는다(DO의 성질 그대로). 또한 Agent 클래스에는 이번 강의에서 안 다룬 훅들이 더 있다: `onRequest`(HTTP), `onConnect`/`onMessage`(WebSocket), `onStart`(깨어날 때), `schedule()`(예약 실행) 등. 뒤 챕터들의 빌드업이다.

---

## 2. 3.0 — 프로젝트 셋업

### 생성 과정

| 단계 | 명령/선택 |
|---|---|
| 프로젝트 생성 | `npm create cloudflare@latest agent-foundations` |
| 템플릿 | Hello World가 아니라 **Framework Starter → React → TypeScript** |
| git / 배포 | 둘 다 No |
| 개발 서버 확인 | `npm run dev` |
| 에이전트 SDK 설치 | `npm install agents` |

Framework Starter를 고르는 이유: **Cloudflare Workers는 React 같은 UI 앱도 배포할 수 있고**(Workers with Assets), 이 템플릿은 Vite 기반 React 프론트엔드(`src/`)와 워커(`worker/`)가 한 프로젝트에 같이 들어 있다.

### 워커 쪽 — 클래스 하나면 끝

```ts
import { Agent } from "agents";

export class ChattingRoomAgent extends Agent<Env, PingPongState> { ... }
```

지난 섹션의 `extends DurableObject` 자리에 `extends Agent`가 들어왔다고 보면 된다.

### wrangler.jsonc — DO 시절과 같은 설정

```jsonc
"durable_objects": {
  "bindings": [{ "name": "ChattingRoomAgent", "class_name": "ChattingRoomAgent" }]
},
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["ChattingRoomAgent"] }]
```

- `new_sqlite_classes`: 이 클래스에 내장 SQLite를 켠다. 3.1에서 배우는 **state 자동 저장이 이 SQLite 위에서 동작**하므로 필수다. `migrations`와 `tag`의 의미는 배포를 다룰 때 설명된다고 했다.
- **바인딩 `name`은 클래스 이름과 똑같이** 두는 게 안전하다. 3.1 데모에서 강사가 바인딩 이름을 다르게 뒀다가 "cannot find ChattingRoomAgent" 에러를 만났다 — `routeAgentRequest()`가 URL 속 에이전트 이름으로 바인딩을 찾기 때문이다.

### 프론트엔드 정리

`src/`의 에셋·CSS·보일러플레이트를 전부 삭제하고 빈 상태에서 시작한다. CSS는 코스 후반에 AI가 작성할 예정이다.

---

## 3. 3.1 — Agent의 state와 실시간 동기화

### state: "그냥 객체인데 알아서 DB에 저장된다"

- Agent는 `state`라는 **일반 JavaScript 객체**를 갖는다. 여기에 뭘 넣든, 백그라운드에서 **모든 DO가 갖고 있는 SQL 데이터베이스에 자동으로 저장**된다. 테이블을 만들 필요가 없다(원하면 SQL 직접 접근도 여전히 가능).
- 초기값은 `initialState` 프로퍼티로 준다.
- 변경은 `this.setState(...)`로 한다 — React 클래스 컴포넌트 시절과 같은 패턴이다.

```ts
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

**함정 — initialState는 딱 한 번이다.** DO는 처음 요청 때 한 번 생성되고, 그 뒤로는 파괴하지 않는 한 다시 생성되지 않는다. 이후 요청은 하이버네이션에서 **깨어날** 뿐이다. 그래서 initialState는 최초 생성 때 한 번만 적용되고, 그 뒤 state를 바꿔도 initialState가 덮어쓰는 일은 없다.

> 📘 공식 문서 보강 — `setState()`는 한 번에 세 가지를 한다: ① SQLite에 저장, ② **WebSocket으로 연결된 모든 클라이언트에 브로드캐스트**, ③ 상태 변경 콜백 호출. 그래서 공식 문서는 **state를 작게 유지하라**고 권한다(변경할 때마다 전체가 브로드캐스트되므로). 큰 데이터는 state가 아니라 `this.sql` 템플릿 리터럴로 SQLite에 직접 넣는 것이 맞다. 또 state는 **JSON 직렬화 가능해야** 한다 — 함수, 클래스 인스턴스, 순환 참조는 안 되고, Date는 ISO 문자열로 넣는다.

### 타입을 프론트와 공유하기

```ts
export type PingPongState = { pingPongCount: number };
```

이 타입을 워커에서 export해 두면 프론트엔드가 그대로 import해서 쓴다. 백엔드와 프론트엔드가 한 저장소에 있으니 **상태 구조가 어긋날 수 없는 풀스택 타입 안전성**이 생긴다. Agent 제네릭은 `Agent<Env, PingPongState>` — Env는 바인딩 타입(나중에 KV 등을 쓸 때), 두 번째가 state 타입이다.

### useAgent 훅 — API 없이 프론트가 에이전트에 붙는다

```tsx
const agent = useAgent<ChattingRoomAgent, PingPongState>({
  agent: "chatting-room-agent",
  onOpen() { setIsConnected(true); },
  onStateUpdate(state) { setPingPongs(state.pingPongCount); },
});
```

- 훅이 마운트되는 순간 **자동으로 WebSocket 업그레이드 요청**을 워커로 보낸다. 강의에서 `console.log(request.url)`로 확인해 보면 `/agents/chatting-room-agent/...` 형태의 URL이 찍힌다 — 클래스 이름이 소문자+대시(kebab-case)로 변환된 것이다.
- `onOpen`: 연결이 열리면 호출 → `isConnected`를 true로 바꿔 "Connecting..." 화면을 걷어낸다.
- `onStateUpdate`: **백엔드가 setState를 할 때마다 새 state가 프론트로 밀려온다.** 폴링도, 수동 fetch도, API 구축도 없다. 이것이 강사가 "에이전트 플랫폼이 얼마나 큰지 처음 실감한 지점"이라고 한 기능이다.
- 제네릭 두 개(`ChattingRoomAgent`, `PingPongState`)를 넘기면 `agent.state`에 자동완성과 타입 체크가 붙는다.

> 📘 공식 문서 보강 — 접속 URL의 정식 패턴은 `/agents/:에이전트이름/:인스턴스이름`이다. `name` 옵션으로 인스턴스 이름을 주면 방(room)마다 다른 인스턴스에 붙을 수 있다(채팅방 만들 때 쓰게 될 성질). 그리고 동기화는 **양방향**이다 — 클라이언트 쪽에서도 `agent.setState(...)`로 상태를 밀어올릴 수 있고, 서버는 `validateStateChange()`로 클라이언트발 변경을 검증(throw하면 거부)할 수 있다.

### 워커 쪽 마무리 — routeAgentRequest

```ts
async fetch(request, env) {
  const agentResponse = await routeAgentRequest(request, env);
  if (agentResponse) return agentResponse;
  return new Response(null, { status: 404 });
}
```

훅이 보낸 그 URL을 워커가 받아서, 이름에 맞는 에이전트를 찾고, 세션을 만들고, WebSocket으로 업그레이드하는 일 — 지난 섹션에서 `idFromName → get → fetch`로 직접 하던 그 일을 `routeAgentRequest()` 한 줄이 전부 대신한다. 에이전트로 가는 요청이 아니면(응답이 없으면) 404를 준다.

### 데모 결과

프론트엔드에 **"ping pong count: 0"** 이 뜬다. 이 0은 프론트가 갖고 있던 값이 아니라 **에이전트의 SQLite에 저장된 state에서 실시간으로 온 값**이다.

---

## 4. 실습 코드 뜯어보기 (`agent-foundations/`)

| 파일 | 역할 |
|---|---|
| `worker/index.ts` | `ChattingRoomAgent`(state + increment/decrement) + `routeAgentRequest` 라우팅 |
| `src/App.tsx` | `useAgent` 훅으로 연결 → `onStateUpdate`로 카운트 실시간 표시 |
| `wrangler.jsonc` | DO 바인딩 + `new_sqlite_classes` 마이그레이션 |
| `tsconfig.app.json` | ⚠️ 템플릿에서 한 줄 수정 (아래 설명) |

- `App.tsx`가 `worker/index.ts`에서 **타입을 import**하는 순간, 워커 파일이 프론트엔드 컴파일에도 포함된다. 그런데 워커가 쓰는 전역 `Env` 타입은 `worker-configuration.d.ts`에만 있어서, 템플릿 그대로는 `tsc`가 "Cannot find name 'Env'" 에러를 낸다. → `tsconfig.app.json`의 `types` 배열에 `"./worker-configuration.d.ts"`를 추가해서 해결했다.
- `App.tsx`의 `agent` 변수는 3.1 시점에는 아직 안 쓰인다(3.2에서 호출에 사용). 이 프로젝트는 `noUnusedLocals`가 켜져 있어 안 쓰는 변수가 컴파일 에러라서, 임시로 `void agent;` 참조를 남겨 뒀다.
- 이 카운터가 학습용 예제로 좋은 이유: Section 1의 KV 카운터가 가진 한계(초당 1회 쓰기, 최종 일관성, 레이스 컨디션)를 **DO의 단일 인스턴스 + 자동 브로드캐스트**가 어떻게 해결하는지 가장 작은 코드로 보여준다.

---

## 5. 핵심 요약

1. **Agent 클래스는 Durable Object다.** DO의 모든 능력(고유 인스턴스, SQLite, WebSocket)에 편한 API를 더한 것이고, 그래서 wrangler 설정(바인딩 + `new_sqlite_classes`)도 DO와 똑같이 필요하다.
2. **state는 그냥 JS 객체인데 `setState()` 하면 SQLite에 자동 저장된다.** 테이블 생성 불필요. 단 📘 JSON 직렬화 가능해야 하고, 매 변경마다 전체가 브로드캐스트되므로 작게 유지한다.
3. **initialState는 인스턴스 최초 생성 때 딱 한 번.** 이후에는 하이버네이션에서 깨어날 뿐, 다시 적용되지 않는다.
4. **useAgent 훅 하나로 프론트엔드가 에이전트에 WebSocket으로 붙는다.** API도 fetch도 필요 없고, `onStateUpdate`로 서버 상태가 실시간으로 밀려온다. 📘 동기화는 양방향이라 클라이언트도 setState할 수 있다.
5. **`routeAgentRequest()`가 지난 섹션의 수동 라우팅을 전부 대신한다.** URL 패턴은 `/agents/:에이전트이름(kebab-case)/:인스턴스이름`.
6. **바인딩 이름은 클래스 이름과 맞춰라.** 다르면 routeAgentRequest가 에이전트를 못 찾는다 (강사도 데모 중에 이 에러를 만났다).
7. 워커에서 export한 state 타입을 프론트가 import하는 **풀스택 타입 안전성**이 이 구조의 큰 장점이다.

---

## 6. 다음 강의(3.2) 미리보기

지금은 프론트가 상태를 **읽기만** 한다. 다음 강의에서는 프론트엔드에서 에이전트의 `increment()` / `decrement()`를 **직접 호출**하는 법을 배운다 — 지금 안 쓰고 있는 `agent` 객체가 그때 주인공이 된다.
