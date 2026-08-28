# Section 2 — Introduction to Durable Objects

> Nomad Coders 「Cloudflare Agents」 강의 2챕터 실습 프로젝트.
> "모든 에이전트의 토대가 되는 가장 중요한 빌딩 블록" **Durable Objects**를 배운다.
> 전체 학습 노트: [`notes/section-02-durable-objects.md`](../notes/section-02-durable-objects.md)

## 이 챕터에서 배운 것

### 1. 왜 Durable Objects인가
워커는 요청마다 사용자 근처에서 생겼다 사라지는 함수라 "누가 같은 서버에 붙는지"를 고를 수 없다. 그래서 채팅방·멀티플레이어 게임·실시간 협업·**AI 에이전트**처럼 여러 클라이언트가 한 서버에 붙어 상태를 공유해야 하는 앱은 워커(+KV)만으로는 못 만든다. 상태 있는 서버의 조건은 (a) 유일하게 지목 가능할 것, (b) 연결이 있는 동안 살아 있을 것 — Durable Object(DO)가 이 둘을 서버리스 위에서 제공한다.

### 2. DO = 이름당 전 세계에 하나뿐인 "작은 컴퓨터"
| 구성 | 코드 | 성격 |
|---|---|---|
| RAM | 클래스 프로퍼티 (`this.count`) | 살아 있는 동안만 유지, 하이버네이션되면 초기화 |
| 하드디스크 | `ctx.storage.sql` (SQLite) | 하이버네이션·재배포에도 유지, 객체마다 격리 |
| 키보드 | 메서드 (`increase()`, `ping()`) | 워커가 `await stub.method()`로 호출 (실제로는 RPC) |
| 알람 시계 | `ctx.storage.setAlarm()` → `alarm()` | 정해진 시각에 스스로 깨어남, 하이버네이션을 넘어 유지 |
| 전화선 | `ctx.acceptWebSocket()` → `webSocketMessage()` | 클라이언트와의 상시 연결, 잠들어도 Cloudflare가 붙들어 줌 |

- 코드상 DO는 `DurableObject`를 extends 한 **named export 클래스**. `wrangler.jsonc`의 `durable_objects.bindings`(class_name ↔ `env.DP`)와 `migrations.new_sqlite_classes`로 등록한다.
- **`new` 하지 않는다.** `env.DP.getByName('이름')` → 있으면 가져오고 없으면 만든다. 같은 이름은 전 세계에 하나만 존재한다는 보장.
- 생명주기: 생성 → Active → Idle → 약 10초 뒤 **하이버네이션**(메모리 제거) → 다음 요청에 재생성. 깨어날 때 **constructor가 다시 실행**된다.

### 3. 내장 SQLite
- DO와 같은 프로세스에 있어서 `sql.exec()`는 **동기** — `await`가 없다. 단 `ctx.storage`의 나머지(`getAlarm`, `setAlarm`, `get`, `put`)는 Promise라 `await` 필수.
- constructor가 여러 번 실행되므로 스키마 코드는 `CREATE TABLE IF NOT EXISTS`, `INSERT OR IGNORE`로 멱등하게.
- 값은 `?` 파라미터로 넘긴다 (SQL 인젝션 방지). `.one()`은 정확히 1행이 아니면 예외. 읽기+쓰기는 `UPDATE … RETURNING`으로 한 문장에.
- 개발 중 저장소 초기화: `.wrangler` 폴더 삭제. 실서비스는 마이그레이션.

### 4. 동시성과 격리 (공식 문서 보강 포함)
- DO는 **한 번에 한 요청만** 처리한다 → 읽기→쓰기 사이 레이스가 없다. 단, 그 사이에 `await fetch()` 같은 외부 대기를 넣으면 잠금이 풀려 다른 요청이 끼어들 수 있다.
- constructor에서 `await`가 필요하면 `ctx.blockConcurrencyWhile(async () => …)`.
- 이름마다 RAM·KV·SQLite가 완전히 격리된다. 이름을 사용자/방/대화로 쓰면 그대로 "사용자별 서버"가 된다. 대시보드 **Data Studio**에서 이름별 DO의 SQLite를 직접 조회할 수 있다.

