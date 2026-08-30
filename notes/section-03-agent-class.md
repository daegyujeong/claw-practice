# Section 3 — Agent 클래스 (진행 중: 3.0 ~ 3.3)

> Nomad Coders 「Cloudflare Agents」 강의 Section 3의 학습 노트다. 지금은 3.0(셋업) ~ 3.3 Messages까지 정리했고, 섹션이 진행되면 이어서 채운다.
> 📘 표시가 붙은 부분은 **Cloudflare 공식 문서(developers.cloudflare.com)** 를 참조해 강의에 없던 사실을 보강한 것이다.

---

## 0. 강의 흐름 한눈에 보기

```
3.0 셋업:        agent-foundations 프로젝트 생성 (React 프레임워크 스타터)
                 + `agents` 패키지 설치 + ChattingRoomAgent 클래스 + wrangler 설정
3.1 AgentState:  Agent의 state/setState → SQLite 자동 저장
                 + useAgent 훅으로 프론트엔드가 WebSocket으로 실시간 구독
3.2 Callables:   @callable 데코레이터 → 프론트에서 agent.stub.메서드() 호출
                 + 프론트의 setState 직접 호출(override)과 onStateChanged(source)
3.3 Messages:    채팅방으로 리팩터링 — onConnect / onClose / onMessage
                 + agent.send ↔ connection.send로 메시지 주고받기   ← 여기까지 정리
─── 이후 회차: 3.4 Storage and Broadcast → 3.5 Authentication
              → 3.6 Read Only Connections → 3.7 Schedule Tasks
```

핵심 줄거리: **"지난 섹션에서 Durable Object로 손수 만들던 것(WebSocket 업그레이드, 브로드캐스트)을 Agent 클래스가 얼마나 쉽게 만들어 주는지 본다."** 아직 AI는 없다. 지난 섹션의 채팅방을 Agent 클래스로 다시 만드는 것이 이 섹션의 목표다.

---

## 1. Agent 클래스란 — Durable Object의 편한 옷

- **Agent 클래스 = Durable Object 위에 얹힌 고수준 추상화.** DO가 주는 것(이름당 하나뿐인 고유 인스턴스, 내장 SQLite, WebSocket)을 전부 가지면서 API가 훨씬 편하다. `agents` npm 패키지로 설치한다.
- Agent도 결국 DO이므로 **wrangler.jsonc에 DO 바인딩과 마이그레이션이 그대로 필요**하다.
- 이번 섹션의 큰 차이: 지난 섹션은 프론트엔드 없이 콘솔에서 WebSocket을 시험했지만, 이번에는 **React 프론트엔드**를 만든다. `agents` 패키지가 프론트엔드용 React 훅까지 제공하기 때문에 가능해진 일이다.

> 📘 공식 문서 보강 — Agent 인스턴스는 **이름(또는 ID)당 전 세계에 단 하나**다. 같은 이름으로 접근하면 언제나 같은 인스턴스를 받는다(DO의 성질 그대로). 또한 Agent 클래스에는 이번 강의에서 안 다룬 훅들이 더 있다: `onRequest`(HTTP), `onStart`(깨어날 때), `schedule()`(예약 실행) 등. 뒤 챕터들의 빌드업이다.

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

export class ChattingRoomAgent extends Agent<Env, ChattingRoomState> { ... }
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

## 3. 3.1 AgentState — state와 실시간 동기화

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

## 4. 3.2 Callables — 프론트에서 에이전트 메서드 호출

### 데코레이터 하나로 RPC가 생긴다

```ts
import { Agent, callable, routeAgentRequest } from "agents";

@callable()
increment() {
  this.setState({ pingPongCount: this.state.pingPongCount + 1 });
}
```

- `callable`을 `agents`에서 import해서 **프론트에 노출하고 싶은 메서드 위에** 붙인다. 이게 전부다.
- 데코레이터 문법을 Vite가 그냥은 못 읽어서 에러를 낸다 → `vite.config.ts`의 `plugins`에 **`agents/vite` 플러그인**을 추가하면 해결된다.
- 프론트에서는 `agent.stub.increment()` / `agent.stub.decrement()`로 호출한다. **stub은 "원격 객체를 대신하는 대리 객체"라는 RPC 용어**다(녹취에는 "agent.stop"으로 들리지만 stub이 맞다). 문서상으로는 stub에 callable 메서드 자동완성이 붙어야 하는데, 강사 환경에서는 동작하지 않았다.
- 버튼을 누르면: 프론트가 stub 호출 → 서버의 메서드가 실행 → `setState` → **연결된 모든 클라이언트에 자동 브로드캐스트.** 두 브라우저를 열어 두면 한쪽 클릭이 다른 쪽에도 실시간 반영된다. Section 2에서 손으로 만들던 브로드캐스트가 공짜로 나온다.

