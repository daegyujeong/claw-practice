# Section 3 — Agent Foundations

> Nomad Coders 「Cloudflare Agents」 강의 3챕터 실습 프로젝트.
> 지난 섹션의 Durable Object 채팅방을 **Agent 클래스**로 다시 만든다. 이번에는 React 프론트엔드까지 (아직 AI는 없음).

## 이 챕터에서 배운 것

### 1. Agent 클래스 = 편해진 Durable Object
`agents` 패키지의 `Agent`를 상속하면 DO의 모든 능력(이름당 하나뿐인 인스턴스, 내장 SQLite, WebSocket)에 편한 API가 얹힌다. 결국 DO이므로 wrangler.jsonc에 DO 바인딩 + `new_sqlite_classes` 마이그레이션이 그대로 필요하다. 바인딩 이름은 클래스 이름(`ChattingRoomAgent`)과 맞춘다 — 다르면 `routeAgentRequest`가 에이전트를 못 찾는다.

### 2. state 자동 영속화 (3.1)
Agent의 `state`는 일반 JS 객체지만 `this.setState()` 하면 내장 SQLite에 자동 저장되고, 연결된 모든 클라이언트에 브로드캐스트된다. `initialState`는 인스턴스 최초 생성 때 딱 한 번만 적용된다(이후엔 하이버네이션에서 깨어날 뿐). state는 JSON 직렬화 가능해야 하고, 크면 안 된다 — 큰 데이터는 `this.sql`로.

### 3. useAgent 훅 (3.1)
프론트엔드에서 `useAgent({ agent, onOpen, onStateUpdate })` 하나로 WebSocket 연결 + 실시간 상태 구독이 끝난다. API도 fetch도 없다. 워커 쪽은 `routeAgentRequest(request, env)`가 `/agents/:이름/:인스턴스` URL을 알아서 처리한다. 워커에서 export한 state 타입을 프론트가 import해서 풀스택 타입 안전성을 얻는다.

## 명령어

| 명령어 | 역할 |
|---|---|
| `npm create cloudflare@latest agent-foundations` | Framework Starter → React → TypeScript로 생성 |
| `npm install agents` | Agent 클래스 + React 훅(`agents/react`) 설치 |
| `npm run dev` | 로컬 개발 서버 (프론트+워커 동시) |
| `npx wrangler types` | 바인딩 변경 후 `Env` 타입 재생성 |
| `npx tsc -b` | 타입 체크 (프론트/워커 프로젝트 전부) |
| `npm run build` | 배포용 빌드 |

## 실습 코드 흐름

```
브라우저                          워커                        ChattingRoomAgent (DO)
useAgent 훅 마운트 ──WS 업그레이드──▶ routeAgentRequest ──────▶ 인스턴스 생성/깨움
   │                                                          initialState { pingPongCount: 0 }
   ◀───────── onOpen ─────────────────────────────────────────┘ (최초 1회만)
   ◀───────── onStateUpdate(state) ◀── setState 때마다 자동 브로드캐스트
   └─ "Ping pong count: N" 렌더링       └─ SQLite에 자동 저장
```

## 커밋 로드맵

- [x] 3.0 프로젝트 셋업 — Framework Starter(React+TS), `agents` 설치, ChattingRoomAgent + DO 바인딩/마이그레이션, 프론트 보일러플레이트 정리
- [x] 3.1 상태 동기화 — initialState/setState, increment·decrement, useAgent + onStateUpdate, routeAgentRequest
- [ ] 3.2 프론트엔드에서 increment/decrement 호출하기 (예고)
- [ ] 이후: 채팅방 재구현, AI 연결