### 5. 알람 (2.7)
- **DO당 알람은 하나.** `await ctx.storage.getAlarm()`이 `null`이면 `ctx.storage.setAlarm(Date.now() + ms)` → 시각이 되면 `alarm()`이 호출된다. `setAlarm`은 기존 알람을 덮어쓰므로 먼저 확인한다.
- 잡히지 않은 예외가 나면 실패 → 최대 6회 지수 백오프 재시도(at-least-once). 핸들러는 `{ retryCount, isRetry }`를 받는다.
- 알람이 여러 개 필요하면 SQL에 목록을 두고, `alarm()`이 울릴 때 다음 알람을 이어 건다.

### 6. WebSocket 채팅방 (2.8 ~ 2.10)
- WebSocket은 `Upgrade` 헤더가 붙은 HTTP 요청으로 시작하는 **양방향 상시 연결**. 워커는 곧 죽으므로 연결을 못 들고, **요청을 통째로 `dp.fetch(request)`로 DO에 넘긴다**(워커 = 문지기, DO = 응답 주체).
- DO의 `fetch()`에서 `new WebSocketPair()` → `client`는 `new Response(null, { status: 101, webSocket: client })`로 브라우저에, `server`는 `this.ctx.acceptWebSocket(server)`로 DO에 보관.
- 그러면 `webSocketMessage(ws, msg)` / `webSocketClose(ws)` / `webSocketError(ws)`가 활성화된다. 연결별 정보는 `ws.serializeAttachment({ nickname })` / `deserializeAttachment()`(16 KiB 한도). 전체 전송은 `this.ctx.getWebSockets()` 순회 = `broadcast(message, exclude?)`.
- **Hibernation API**(`acceptWebSocket`) 덕분에 DO가 잠들어도 연결은 Cloudflare가 유지하고, 메시지가 오면 깨운다. 잠든 동안 요금 없음. 재배포(개발 중 파일 저장 포함)하면 모든 연결이 끊긴다.

### 7. 한도 (2.11)
객체 수 무제한 · 객체당 SQLite 10 GB · 클래스 500개(유료)/100개(무료) · 받는 WebSocket 메시지 32 MiB · 객체당 약 1,000 req/s(소프트) · 무료 플랜은 SQLite 방식만. Section 3의 `Agent` 클래스는 이 모든 배관(messages 테이블, broadcast, 실시간 연결, 다중 스케줄)이 미리 깔린 DO다.

