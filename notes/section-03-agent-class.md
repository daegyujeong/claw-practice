# Section 3 — Agent 클래스 (3.0 ~ 3.7)

> Nomad Coders 「Cloudflare Agents」 강의 Section 3의 학습 노트다. 3.0(셋업)부터 3.7 Schedule Tasks까지 정리했다.
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
                 + agent.send ↔ connection.send로 메시지 주고받기
3.4 Storage and Broadcast: 메시지는 state가 아니라 내장 SQL에 저장
                 + this.broadcast로 전원 전송, validateStateChange로 override 차단
3.5 Authentication: 닉네임을 query로 전달 → connection.setState(연결별 상태)
                 + loadHistory RPC로 과거 메시지, enabled로 연결 시점 제어
3.6 Read Only Connections: 보기만 가능한 연결 (shouldConnectionBeReadonly)
3.7 Schedule Tasks: schedule/scheduleEvery — 에이전트가 스스로 정해진 시간에 일한다
─── 섹션 마무리: 여기까지가 AI 없는 "에이전트 API 순수 체험" — 다음은 ChatAgent
```

핵심 줄거리: **"지난 섹션에서 Durable Object로 손수 만들던 것(WebSocket 업그레이드, 브로드캐스트)을 Agent 클래스가 얼마나 쉽게 만들어 주는지 본다."** 아직 AI는 없다. Agent 클래스가 공짜로 주는 실시간 기능(상태 동기화 · RPC · 저장소 · 브로드캐스트 · 스케줄)을 채팅방 하나로 전부 체험하는 것이 이 섹션의 목표다.

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

> 📘 공식 문서 보강 — callable의 인자와 반환값은 **JSON 직렬화 가능한 값만** 허용된다(함수, `Date`, `Map`, `Set` 불가). AI 응답처럼 시간이 걸리는 결과는 `@callable({ streaming: true })`로 조각 전송(`stream.send`)할 수 있다 — 뒤에 챗봇을 만들 때 다시 만난다. 워커→에이전트, 에이전트→에이전트 내부 호출은 `@callable` 없이도 가능하다(`getAgentByName()`의 표준 RPC) — `@callable`은 브라우저 같은 외부 클라이언트에게 열어줄 때만 필요하다.

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

> 📘 공식 문서 보강 — 이 콜백은 브로드캐스트가 끝난 **뒤에** 불린다. 감시용이지 차단용이 아니라는 뜻이다. 클라이언트발 변경을 **막으려면** `validateStateChange(nextState, source)`를 쓴다: 저장 전에 동기적으로 실행되고, 여기서 throw하면 변경이 거부된다(3.4에서 실제로 쓴다).

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
- **에이전트 → 전원**: `setState`(상태 브로드캐스트) 또는 `this.broadcast(...)` — 3.4에서 본격적으로 다룬다.
- **프론트에서 수신**: `useAgent`의 `onMessage: (event) => ...` 옵션 — 내용은 `event.data`에 있다. `console.log(event)`로 구조를 확인할 수 있다.

> 📘 공식 문서 보강 — 정식 시그니처와 추가 도구들:
> - `onConnect(connection, ctx)` — `ctx.request`로 요청 헤더·쿠키에 접근할 수 있어 **인증 후 `connection.close()`로 연결을 거절**하는 자리다(3.5 Authentication의 빌드업).
> - `onClose(connection, code, reason, wasClean)` — 끊긴 이유까지 받는다.
> - `this.broadcast(message, [제외할 연결 id])`로 전원 전송, `this.getConnections()` / `this.getConnection(id)`로 연결 목록 조회.
> - `connection.setState(...)`로 **연결마다 별도 상태**를 붙일 수 있다 — Section 2 채팅방에서 `serializeAttachment`로 닉네임을 관리하던 일의 Agent판이고, 하이버네이션을 넘어 유지된다.
> - 하이버네이션 중에도 WebSocket 연결·state·SQLite는 유지되지만 **메모리 변수, 타이머, 진행 중이던 promise는 사라진다.**

이 채팅방에는 아직 AI가 없다 — 이 챕터는 에이전트의 원시 기능(primitives)을 익히는 단계이고, AI는 뒤 섹션에서 붙인다.

---

## 6. 3.4 Storage and Broadcast — 메시지는 SQL에

이번 섹션에서 가장 중요한 설계 판단이 나오는 회차다.

- `setState`가 불릴 때마다 **전체 state가 모든 클라이언트에 브로드캐스트**된다. 클라이언트가 받는 것도 변경분(delta)이 아니라 전체 state다.
- 메시지 1만 개가 state에 들어 있다면? 새 메시지 하나 추가할 때마다 **1만 1개 전부가 모든 클라이언트에 재전송**된다.
- 결론: **가벼운 실시간 값(접속자 수)은 state, 쌓이는 데이터(메시지)는 SQL.**

에이전트는 인스턴스마다 **내장 SQLite DB**를 하나씩 갖고 있고 `this.sql`로 쓴다.

```ts
onStart() {
  void this.sql`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `;
}

