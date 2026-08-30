# Agent 클래스 따라 만들기 (3.0 ~ 3.7)

> 강의를 다시 보지 않고도 처음부터 따라 만들 수 있도록, **순서대로 어디에 무엇을 쓰는지**만 모은 자료다. 개념 설명은 `section-03-agent-class.md`에 있다.
> 이름(`agent-foundations`, `ChattingRoomAgent`, `ChattingRoomState`)은 이 저장소에서 실제로 쓴 것 그대로다. 과제 때는 맨 아래 **"과제에서 바로 꺼내 쓰는 레시피"**부터 보면 빠르다.

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
[vite.config.ts]   agents/vite 플러그인                        ⑩ 데코레이터 지원
[worker+App]       @callable → agent.stub 호출 (+override)     ⑪ RPC                   ← 여기까지 3.2
[worker+App]       채팅방 리팩터링 — onConnect/onClose/onMessage ⑫ WebSocket 이벤트      ← 여기까지 3.3
[worker/index.ts]  onStart 테이블 + INSERT + broadcast          ⑬ 저장과 전원 전송
[worker/index.ts]  validateStateChange                          ⑭ override 차단          ← 여기까지 3.4
[src/App.tsx]      닉네임 폼 + query/enabled                    ⑮ 접속 전 정보 전달
[worker/index.ts]  onConnect(ctx) + connection.setState         ⑯ 연결별 상태
[worker+App]       loadHistory RPC + 히스토리 렌더               ⑰ 과거 메시지            ← 여기까지 3.5
[worker+App]       shouldConnectionBeReadonly + 에러 처리        ⑱ 읽기 전용              ← 여기까지 3.6
[worker/index.ts]  scheduleEvery + deleteMessages               ⑲ 예약 실행              ← 여기까지 3.7
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

체크포인트: 브라우저에 **"Ping pong count: 0"**. 이 0은 프론트 값이 아니라 에이전트의 SQLite state에서 WebSocket으로 실시간으로 온 값이다. **── 여기까지가 3.1.**

---

## ⑩ 데코레이터 지원 (3.2, `vite.config.ts`)

`@callable`을 쓰기 전에 먼저 — 안 하면 Vite가 데코레이터 문법 에러를 낸다:

```ts
import agents from "agents/vite";

export default defineConfig({
  plugins: [agents(), react(), cloudflare()],   // agents()를 추가
});
```

## ⑪ @callable → 프론트에서 stub 호출 (3.2)

워커 — 프론트에 노출할 메서드 위에 데코레이터만:

```ts
import { Agent, callable, routeAgentRequest, type Connection } from "agents";

@callable()
increment() {
  this.setState({ pingPongCount: this.state.pingPongCount + 1 });
}

// 누가 바꿨는지 추적 (감시용 — 차단은 ⑭ validateStateChange)
onStateChanged(state: PingPongState, source: Connection | "server") {
  console.log("who did it", source);   // callable 경유면 "server", override면 Connection
}
```

프론트 — `agent.stub`이 원격 메서드의 대리 객체다:

```tsx
<button onClick={() => agent.stub.increment()}>increment</button>
{/* override: 서버 메서드 없이 상태 직접 덮어쓰기 — 보안 구멍 데모용 */}
<button onClick={() => agent.setState({ pingPongCount: 10000 })}>override</button>
```

체크포인트: 브라우저 두 개를 열고 한쪽에서 클릭 → 다른 쪽도 실시간 갱신. **── 여기까지가 3.2.**

## ⑫ 채팅방으로 리팩터링 (3.3)

상태 타입 교체 + WebSocket 이벤트 3종:

```ts
export type ChattingRoomState = { currentlyOnline: number };

onConnect() {
  this.setState({ currentlyOnline: this.state.currentlyOnline + 1 });
}
onClose() {
  this.setState({ currentlyOnline: this.state.currentlyOnline - 1 });
}
onMessage(connection: Connection, message: WSMessage) {
  connection.send("love you back");   // 보낸 사람에게만 회신
}
```

프론트 — 메시지 폼:

```tsx
const sendMessage = () => { agent.send(message); setMessage(""); };
// 수신은 useAgent 옵션으로: onMessage: (event) => console.log(event.data)
```

방향 감각: **프론트→에이전트** `agent.send` / **에이전트→한 명** `connection.send` / **에이전트→전원** `broadcast`(⑬) 또는 `setState`. **── 여기까지가 3.3.**

## ⑬ 메시지는 SQL에, 전송은 broadcast (3.4)

