# Section 3 — Agent Foundations

> Nomad Coders 「Cloudflare Agents」 강의 3챕터 실습 프로젝트.
> 지난 섹션의 Durable Object 채팅방을 **Agent 클래스**로 다시 만든다. 이번에는 React 프론트엔드까지 (아직 AI는 없음).
> 회차 구성은 강의 코드 저장소(nomadcoders/nomadclaw)의 커밋 체계를 따른다: 3.1 AgentState → 3.2 Callables → 3.3 Messages → 3.4 Storage and Broadcast → 3.5 Authentication → 3.6 Read Only Connections → 3.7 Schedule Tasks.

## 이 챕터에서 배운 것

### 1. Agent 클래스 = 편해진 Durable Object
`agents` 패키지의 `Agent`를 상속하면 DO의 모든 능력(이름당 하나뿐인 인스턴스, 내장 SQLite, WebSocket)에 편한 API가 얹힌다. 결국 DO이므로 wrangler.jsonc에 DO 바인딩 + `new_sqlite_classes` 마이그레이션이 그대로 필요하다. 바인딩 이름은 클래스 이름(`ChattingRoomAgent`)과 맞춘다 — 다르면 `routeAgentRequest`가 에이전트를 못 찾는다.

### 2. state 자동 영속화 (3.1 AgentState)
Agent의 `state`는 일반 JS 객체지만 `this.setState()` 하면 내장 SQLite에 자동 저장되고, 연결된 모든 클라이언트에 브로드캐스트된다. `initialState`는 인스턴스 최초 생성 때 딱 한 번만 적용된다(이후엔 하이버네이션에서 깨어날 뿐). state는 JSON 직렬화 가능해야 하고, 크면 안 된다 — 큰 데이터는 `this.sql`로.

### 3. useAgent 훅 (3.1 AgentState)
프론트엔드에서 `useAgent({ agent, onOpen, ... })` 하나로 WebSocket 연결 + 실시간 상태 구독이 끝난다. API도 fetch도 없다. `agent.state`를 JSX에서 직접 읽어도 갱신되므로 `onStateUpdate` 콜백은 선택이다. 워커 쪽은 `routeAgentRequest(request, env)`가 `/agents/:이름/:인스턴스` URL을 알아서 처리한다. 워커에서 export한 state 타입을 프론트가 import해서 풀스택 타입 안전성을 얻는다.

### 4. @callable — 프론트에서 메서드 호출 (3.2 Callables)
메서드 위에 `@callable()`만 붙이면 프론트에서 `agent.stub.메서드()`로 호출할 수 있다(RPC). 데코레이터 문법 때문에 `vite.config.ts`에 `agents/vite` 플러그인이 필요하다. 프론트가 `agent.setState`로 상태를 직접 덮어쓰는 것(override)도 가능하지만 보안 구멍 — `onStateChanged(state, source)`의 source("server" vs Connection)로 출처를 구분하고, `validateStateChange`나 3.6의 read-only connections로 막는다. 핑퐁 버전 코드는 3.2 커밋에 남아 있다.

### 5. WebSocket 이벤트와 메시지 (3.3 Messages)
핑퐁을 채팅방으로 리팩터링: 상태는 `ChattingRoomState`(접속자 수 `currentlyOnline`)가 되고, `onConnect`/`onClose`가 접속자 수를 갱신하며, `onMessage(connection, message)`가 수신을 처리한다. 프론트는 `agent.send(데이터)`로 보내고 `useAgent`의 `onMessage`(`event.data`)로 받는다. `connection.send`는 보낸 사람에게만 회신한다 — 전원 전송은 3.4에서.

### 6. 메시지는 SQL에, 전송은 broadcast로 (3.4 Storage and Broadcast)
state는 바뀔 때마다 **전체**가 모든 클라이언트에 재전송되므로 쌓이는 데이터(메시지)를 넣으면 안 된다. `onStart`에서 `this.sql`로 messages 테이블을 만들고(재기동마다 불릴 수 있으니 `IF NOT EXISTS`), `onMessage`가 받은 메시지를 INSERT 후 `this.broadcast(문자열, [제외할 id])`로 전송한다. `this.sql`은 태그드 템플릿이라 자동 파라미터 바인딩 — SQL 인젝션에서 안전하다. `validateStateChange`로 클라이언트발 override도 차단했다.