onMessage(connection: Connection, message: WSMessage) {
  const messageObj = { nickname: "anon", message: message.toString(), created_at: Date.now() };
  void this.sql`
    INSERT INTO messages (nickname, message, created_at) VALUES (${messageObj.nickname}, ${messageObj.message}, ${messageObj.created_at})
  `;
  this.broadcast(JSON.stringify(messageObj), [connection.id]);
}
```

- `onStart`는 에이전트가 (재)기동할 때 호출된다 — 테이블 생성 자리.
- `this.sql`은 **SQL 인젝션에서 안전**하다.
- `this.broadcast(...)`는 연결된 모든 클라이언트에 전송하고, 두 번째 인자(`without`)에 연결 id 배열을 주면 그 연결들은 제외된다. 이 회차에서는 보낸 본인을 제외했다(3.5에서 바뀐다).
- override 방어도 이 회차에서 실전 투입: `validateStateChange`에서 `source !== "server"`면 throw → 프론트가 임의로 `setState`를 불러도 차단된다.

> 📘 공식 문서 보강 — `this.sql`이 인젝션에 안전한 이유와 KV와의 차이
> `this.sql`은 태그드 템플릿 리터럴이라 `${...}` 자리 값이 문자열 결합이 아니라 **자동으로 파라미터 바인딩**된다. 악의적인 입력이 SQL 구문이 될 수 없다. 그리고 이 DB는 **에이전트 인스턴스 전용·강한 일관성·지연 없음**이다 — Section 1에서 배운 KV(전 세계 공유, 최종 일관성, 같은 키 쓰기 초당 1회)와 정반대 성격이라는 점이 포인트. 채팅방마다 독립된 DB를 가진 셈이다. 또 `onStart`는 하이버네이션에서 깨어날 때도 다시 불릴 수 있으므로 `CREATE TABLE IF NOT EXISTS`처럼 여러 번 실행돼도 안전해야 한다.

---

## 7. 3.5 Authentication — 닉네임·히스토리·enabled

### 새로고침해도 대화가 남으려면

메시지는 이미 SQL에 있으므로, 접속할 때 불러오기만 하면 된다.

```ts
@callable()
loadHistory() {
  const { connection } = getCurrentAgent<ChattingRoomAgent>();
  console.log(connection?.state, "loaded history");
  return this.sql`SELECT * FROM messages ORDER BY created_at ASC LIMIT 100`;
}
```

```tsx
onOpen: async () => {
  setIsConnected(true);
  const history = (await agent.stub.loadHistory()) as Message[];
  setMessages(history);
},
onMessage: (event) => setMessages((prev) => [...prev, JSON.parse(event.data)]),
```

- 화면에서는 DB에서 온 과거 메시지와 방금 WebSocket으로 도착한 메시지가 똑같이 보인다. **출처만 다를 뿐 같은 `Message` 모양**이기 때문이다.
- WebSocket으로는 문자열만 오갈 수 있어서 보낼 때 `JSON.stringify`, 받을 때 `JSON.parse`를 쓴다 — "어떻게 메시지가 오고 간 거지?"의 답이 이것이다.
- `broadcast`는 3.4의 본인 제외(`[connection.id]`)를 버리고 **전원 전송**으로 바꿨다 — 내 메시지도 남의 메시지와 똑같이 `onMessage` 한 곳으로 받아서, 화면 표시 로직을 하나로 통일하기 위해서다.
- 함정: 브로드캐스트로 오는 실시간 메시지 객체에는 `id`가 없다(서버가 INSERT 결과의 id를 돌려주지 않음). React 목록 key로 `id`를 쓸 수 없어 `created_at`을 썼다.

### 닉네임: 커넥션마다 다른 값은 `connection.setState`

전원이 "anon"으로 보이는 문제를 닉네임 시스템으로 해결한다. 흐름:

1. React에서 닉네임 입력 폼 → `useAgent`의 `query: { nickname }` 옵션으로 **접속 URL 쿼리 파라미터**에 실어 보낸다.
2. `onConnect(connection, ctx)`에서 URL을 파싱해 꺼낸다: `new URL(ctx.request.url).searchParams.get("nickname") ?? "anon"`.
3. `connection.setState({ nickname })`으로 **그 커넥션 전용 상태**에 저장한다. (에이전트 전체 state와 별개다!)
4. `onMessage`에서 `connection.state.nickname`으로 보낸 사람을 알 수 있다 — `Connection<{ nickname: string }>` 제네릭이 이 state의 타입이다.

같이 배운 도구들:

- **`enabled: false`** — `useAgent`가 마운트 즉시 연결하지 않게 막는다. 닉네임 확정 시 `ready` state를 `true`로 바꿔 `enabled`가 켜지면 그때 연결된다. "로그인/인증이 끝난 뒤에만 연결"하는 실전 패턴의 축소판이다.
- **`getCurrentAgent()`** — `onMessage` 바깥의 아무 함수에서든 현재 에이전트와 요청을 보낸 커넥션(및 그 state)을 가져온다. `loadHistory` 안에서 "누가 히스토리를 불러갔는지" 알 수 있다.

> 📘 공식 문서 보강 — `connection.state`는 하이버네이션에도 살아남는다
> `connection.setState()`로 저장한 커넥션별 데이터는 에이전트가 잠들었다 깨어나도 유지된다. 또 커넥션에는 고유 `id`, 최초 접속 `uri`, 태그(`tags`) 같은 속성이 있어서 `getConnections("admin")`처럼 **특정 그룹에만 골라 보내는** 패턴도 가능하다 — 아래 admin 과제에서 쓸 만한 재료다. 참고로 타입상 `connection.state`는 `setState` 전까지 `null`일 수 있어, strict 모드인 이 프로젝트에서는 `connection.state?.nickname ?? "anon"`으로 접근했다(강사 코드와 다른 부분).

---

## 8. 3.6 Read Only Connections — 보기만 가능한 연결

읽기 전용 커넥션은 프론트에서 `setState`를 못 할 뿐 아니라, **상태를 바꾸는 `@callable` 호출도 서버에서 차단**된다(상태를 안 건드리는 `loadHistory` 같은 RPC는 허용). 뷰어 모드, 모니터링 대시보드, 권한 낮은 사용자에게 쓰는 기능이다.

만드는 방법 두 가지:

| 방법 | 시점 | 용도 |
|---|---|---|
| `this.setConnectionReadonly(connection, true/false)` | 아무 때나 | "읽기 전용 모드" 토글 같은 동적 전환 |
| `shouldConnectionBeReadonly(connection, ctx)` → boolean 반환 | 접속 순간 | 접속 시점에 권한 판정 |

```ts
shouldConnectionBeReadonly(_connection: Connection, ctx: ConnectionContext) {
  const url = new URL(ctx.request.url);
  const nickname = url.searchParams.get("nickname") ?? "anon";
  return nickname.includes("read");
}
```

동작 확인 포인트:

- read-only 커넥션이 `setState`를 유발하면 **"Connection is read-only"** 에러가 나고, 클라이언트에서는 `useAgent`의 `onStateUpdateError` 콜백으로 잡을 수 있다. 에이전트 로그에도 찍힌다.
- **함정**: 우리 채팅방은 `onConnect`에서 `setState`(접속자 수 +1)를 호출한다. 그래서 닉네임에 "read"가 들어간 커넥션은 **연결 즉시 에러**를 만난다 — 재현이 잘 되는 이유 자체가 "onConnect/onClose가 상태를 바꾸는 구조와 read-only가 충돌한다"는 함정의 증명이다.
- 이 데모를 위해 `validateStateChange`는 강사와 동일하게 잠시 주석 처리했다(3.4~3.5 커밋에 살아 있다) — 켜져 있으면 override가 read-only 검사에 닿기 전에 먼저 거부되기 때문이다.

### 과제 (강의에서 낸 것)

닉네임에 `admin`이 포함된 사용자에게만 **채팅 기록 전체 삭제 버튼**을 보여주고 동작하게 만들기 — 상태 변경 + 브로드캐스트를 조합하는 연습이다.

---

## 9. 3.7 Schedule Tasks — 에이전트가 스스로 일하게

Durable Object의 원래 알람은 **한 번에 하나**만 걸 수 있어서(Section 2에서 경험), 여러 개를 쓰려면 알람 테이블을 SQL로 직접 관리하며 "가장 가까운 다음 알람"을 매번 다시 걸어야 했다. Agent 클래스는 이걸 감싼 **스케줄 API**를 준다.

```ts
this.scheduleEvery(30, "deleteMessages");        // 30초마다 반복
this.schedule(60, "deleteMessages");             // 60초 뒤 한 번
this.schedule(new Date("2028-01-05"), "...");    // 특정 시각에 한 번
this.schedule("0 13 * * 1-5", "...");            // cron 문법 (평일 13시)
this.listSchedules();                            // 걸려 있는 스케줄 조회 (필터 가능)
```

- 콜백 자리는 **에이전트 클래스의 메서드 이름 문자열**이고, TypeScript가 그 이름의 메서드가 실제로 있는지 검사해준다(정의 전엔 타입 에러).
- 데모: 메시지에 "delete"가 포함되면 `scheduleEvery(30, "deleteMessages")`를 걸고, `deleteMessages`는 `DELETE FROM messages` 실행 → 30초 뒤 알람이 울려 메시지가 모두 사라짐.
- cron 문법은 생성기 사이트에서 만들어 붙여넣으면 된다.

> 📘 공식 문서 보강 — 스케줄의 실제 스펙
> 스케줄은 에이전트의 SQLite에 저장되므로 **재시작·하이버네이션에도 살아남는다**(내부 구현은 결국 DO 알람). 개수는 사실상 저장소 한도까지(수만 개), 작업 하나는 페이로드 포함 **최대 2MB**. 정밀도는 cron이 **분 단위**, `scheduleEvery`는 **초 단위**이며 이전 실행이 안 끝났으면 겹치는 실행은 건너뛴다. `cancelSchedule(id)`로 취소, `getScheduleById(id)`로 개별 조회가 가능하고, 세 번째 인자로 JSON 직렬화 가능한 페이로드를 넘길 수 있다: `this.schedule(60, "remind", { userId: 1 })`.

---

## 10. 실습 코드 뜯어보기 (`agent-foundations/`)

| 파일 | 역할 (3.7 기준) |
|---|---|
| `worker/index.ts` | `ChattingRoomAgent` — onStart(SQL 테이블), onConnect(닉네임→connection.setState + 접속자 수), onMessage(INSERT + broadcast + delete 예약), loadHistory RPC, shouldConnectionBeReadonly, deleteMessages + `routeAgentRequest` 라우팅 |
| `src/App.tsx` | 닉네임 게이트(`enabled: ready`) → 접속 후 히스토리 로드(`agent.stub.loadHistory`) + 실시간 수신(`onMessage`) + 메시지 폼(`agent.send`) + `onStateUpdateError` |
| `vite.config.ts` | `agents/vite` 플러그인 (데코레이터 문법 지원 — 3.2에서 추가) |
| `wrangler.jsonc` | DO 바인딩 + `new_sqlite_classes` 마이그레이션 |
| `tsconfig.app.json` | ⚠️ 템플릿에서 한 줄 수정 (아래 설명) |

- `App.tsx`가 `worker/index.ts`에서 **타입을 import**하는 순간, 워커 파일이 프론트엔드 컴파일에도 포함된다. 그런데 워커가 쓰는 전역 `Env` 타입은 `worker-configuration.d.ts`에만 있어서, 템플릿 그대로는 `tsc`가 "Cannot find name 'Env'" 에러를 낸다. → `tsconfig.app.json`의 `types` 배열에 `"./worker-configuration.d.ts"`를 추가해서 해결했다.
- **회차별 커밋을 따라가면 이전 버전을 그대로 볼 수 있다**: 핑퐁(@callable stub, override)은 3.2, connection.send 회신은 3.3, 본인 제외 broadcast와 validateStateChange는 3.4~3.5 커밋에 있다.
- 강사 코드와 다른 부분은 주석으로 이유를 남겼다: strict 모드 때문에 `connection.state?.nickname ?? "anon"`으로 접근한 것, React 목록에 `key`를 추가한 것(실시간 메시지에는 id가 없어 `created_at` 사용), 3.5에서 주석 처리된 `onStateChanged`.
- 이 예제의 의도된 한계: 닉네임은 아무나 사칭 가능하다(진짜 인증이 아니라 쿼리 파라미터). 실전 인증은 `onConnect`의 `ctx.request`(헤더·쿠키)로 하는 자리라는 것까지가 이번 회차의 메시지다.

---

## 11. 핵심 요약

1. **Agent 클래스는 Durable Object다.** DO의 모든 능력에 편한 API를 더한 것이고, wrangler 설정(바인딩 + `new_sqlite_classes`)도 DO와 똑같이 필요하다.
2. **state는 `setState()` 하면 SQLite 자동 저장 + 전 클라이언트 브로드캐스트.** 단 바뀔 때마다 **전체**가 재전송되므로 작게 유지한다 — 가벼운 실시간 값은 state, 쌓이는 데이터는 `this.sql`(태그드 템플릿이라 인젝션 안전).
3. **`@callable()` 메서드는 프론트에서 `agent.stub.메서드()`로 호출한다.** override(`agent.setState` 직접 호출)는 보안 구멍 — `validateStateChange`(저장 전 차단) 또는 read-only 커넥션으로 막고, `onStateChanged`의 `source`로 출처를 감시한다. callable 경유 변경은 서버 실행이라 source가 "server"다.
4. **커넥션 생명주기는 `onConnect`/`onClose`/`onMessage`.** WebSocket은 문자열만 오가므로 `JSON.stringify`/`parse`가 필수이고, 전원 전송은 `this.broadcast(msg, [제외 id])`다.
5. **커넥션마다 다른 값(닉네임)은 `connection.setState`에** — 에이전트 state와 별개이고 하이버네이션에도 살아남는다. 접속 전 정보 전달은 `query` 옵션, 연결 시점 제어는 `enabled` 옵션, 호출자 확인은 `getCurrentAgent()`.
6. **read-only 커넥션(`shouldConnectionBeReadonly` / `setConnectionReadonly`)은 상태 변경을 서버 차원에서 차단한다.** 단 `onConnect`가 `setState`를 하는 구조와는 충돌 주의("Connection is read-only").
7. **`schedule`/`scheduleEvery`는 DO 단일 알람의 한계를 감싼 다중 스케줄 API다.** 스케줄은 SQLite에 저장되어 재시작에도 유지된다.

---

## 12. 다음 섹션 미리보기

여기까지가 **AI 없이** Agent 클래스의 재료들(상태 동기화, RPC, 내장 SQL, 브로드캐스트, 커넥션 관리, 스케줄)을 순수하게 체험하는 구간이었다. 다음 강의부터는 Agent를 상속한 **ChatAgent 클래스**로 드디어 진짜 챗봇을 만든다 — 지금까지 손으로 만든 채팅방의 요소들(메시지 저장, 히스토리, 실시간 전송)이 ChatAgent에서는 얼마나 쉽게 처리되는지가 관전 포인트다. 그 전에 admin 삭제 버튼 과제(8절)가 남아 있다.

---

## 부록 — 헷갈렸던 것 Q&A

공부하면서 실제로 막혔던 지점들. 대부분 **"에이전트 코드는 서버에서, useAgent 쪽 코드는 내 브라우저에서 돈다 — 둘 사이를 오가는 건 WebSocket 문자열뿐"** 이라는 하나의 그림으로 풀린다.

**Q. "전체 state가 모든 클라이언트에 브로드캐스트된다"는 게 무슨 뜻인가?**
state의 원본은 에이전트(서버)에 하나 있고 접속자들은 복사본을 들고 있다. `setState`가 불리면 SDK는 변경분(delta)이 아니라 **바뀐 뒤의 state 객체 전체**를 접속자 전원에게 다시 보낸다. 단톡방 공지 한 줄이 바뀌었는데 공지 전문을 매번 전원에게 재전송하는 셈. 메시지 1만 개가 state에 있다면 1개 추가할 때마다 1만 1개짜리 덩어리가 접속자 수만큼 전송된다 — 메시지를 SQL로 옮긴 이유가 이것이다. 참고로 이 `setState`는 React의 setState와 이름만 같은 완전히 다른 API다(React 것은 내 화면만 다시 그림, 이것은 네트워크 전송).

**Q. `validateStateChange`의 `source`가 서버인지 아닌지는 어떻게 아는 건가?**
우리가 판별하는 게 아니라 SDK가 변경 요청이 **들어온 경로**에 꼬리표를 붙여준다. 클라이언트가 WebSocket으로 직접 `setState`(override)하면 그 Connection 객체가, 에이전트 안의 코드가 `this.setState`를 부르면 `"server"`가 담긴다. 함정: 프론트가 `@callable` 메서드를 호출한 경우 그 메서드는 **서버에서 실행**되므로 source는 `"server"`다. 그래서 `source !== "server"` 차단은 callable 경유 변경은 통과시키고 직접 override만 막는다.

**Q. `onStateUpdate`가 "필요 없다"는 이유는?**
프론트에서 `agent.state`를 직접 참조해도 상태가 바뀌면 최신값으로 리렌더링되기 때문. 화면 표시 용도라면 콜백 없이 충분하고, `onStateUpdate`는 상태가 바뀌는 순간마다 별도 동작(로그 등)을 실행하고 싶을 때만 쓰는 선택 사항이다.

**Q. 메시지는 어떻게 오고 간 건가?**
WebSocket은 객체를 못 보내고 문자열만 보낼 수 있다(Web API의 규칙). 폼 제출 → `agent.send(JSON.stringify(객체))` → 에이전트 `onMessage`에서 SQL 저장 + `broadcast` → 클라이언트들의 `onMessage(event)` → `JSON.parse(event.data)`로 복원 → 화면에 추가. "문자열로 포장했다가(stringify) 도착해서 푸는(parse)" 왕복이다.

**Q. `enabled: false`는 무슨 뜻인가?**
`useAgent`는 원래 컴포넌트가 뜨자마자 자동 접속한다. `enabled: false`는 그 자동 접속을 꺼두는 스위치로, 조건이 갖춰졌을 때(닉네임 확정, 로그인 완료) `true`로 바꿔 그제야 연결한다.

**Q. `getCurrentAgent()`는 왜 필요한가?**
`onMessage`는 인자로 `connection`을 받아 누가 보냈는지 알 수 있지만, `loadHistory` 같은 일반 메서드에는 그런 인자가 없다. `getCurrentAgent()`는 그런 함수 안에서도 "지금 이 호출을 일으킨 에이전트와 커넥션"을 꺼내오는 도구다.