⚠️ 원칙부터: **state는 바뀔 때마다 전체가 전원에게 재전송**된다. 쌓이는 데이터(메시지)는 state 금지, `this.sql`로.

```ts
onStart() {                       // (재)기동 때마다 불릴 수 있음 → IF NOT EXISTS 필수
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
  this.broadcast(JSON.stringify(messageObj), [connection.id]);  // 두 번째 인자 = 제외할 id 배열
}
```

- `this.sql`은 태그드 템플릿 — `${}`가 자동 파라미터 바인딩이라 SQL 인젝션 안전.
- WebSocket은 문자열만 오간다: 보낼 때 `JSON.stringify`, 받을 때 `JSON.parse`.

## ⑭ override 차단 (3.4, `validateStateChange`)

```ts
validateStateChange(_nextState: ChattingRoomState, source: Connection | "server"): void {
  if (source !== "server") throw new Error("cant do this.");
}
```

저장 **전에** 실행되고 throw하면 거부된다. ⚠️ `@callable` 경유 변경은 서버 실행이라 source가 `"server"` — 이 검사는 직접 override만 막는다. **── 여기까지가 3.4.** (3.6 데모 때 잠시 주석 처리)

## ⑮ 닉네임 폼 + query/enabled (3.5, `src/App.tsx`)

```tsx
const [nickname, setNickname] = useState("");
const [ready, setReady] = useState(false);

const agent = useAgent<ChattingRoomAgent, ChattingRoomState>({
  agent: "chatting-room-agent",
  query: { nickname },     // 접속 URL 쿼리로 서버에 전달
  enabled: ready,          // false면 연결 안 함 → confirm 시 true로
  ...
});
```

닉네임 confirm 전에는 `<h1>who are you?</h1>` + 입력 폼을 보여주고, 버튼에서 `setReady(true)`.

## ⑯ 연결별 상태 (3.5, `onConnect`)

```ts
onConnect(connection: Connection, ctx: ConnectionContext) {
  const url = new URL(ctx.request.url);
  const nickname = url.searchParams.get("nickname") ?? "anon";
  connection.setState({ nickname });        // 이 연결 전용 상태 (에이전트 state와 별개!)
  this.setState({ currentlyOnline: this.state.currentlyOnline + 1 });
}

onMessage(connection: Connection<{ nickname: string }>, message: WSMessage) {
  const messageObj = {
    nickname: connection.state?.nickname ?? "anon",   // ⚠️ strict: state는 null일 수 있음
    ...
  };
  this.broadcast(JSON.stringify(messageObj));   // 3.5부터 본인 포함 전원 전송으로 변경
}
```

## ⑰ 과거 메시지 (3.5, `loadHistory`)

워커:

```ts
@callable()
loadHistory() {
  const { connection } = getCurrentAgent<ChattingRoomAgent>();  // 호출자 확인용
  return this.sql`SELECT * FROM messages ORDER BY created_at ASC LIMIT 100`;
}
```

프론트:

```tsx
type Message = { id: number; nickname: string; message: string; created_at: number };
const [messages, setMessages] = useState<Message[]>([]);

onOpen: async () => {
  setIsConnected(true);
  const history = (await agent.stub.loadHistory()) as Message[];
  setMessages(history);
},
onMessage: (event) => setMessages((prev) => [...prev, JSON.parse(event.data)]),
```

⚠️ 브로드캐스트 메시지에는 `id`가 없다(INSERT 결과를 안 돌려줌) → 목록 key는 `created_at`. 체크포인트: 새로고침해도 대화가 남고, 닉네임이 표시된다. **── 여기까지가 3.5.**

## ⑱ 읽기 전용 연결 (3.6)

```ts
shouldConnectionBeReadonly(_connection: Connection, ctx: ConnectionContext) {
  const url = new URL(ctx.request.url);
  const nickname = url.searchParams.get("nickname") ?? "anon";
  return nickname.includes("read");    // true → 그 연결은 read-only
}
// 동적 전환 버전: this.setConnectionReadonly(connection, true/false)
```

프론트에서 에러 잡기: `onStateUpdateError: () => console.log("cant do that.")`.

- read-only는 프론트 setState + 상태를 바꾸는 @callable까지 차단 (SQL만 읽는 RPC는 허용).
- ⚠️ 우리 `onConnect`가 setState를 하므로 "read" 닉네임은 **접속 즉시** "Connection is read-only" 에러 — 재현 방법이자 함정. **── 여기까지가 3.6.**