### override — 프론트가 상태를 직접 덮어쓰기

프론트도 `agent.setState({ pingPongCount: 10000 })`처럼 **서버 메서드를 거치지 않고** 상태를 바꿀 수 있다. 강의는 이걸 override라고 불렀다. 되긴 되지만 권장하지 않는다 — 지금은 **아무 클라이언트나 상태를 마음대로 바꿀 수 있는 보안 구멍**이기 때문이다. 이상적으로는 `@callable` 메서드를 만들고 그 안에서 검증하라고 했고, read-only connections는 3.6 회차에서 다룬다.

### onStateChanged — 누가 바꿨는지 추적

```ts
onStateChanged(state: ChattingRoomState, source: Connection | "server") {
  console.log("new state", state);
  console.log("who did it", source);
}
```

- `@callable` 메서드가 바꾸면 `source`는 **"server"** — 프론트가 호출했어도 setState 실행 자체는 서버 안에서 일어났기 때문이다.
- 프론트가 `agent.setState`로 직접 바꾸면(override) `source`는 **그 WebSocket 연결(Connection)** — 상태 변경의 출처가 서버 바깥이라는 뜻이다.

> 📘 공식 문서 보강 — 이 콜백은 브로드캐스트가 끝난 **뒤에** 불린다. 감시용이지 차단용이 아니라는 뜻이다. 클라이언트발 변경을 **막으려면** `validateStateChange(nextState, source)`를 쓴다: 저장 전에 동기적으로 실행되고, 여기서 throw하면 변경이 거부된다. read-only connections(3.6)가 나오기 전에도 이걸로 override를 방어할 수 있다.

### onStateUpdate가 "필요 없다"고 한 이유

프론트의 `onStateUpdate` 콜백으로 상태를 React state에 복사하지 않아도, JSX에서 `agent.state.pingPongCount`를 **직접 참조**하면 상태가 바뀔 때 화면이 갱신된다. 실제로 강사 코드도 이 회차에서 `onStateUpdate`를 주석 처리하고 `agent?.state?.pingPongCount` 직접 읽기로 바꿨다. 즉 콜백은 필수가 아니라 **"상태가 바뀌는 순간마다 뭔가 하고 싶을 때"**(로그, 알림, 파생 계산) 쓰는 선택지다.

---

## 5. 3.3 Messages — 채팅방 에이전트와 WebSocket 이벤트

핑퐁 데모를 지우고 채팅방으로 리팩터링한다: 상태 타입을 `ChattingRoomState`(접속자 수 `currentlyOnline`)로 바꾸고, Agent에 내장된 WebSocket 생명주기 메서드를 쓴다. **Agent는 여전히 Durable Object라서** Section 2에서 본 저수준 기능(연결 객체, 직접 회신)도 전부 갖고 있다.

| 메서드 | 언제 불리나 | 이번 회차에서 한 일 |
|---|---|---|
| `onConnect()` | 새 클라이언트가 WebSocket으로 연결됐을 때 | `setState`로 `currentlyOnline + 1` |
| `onClose()` | 연결이 끊겼을 때 | `currentlyOnline - 1` |
| `onMessage(connection, message)` | 그 연결로부터 메시지를 받았을 때 | `console.log(message)` 후 `connection.send("love you back")` |

메시지 주고받기의 네 방향을 구분해 두면 헷갈리지 않는다:

- **프론트 → 에이전트**: `agent.send(데이터)` — 폼 제출 핸들러에서 호출하면 WebSocket으로 에이전트의 `onMessage`에 도착한다.
- **에이전트 → 보낸 사람 한 명**: `onMessage` 안에서 `connection.send(...)` — 그 연결에만 회신.
- **에이전트 → 전원**: `setState`(상태 브로드캐스트) 또는 `this.broadcast(...)` — 3.4 Storage and Broadcast에서 본격적으로 다룬다.
- **프론트에서 수신**: `useAgent`의 `onMessage: (event) => ...` 옵션 — 내용은 `event.data`에 있다. `console.log(event)`로 구조를 확인할 수 있다.

> 📘 공식 문서 보강 — 정식 시그니처와 추가 도구들:
> - `onConnect(connection, ctx)` — `ctx.request`로 요청 헤더·쿠키에 접근할 수 있어 **인증 후 `connection.close()`로 연결을 거절**하는 자리다(3.5 Authentication의 빌드업).
> - `onClose(connection, code, reason, wasClean)` — 끊긴 이유까지 받는다.
> - `this.broadcast(message, [제외할 연결 id])`로 전원 전송, `this.getConnections()` / `this.getConnection(id)`로 연결 목록 조회.
> - `connection.setState(...)`로 **연결마다 별도 상태**를 붙일 수 있다 — Section 2 채팅방에서 `serializeAttachment`로 닉네임을 관리하던 일의 Agent판이고, 하이버네이션을 넘어 유지된다.
> - 하이버네이션 중에도 WebSocket 연결·state·SQLite는 유지되지만 **메모리 변수, 타이머, 진행 중이던 promise는 사라진다.**