## 명령어 표
| 명령어 | 역할 |
|---|---|
| `npx create-cloudflare@latest introduction-to-durable-objects` | 프로젝트 생성 (Hello World → Worker only → TypeScript) |
| `npm run cf-typegen` | `wrangler.jsonc` 바인딩 변경 후 `env.DP` 타입 생성 |
| `npm run dev` | 로컬 개발 서버 (http://localhost:8787) — DO·SQLite는 `.wrangler/`에 에뮬레이션 |
| `npm run deploy` | 배포 → 대시보드 Bindings / Data Studio에서 DO 확인 가능 |
| `brew install websocat` | 터미널용 WebSocket 클라이언트 설치 |
| `websocat "ws://localhost:8787/ws?roomId=private&nickname=nico"` | 채팅방 접속 (프롬프트가 안 끝나면 연결 유지 중, 타이핑 → Enter로 전송) |
| `npx tsc --noEmit` | 타입 체크 |
| `npx vitest run` | 테스트 (`SELF.fetch` 통합 + `runInDurableObject`로 SQLite 직접 확인) |

## 실습 코드 ①: 이름별 SQLite 카운터 + 알람 (2.2 ~ 2.7)

```
브라우저 → GET /?nickname=nico → fetch(request, env, ctx)          [워커: 문지기]
                                   ├─ nickname = searchParams ?? 'anon'
                                   ├─ '/'     → env.DP.getByName(nickname).increase()
                                   ├─ '/ping' → env.DP.getByName(nickname).ping()
                                   └─ 그 외    → 404 (favicon 중복 카운트 방지)
                                          │
                                          ▼  (RPC — 다른 서버일 수 있음)
                          DurablePotato("nico")                    [DO: 작은 컴퓨터]
                            constructor: CREATE TABLE IF NOT EXISTS pongs / INSERT OR IGNORE (1, 0)
                            increase():  UPDATE pongs SET total = total + 1 … RETURNING total
                                         total >= 30 이고 getAlarm() === null 이면 setAlarm(+10초)
                            alarm():     UPDATE pongs SET total = 0   (10초 뒤 Cloudflare가 호출)
```

동작 확인 포인트: `/?nickname=nico`를 두 번 누르면 2, `/?nickname=lin`은 따로 1부터 — 이름마다 다른 DO. 서버를 껐다 켜도 숫자가 이어진다(SQLite). 30을 넘기면 10초 뒤 0으로 돌아온다(알람). 배포 후 Data Studio에서 `nico`를 고르면 `pongs` 테이블이 보인다.

## 실습 코드 ②: WebSocket 채팅방 (2.8 ~ 2.10)

```
websocat ws://…/ws?roomId=private&nickname=nico
   │ (HTTP + Upgrade: websocket)
   ▼
워커 fetch(): pathname === '/ws' && Upgrade 헤더 있음
   └─ env.DP.getByName(roomId).fetch(request)      ← 요청을 통째로 전달, 응답도 DO 것 그대로
         │
         ▼
DurablePotato("private")                            [방 하나 = DO 하나]
   fetch():   WebSocketPair → acceptWebSocket(server) → serializeAttachment({ nickname })
              → Response 101 + webSocket: client
   webSocketMessage(ws, msg): nickname = ws.deserializeAttachment()
                              broadcast(`${nickname} said: ${msg}`, ws)   ← 본인 제외
   webSocketClose(ws):        broadcast(`${nickname} has left the building.`)
   broadcast(msg, exclude?):  for socket of ctx.getWebSockets(): socket !== exclude → send
```

동작 확인 포인트: 터미널 두 개로 nico·lin이 같은 `roomId`에 접속 → nico의 "hi"는 lin에게만, lin이 끊으면 nico에게 "lin has left the building." 다른 `roomId`끼리는 메시지가 섞이지 않는다. 파일을 저장하면 서버가 재시작되어 연결이 끊기니 다시 접속한다.

## 커밋 로드맵 (강의 원본 저장소 기준)

- [x] 2.2 Using Durable Objects — DO 클래스 + 바인딩 + `getByName` / `ping`
- [x] 2.3 Durable Object Lifecycle — RAM 카운터, 하이버네이션
- [x] 2.4 Durable Object Storage — constructor에서 SQLite 테이블 생성
- [x] 2.5 Concurrency — 카운터를 SQLite로 이동, 파라미터 쿼리, 닉네임별 격리
- [ ] 2.7 Alarms — `RETURNING`, `getAlarm`/`setAlarm`, `alarm()`으로 카운터 리셋
- [ ] 2.8 WebSockets — 워커가 `dp.fetch(request)`로 요청 전달, DO의 `fetch()`
- [ ] 2.9 Upgrades — `WebSocketPair`, `acceptWebSocket`, 101 응답, `webSocketMessage/Close`
- [ ] 2.10 Messages — `serializeAttachment`, `broadcast(message, exclude)`
- [ ] Section 3 — Agents SDK (`AgentState`, `Callables`, `broadcast`, `schedule`)