## ⑲ 예약 실행 (3.7)

```ts
// onMessage 안: "delete" 포함 메시지가 오면 30초마다 실행 예약
if (message.toString().includes("delete")) {
  this.scheduleEvery(30, "deleteMessages");   // 두 번째 인자 = 이 클래스의 메서드 이름
}

deleteMessages() {
  void this.sql`DELETE FROM messages`;
}
```

변형: `schedule(60, "메서드명")`(초 뒤 한 번) / `schedule(new Date(...), ...)`(특정 시각) / `schedule("0 13 * * 1-5", ...)`(cron) / `listSchedules()` / `cancelSchedule(id)`. 스케줄은 SQLite에 저장 — 재시작에도 살아남는다. 체크포인트: "delete" 보내고 30초 뒤 새로고침 → 메시지 전부 사라짐. **── 여기까지가 3.7.**

---

## 과제에서 바로 꺼내 쓰는 레시피

| 하고 싶은 것 | 쓰는 것 | 위치 |
|---|---|---|
| 프론트에서 서버 함수 실행 | `@callable()` + `agent.stub.메서드()` | ⑩⑪ |
| 실시간 값 하나를 전원과 공유 (접속자 수 등) | state + `setState` | ⑥ |
| 쌓이는 데이터 저장 (메시지, 기록) | `this.sql` (테이블은 `onStart`) | ⑬ |
| 전원에게 보내기 / 일부 제외 | `this.broadcast(문자열, [제외 id])` | ⑬ |
| 접속한 사람마다 다른 값 (닉네임, 권한) | `query` → `onConnect(ctx)` → `connection.setState` | ⑮⑯ |
| 조건 갖춰진 뒤에만 연결 | `enabled` 옵션 | ⑮ |
| connection 인자 없는 메서드에서 호출자 알기 | `getCurrentAgent()` | ⑰ |
| 클라이언트발 상태 변경 막기 | `validateStateChange` 또는 read-only | ⑭⑱ |
| 특정 유저를 보기 전용으로 | `shouldConnectionBeReadonly` / `setConnectionReadonly` | ⑱ |
| 나중에/반복해서 실행 | `schedule` / `scheduleEvery` | ⑲ |
| 특정 그룹에만 보내기 (admin 등) | `getConnections("태그")` + `conn.send` (강의 밖, 문서 참고) | — |

admin 삭제 버튼 과제에 필요한 재료: 닉네임 판별(⑯의 `connection.state`) + `@callable` 삭제 메서드(⑪, 안에서 admin 검증!) + `DELETE FROM messages`(⑲) + 화면 갱신 통지(⑬ broadcast 또는 state).

## 막히면 여기부터

| 증상 | 원인/해결 |
|---|---|
| `cannot find ChattingRoomAgent` | ④의 바인딩 `name` ≠ 클래스 이름 → 똑같이 맞추고 dev 재시작 |
| `Cannot find name 'Env'` (tsc) | ⑦의 tsconfig.app.json types 누락 |
| `pingPongCount is not defined` 류 | App.tsx에서 state 프로퍼티 이름 오타 — 제네릭을 넘겼는지 확인(자동완성이 잡아준다) |
| 화면이 "Connecting..."에서 안 넘어감 | ⑧ routeAgentRequest를 아직 안 넣었거나 dev 서버 재시작 필요. 3.5부터는 `enabled: ready`라 confirm을 눌러야 연결됨 |
| initialState 바꿨는데 반영 안 됨 | 정상 — 최초 생성 때만 적용. `.wrangler/` 지우고 dev 재시작 |
| 데코레이터에서 Vite 문법 에러 | ⑩의 `agents/vite` 플러그인 누락 |
| `'connection.state' is possibly 'null'` (tsc) | `connection.state?.nickname ?? "anon"`처럼 옵셔널 접근 — setState 전엔 null일 수 있다 |
| override 버튼이 안 먹힘 | 정상 — ⑭ validateStateChange가 차단 중 ("cant do this.") |
| 접속하자마자 "Connection is read-only" | 닉네임에 "read" 포함 + onConnect의 setState 충돌 (⑱의 의도된 재현) |
| scheduleEvery에서 타입 에러 | 두 번째 인자의 메서드가 클래스에 아직 없음 — 메서드 먼저 정의 (⑲) |
| 내 메시지가 내 화면에 안 뜸 | broadcast가 `[connection.id]`로 본인 제외 중 — 3.5처럼 전원 전송으로 바꾸거나 보낸 쪽에서 직접 추가 |