이 채팅방에는 아직 AI가 없다 — 이 챕터는 에이전트의 원시 기능(primitives)을 익히는 단계이고, AI는 뒤 섹션에서 붙인다.

---

## 6. 실습 코드 뜯어보기 (`agent-foundations/`)

| 파일 | 역할 |
|---|---|
| `worker/index.ts` | `ChattingRoomAgent`(currentlyOnline state + onStateChanged + onConnect/onClose/onMessage) + `routeAgentRequest` 라우팅 |
| `src/App.tsx` | `useAgent` 훅으로 연결 → 접속자 수 실시간 표시 + 메시지 폼(`agent.send`) + `onMessage` 수신 |
| `vite.config.ts` | `agents/vite` 플러그인 (데코레이터 문법 지원 — 3.2에서 추가) |
| `wrangler.jsonc` | DO 바인딩 + `new_sqlite_classes` 마이그레이션 |
| `tsconfig.app.json` | ⚠️ 템플릿에서 한 줄 수정 (아래 설명) |

- `App.tsx`가 `worker/index.ts`에서 **타입을 import**하는 순간, 워커 파일이 프론트엔드 컴파일에도 포함된다. 그런데 워커가 쓰는 전역 `Env` 타입은 `worker-configuration.d.ts`에만 있어서, 템플릿 그대로는 `tsc`가 "Cannot find name 'Env'" 에러를 낸다. → `tsconfig.app.json`의 `types` 배열에 `"./worker-configuration.d.ts"`를 추가해서 해결했다.
- **핑퐁 버전(@callable stub 호출, override 버튼)은 3.2 커밋에 남아 있다** — 3.3에서 채팅방으로 리팩터링하면서 코드에서는 사라졌지만, 회차별 커밋을 따라가면 그대로 볼 수 있다.
- 3.3 코드에서 `@callable` 메서드가 사라져 `callable` import도 뺐다(안 쓰는 import는 이 프로젝트의 타입 체크에서 에러). 강사 코드는 import를 남겨 뒀는데, 뒤 회차에서 다시 쓰기 때문이다.
- 이 예제의 의도된 한계: **쓰기 권한 제어가 아직 없다**(누구나 override 가능). 3.5 Authentication과 3.6 Read Only Connections가 이 구멍을 메우는 회차다.

---

## 7. 핵심 요약

1. **Agent 클래스는 Durable Object다.** DO의 모든 능력(고유 인스턴스, SQLite, WebSocket)에 편한 API를 더한 것이고, 그래서 wrangler 설정(바인딩 + `new_sqlite_classes`)도 DO와 똑같이 필요하다.
2. **state는 그냥 JS 객체인데 `setState()` 하면 SQLite에 자동 저장되고 전 클라이언트에 브로드캐스트된다.** 📘 JSON 직렬화 가능해야 하고, 작게 유지한다.
3. **initialState는 인스턴스 최초 생성 때 딱 한 번.** 이후에는 하이버네이션에서 깨어날 뿐, 다시 적용되지 않는다.
4. **useAgent 훅 하나로 프론트엔드가 에이전트에 WebSocket으로 붙는다.** `onStateUpdate` 콜백은 선택 — `agent.state`를 JSX에서 직접 읽어도 갱신된다.
5. **`@callable()`을 붙인 메서드는 프론트에서 `agent.stub.메서드()`로 호출한다.** Vite에는 `agents/vite` 플러그인이 필요하다.
6. **프론트의 `agent.setState` 직접 호출(override)은 가능하지만 보안 구멍이다.** `onStateChanged`의 `source`("server" vs Connection)로 출처를 구분하고, 📘 `validateStateChange`로 저장 전에 거부할 수 있다.
7. **`onConnect` / `onClose` / `onMessage`가 연결 생성·종료·수신 이벤트다.** `agent.send` ↔ `connection.send`로 양방향 메시지를 주고받는다. 📘 전원 전송은 `this.broadcast`.

---

## 8. 다음 회차 미리보기

지금은 메시지를 받아 한 명에게 회신할 줄만 알고, 누구나 override로 상태를 덮어쓸 수 있다. 이어지는 회차가 정확히 이 빈틈들을 채운다: **3.4 Storage and Broadcast**(메시지 저장과 전원 전송), **3.5 Authentication**(연결 시 인증), **3.6 Read Only Connections**(쓰기 권한 제한), **3.7 Schedule Tasks**(예약 실행). 그 뒤에 이 채팅방 위에 AI를 얹는다.
