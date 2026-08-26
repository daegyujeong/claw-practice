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

- 코드상 DO는 `DurableObject`를 extends 한 **named export 클래스**. `wrangler.jsonc`의 `durable_objects.bindings`(class_name ↔ `env.DP`)와 `migrations.new_sqlite_classes`로 등록한다.
- **`new` 하지 않는다.** `env.DP.getByName('이름')` → 있으면 가져오고 없으면 만든다. 같은 이름은 전 세계에 하나만 존재한다는 보장.
- 생명주기: 생성 → Active → Idle → 약 10초 뒤 **하이버네이션**(메모리 제거) → 다음 요청에 재생성. 깨어날 때 **constructor가 다시 실행**된다.

### 3. 내장 SQLite
- DO와 같은 프로세스에 있어서 `sql.exec()`는 **동기** — `await`가 없다.
- constructor가 여러 번 실행되므로 스키마 코드는 `CREATE TABLE IF NOT EXISTS`, `INSERT OR IGNORE`로 멱등하게.
- 값은 `?` 파라미터로 넘긴다 (SQL 인젝션 방지). `.one()`은 정확히 1행이 아니면 예외.
- 개발 중 저장소 초기화: `.wrangler` 폴더 삭제. 실서비스는 마이그레이션.

### 4. 동시성과 격리 (공식 문서 보강 포함)
- DO는 **한 번에 한 요청만** 처리한다 → 읽기→쓰기 사이 레이스가 없다. 단, 그 사이에 `await fetch()` 같은 외부 대기를 넣으면 다른 요청이 끼어들 수 있다.
- constructor에서 `await`가 필요하면 `ctx.blockConcurrencyWhile(async () => …)`.
- 이름마다 RAM·KV·SQLite가 완전히 격리된다. 이름을 사용자/방/대화로 쓰면 그대로 "사용자별 서버"가 된다. 대시보드 **Data Studio**에서 이름별 DO의 SQLite를 직접 조회할 수 있다.
- 한도: SQLite 객체당 10 GB, 객체 수 무제한, 객체당 약 1,000 req/s(소프트), 무료 플랜은 SQLite 방식만.

## 명령어 표
| 명령어 | 역할 |
|---|---|
| `npx create-cloudflare@latest introduction-to-durable-objects` | 프로젝트 생성 (Hello World → Worker only → TypeScript) |
| `npm run cf-typegen` | `wrangler.jsonc` 바인딩 변경 후 `env.DP` 타입 생성 |
| `npm run dev` | 로컬 개발 서버 (http://localhost:8787) — DO·SQLite는 `.wrangler/`에 에뮬레이션 |
| `npm run deploy` | 배포 → 대시보드 Bindings / Data Studio에서 DO 확인 가능 |
| `npx tsc --noEmit` | 타입 체크 |
| `npx vitest run` | 테스트 (`SELF.fetch` 통합 + `runInDurableObject`로 SQLite 직접 확인) |

## 실습 코드: 이름별 SQLite 카운터

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
                            increase():  SELECT total … .one() → UPDATE pongs SET total = ? WHERE id = 1
                                         → "count is N"   (하이버네이션·재시작 후에도 이어짐)
```

동작 확인 포인트: `/?nickname=nico`를 두 번 누르면 2, `/?nickname=lin`은 따로 1부터 — 이름마다 다른 DO. 서버를 껐다 켜도 숫자가 이어진다(SQLite). 배포 후 Data Studio에서 `nico`를 고르면 `pongs` 테이블이 보인다.

## 커밋 로드맵 (강의 원본 저장소 기준)

- [x] 2.2 Using Durable Objects — DO 클래스 + 바인딩 + `getByName` / `ping`
- [x] 2.3 Durable Object Lifecycle — RAM 카운터, 하이버네이션
- [x] 2.4 Durable Object Storage — constructor에서 SQLite 테이블 생성
- [x] 2.5 Concurrency — 카운터를 SQLite로 이동, 파라미터 쿼리, 닉네임별 격리
- [ ] 2.7 Alarms — 정해진 시각에 DO 스스로 깨어나기
- [ ] 2.8 ~ 2.10 WebSockets / Upgrades / Messages — 실시간 연결
- [ ] Section 3 — Agents SDK (`AgentState`, `Callables`)