### 7. 닉네임과 히스토리 (3.5 Authentication)
프론트 `useAgent`의 `query: { nickname }`이 접속 URL에 닉네임을 싣고, `enabled: ready`로 닉네임 확정 전에는 연결 자체를 막는다. 서버 `onConnect(connection, ctx)`가 URL에서 닉네임을 꺼내 `connection.setState`(연결별 상태, 하이버네이션에도 유지)에 저장한다. `@callable loadHistory`가 과거 메시지를 내려주고(`getCurrentAgent()`로 호출자 확인), broadcast는 본인 포함 전원 전송으로 바꿔 화면 표시를 `onMessage` 한 곳으로 통일했다.

### 8. 읽기 전용 연결 (3.6 Read Only Connections)
`shouldConnectionBeReadonly(connection, ctx)`가 true를 반환한 연결은 프론트 setState는 물론 상태를 바꾸는 @callable 호출까지 차단된다(SQL만 읽는 RPC는 허용). 동적 전환은 `setConnectionReadonly(connection, true/false)`. 우리 `onConnect`가 setState를 하므로 read-only 연결은 접속 즉시 "Connection is read-only" 에러 — 프론트에선 `onStateUpdateError`로 잡는다.

### 9. 예약 실행 (3.7 Schedule Tasks)
DO의 원래 알람은 한 번에 하나지만 Agent의 schedule API가 감싸준다: `schedule(초|Date|cron, "메서드명", payload?)`, `scheduleEvery(초, ...)`, `listSchedules()`, `cancelSchedule(id)`. 스케줄은 SQLite에 저장돼 재시작·하이버네이션에도 유지된다. 데모: 메시지에 "delete"가 있으면 30초마다 `deleteMessages`(`DELETE FROM messages`) 실행.

## 명령어

| 명령어 | 역할 |
|---|---|
| `npm create cloudflare@latest agent-foundations` | Framework Starter → React → TypeScript로 생성 |
| `npm install agents` | Agent 클래스 + React 훅(`agents/react`) 설치 |
| `npm run dev` | 로컬 개발 서버 (프론트+워커 동시) |
| `npx wrangler types` | 바인딩 변경 후 `Env` 타입 재생성 |
| `npx tsc -b` | 타입 체크 (프론트/워커 프로젝트 전부) |
| `npm run build` | 배포용 빌드 |

## 실습 코드 흐름 (3.7 기준)

```
브라우저                                워커                      ChattingRoomAgent (DO)
닉네임 입력 → confirm (enabled: true)
useAgent ──WS 업그레이드(?nickname=…)──▶ routeAgentRequest ─────▶ shouldConnectionBeReadonly 판정
   │                                                            onConnect: connection.setState({nickname})
   │                                                                       + currentlyOnline+1 (setState)
   ◀── onOpen → await agent.stub.loadHistory() ◀───────────────  SELECT * FROM messages … LIMIT 100
   ├─ agent.send("hi") ──WS───────────────────────────────────▶ onMessage: INSERT INTO messages
   │                                                                       ("delete" 포함 시 scheduleEvery)
   ◀── onMessage(JSON.parse(event.data)) ◀── broadcast(전원) ────┘
   └─ 탭 닫음 ────────────────────────────────────────────────▶ onClose → currentlyOnline-1
                                                                (30초 후 알람 → deleteMessages)
```

## 커밋 로드맵

- [x] 3.0 프로젝트 셋업 — Framework Starter(React+TS), `agents` 설치, ChattingRoomAgent + DO 바인딩/마이그레이션, 프론트 보일러플레이트 정리
- [x] 3.1 AgentState — initialState/setState, increment·decrement, useAgent + onStateUpdate, routeAgentRequest
- [x] 3.2 Callables — @callable, agent.stub 호출, agents/vite 플러그인, override와 onStateChanged(source)
- [x] 3.3 Messages — ChattingRoomState(currentlyOnline), onConnect/onClose/onMessage, 메시지 폼 + agent.send
- [x] 3.4 Storage and Broadcast — onStart 테이블 생성, 메시지 INSERT + broadcast, validateStateChange
- [x] 3.5 Authentication — query/enabled, connection.setState(닉네임), loadHistory + getCurrentAgent
- [x] 3.6 Read Only Connections — shouldConnectionBeReadonly, onStateUpdateError
- [x] 3.7 Schedule Tasks — scheduleEvery("deleteMessages") 데모
- [ ] 과제 — 닉네임에 admin이 포함된 사용자에게만 채팅 기록 전체 삭제 버튼 (상태 변경 + broadcast 조합)
- 다음 섹션: Agent를 상속한 **ChatAgent 클래스**로 진짜 챗봇 만들기
