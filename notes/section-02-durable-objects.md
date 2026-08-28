# Cloudflare Agents 강의 학습 정리 — Section 2: Durable Objects (입문자용)

> Nomad Coders 「Cloudflare Agents」 강의 Section 2(Durable Objects, 2.2 ~ 2.12)를 정리한 학습 노트다.
> 📘 표시가 붙은 부분은 **Cloudflare 공식 문서(developers.cloudflare.com)** 를 참조해 강의에 없던 사실을 보강한 것이다.

---

## 0. 이번 섹션 흐름 한눈에 보기

```
2.2 Using Durable Objects     : 워커로는 안 되는 게 뭔지 + DO 클래스 만들고 바인딩 연결
2.3 Durable Object Lifecycle  : getByName으로 DO 얻기, 메서드 호출, 생명주기와 "RAM"
2.4 Durable Object Storage    : 내장 SQLite("하드디스크"), constructor는 여러 번 실행된다
2.5 Concurrency               : 카운터를 RAM → SQL로 이동, 파라미터 쿼리, 단일 스레드
2.6 저장소 격리 데모           : 닉네임별로 DO를 따로 만들어 저장소가 격리됨을 증명
2.7 Alarms                    : 단일 스레드의 조건, RETURNING, 정해진 시각에 alarm() 호출
2.8 WebSockets                : HTTP vs WebSocket, 워커는 문지기 — 요청을 통째로 DO의 fetch()에
2.9 Upgrades                  : WebSocketPair, acceptWebSocket, 101 응답, 잠들어도 연결 유지
2.10 Messages                 : serializeAttachment로 닉네임, broadcast로 채팅방 완성
2.11 Recap                    : 한도, "Agent = 배관이 깔린 DO"
2.12 Templates                : 섹션별 시작 템플릿 안내
```

Section 1의 결론은 "워커는 무상태(stateless)라 기억을 못 하니 KV에 밖에 둔다"였다. Section 2는 거기서 한 걸음 더 나가 **"그래도 안 되는 앱이 있다 → 그래서 상태를 자기 안에 갖는 Durable Objects가 있다"** 는 이야기다. 최종 목표인 AI 에이전트(Nomad Claw)가 바로 이 Durable Objects 위에 만들어진다. 후반부(2.7~)는 DO만이 할 수 있는 두 가지 — **스스로 깨어나기(알람)** 와 **연결 붙들기(WebSocket)** — 로 채팅방을 완성한다.

---

## 1. 왜 Workers만으로는 부족한가

### 워커는 "요청마다 생겼다 사라지는 함수"
워커는 요청이 오면 사용자와 가까운 지역에 생성되고, 응답하면 곧바로 파괴된다. 그래서 워커 안에 저장한 데이터는 전부 사라진다. Section 1에서는 이걸 KV(데이터베이스)로 해결했다. 사진 업로드·좋아요·댓글 같은 앱은 "코드는 무상태, 데이터는 DB"로 충분히 만들 수 있다.

### 그런데 채팅방은 못 만든다
강의의 예시가 핵심이다. 도쿄 사용자가 접속하면 워커는 일본 지역에 뜬다. 자메이카 사용자가 접속하면 자메이카 지역에 **다른** 워커가 뜬다. 두 워커는 서로를 전혀 모르고, 어느 지역에 뜰지 개발자가 고를 수도 없다. 그러니 "두 사람을 같은 서버에 붙여서 실시간으로 메시지를 주고받게" 하는 것 자체가 불가능하다. KV에 메시지를 저장했다가 나중에 꺼내 볼 수는 있지만 그건 실시간이 아니다.

워커만으로 **만들 수 없는 것들**: 채팅방, 멀티플레이어 게임, 라이브 알림, Figma 같은 실시간 협업 도구, 그리고 **AI 에이전트**.

### 상태가 있는(stateful) 서버의 두 가지 조건
전통적인 채팅 서버는 독일 어딘가에 서버 한 대가 있고, 자메이카·일본·아르헨티나 사용자가 전부 그 서버에 연결된다. 서버는 연결 목록을 메모리에 들고 있다가 한 명이 메시지를 보내면 나머지에게 뿌려준다. 이게 되려면 서버가 반드시:

1. **유일하게 지목 가능해야(uniquely addressable)** 한다 — 모든 사용자가 "그 서버"에 접속할 수 있어야 하고,
2. **연결이 있는 동안 살아 있어야** 한다 — 죽으면 연결이 다 끊기니까.

워커는 둘 다 못 한다. Durable Objects는 둘 다 한다.

### AI 에이전트에 왜 이게 필요한가
"내가 메시지 보내면 → AI가 답한다"는 워커로도 된다(요청-응답). 하지만 Nomad Claw 데모에서 본 "이메일을 보냈더니 에이전트가 **먼저** 채팅창에 말을 걸었다", "예약해 둔 시간에 알아서 알림이 왔다"는 서버가 나(클라이언트)와의 연결(WebSocket)을 계속 붙들고 살아 있어야만 가능하다. 그래서 에이전트에는 Durable Objects가 필수다.

---

## 2. Durable Object란 무엇인가

Durable Object(DO)는 **"서버리스의 장점 + 상태 유지"** 를 합친 것이다. 서버 관리와 스케일링은 여전히 Cloudflare가 해주면서, 다음이 추가된다.

| 속성 | 의미 |
|---|---|
| **전 세계에서 유일한 이름** | 어느 지역에서 요청해도 같은 이름이면 **같은 객체**로 연결됨 |
| **자체 저장소(durable storage)** | 객체마다 **자기만의 SQLite 데이터베이스**가 붙어 있음 |
| 필요할 때 시작, 놀면 종료 | 워커와 같지만, 연결이 유지되는 동안은 살아 있을 수 있음 |
| 처음 요청된 곳 근처에 생성 | 워커처럼 지리적으로 가까운 곳에 만들어짐 |

강의에서 계속 쓰는 비유가 이해에 가장 좋다. **DO 하나 = 작은 컴퓨터 한 대.**

```
┌─────────────── DurablePotato("default") ───────────────┐
│  RAM        : 클래스 프로퍼티 (this.count)  → 재시작하면 날아감 │
│  하드디스크 : ctx.storage.sql (SQLite)     → 재시작해도 남음   │
│  키보드     : 메서드 (increase, ping)       → 외부에서 호출     │
└─────────────────────────────────────────────────────────┘
```

그리고 이 컴퓨터는 이름당 **딱 한 대만** 존재하고, 필요하면 이름을 바꿔가며 수십만 대를 찍어낼 수 있다(room-1, room-2, … / 사용자별 / 대화별).

---

## 3. 실습 코드 뜯어보기 ① — DO 만들고 연결하기 (2.2)

프로젝트 생성은 Section 1과 같다. `npx create-cloudflare@latest introduction-to-durable-objects` → Hello World / Worker only / TypeScript.

### `src/do.ts` — DO는 그냥 "클래스"다
```ts
import { DurableObject } from 'cloudflare:workers';

export class DurablePotato extends DurableObject<Env> {
	ping() {
		return 'pong';
	}
}
```
포인트 세 가지다. `cloudflare:workers`의 `DurableObject`를 **extends** 해야 하고, `export default`가 아니라 **named export**여야 하며(Cloudflare가 클래스 이름으로 찾기 때문), `<Env>` 제네릭으로 이 DO가 어떤 바인딩을 쓸 수 있는지 TypeScript에 알려준다.

### `src/index.ts` — 워커에서 DO 부르기
```ts
export { DurablePotato } from './do';   // Cloudflare가 볼 수 있게 다시 export

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const stub = env.DP.getByName('default');
		return new Response(await stub.ping());
	},
} satisfies ExportedHandler<Env>;
```

### `wrangler.jsonc` — 바인딩 + 마이그레이션
```jsonc
"durable_objects": {
	"bindings": [{ "class_name": "DurablePotato", "name": "DP" }]
},
"migrations": [
	{ "tag": "v1", "new_sqlite_classes": ["DurablePotato"] }
]
```
`class_name`은 export한 클래스 이름 그대로, `name`은 워커 코드에서 부를 이름(`env.DP`)이다. `migrations`는 강의에서 "나중에 설명할 테니 일단 넣어라"라고 한 부분인데, 요지는 **"이 클래스는 SQLite 저장소를 쓰는 DO다"라고 Cloudflare에 등록**하는 것이다. 설정 후 `npm run cf-typegen`을 돌리면 `worker-configuration.d.ts`에 `DP` 타입이 생겨서 `env.DP`에 자동완성이 붙는다.

> 📘 **공식 문서 보강 — 왜 `new_sqlite_classes`인가**
> DO 저장소 백엔드는 예전 KV 방식과 새 SQLite 방식 두 가지가 있는데, **Workers 무료 플랜에서는 SQLite 방식만** 쓸 수 있다. 새로 만드는 DO는 무조건 SQLite 방식을 쓰라는 것이 공식 권장이고, 그래서 `new_sqlite_classes`다. 마이그레이션의 `tag`는 "설정 변경 이력 번호"라서 나중에 클래스 이름을 바꾸거나 삭제할 때 v2, v3로 올려가며 기록한다.

### 왜 굳이 바인딩이 필요한가 — "같은 파일이라도 같은 서버가 아니다"
이게 이 강의에서 가장 중요한 사고방식이다. `do.ts`와 `index.ts`가 같은 프로젝트에 있어도, **워커는 도쿄에서 돌고 DO는 파나마에 살 수 있다.** 코드가 한 곳에 있다고 같은 컴퓨터에서 실행되는 게 아니다. 그래서 워커가 DO에게 말을 걸려면 바인딩이라는 통로가 필요하다.

---

## 4. 실습 코드 뜯어보기 ② — DO 얻기, 호출하기, 생명주기 (2.3)

### `new DurablePotato()`는 절대 안 한다
DO 클래스는 "설계도(blueprint)"다. 인스턴스는 개발자가 만드는 게 아니라 **Cloudflare에 이름으로 요청**한다.

```ts
const dp = env.DP.getByName('default');   // 있으면 가져오고, 없으면 만든다
return new Response(await dp.increase());
```

`getByName('default')`는 그 이름의 DO가 있으면 가져오고 없으면 새로 만들어서 돌려준다. 돌려받는 것을 공식 문서에서는 **stub(스텁)** 이라고 부른다. 그리고 가장 중요한 보장: **Cloudflare 네트워크 전체에서 `default`라는 이름의 DurablePotato는 오직 하나만 존재한다.** 파나마에서 접속하든 독일에서 접속하든 같은 객체를 만난다.

### 메서드 호출에 `await`가 붙는 이유
`increase()`는 `async`도 아닌데 왜 `await`가 필요할까? 겉보기엔 그냥 메서드 호출이지만 실제로는 **DO가 사는 서버로 네트워크 요청을 보내는 것**이기 때문이다(RPC). DO가 자메이카에 있고 사용자가 싱가포르에 있으면 그만큼 시간이 걸린다. "메서드 호출처럼 보이지만 사실은 요청"이라는 걸 기억해야 생명주기가 이해된다.

### 생명주기와 "RAM"
```ts
export class DurablePotato extends DurableObject<Env> {
	count = 0;                       // ← 클래스 프로퍼티 = RAM
	increase() {
		this.count++;
		return `count is ${this.count}`;
	}
}
```

```
  getByName 첫 호출          요청 처리 중           요청 없음            ~10초 경과
 ──────────────▶ [생성/깨어남] ───▶ [Active] ───▶ [Idle] ───▶ [Hibernated: 메모리에서 제거]
                      ▲                                                     │
                      └──────────── 다음 요청이 오면 다시 생성 ◀─────────────┘
```

강의에서 라이브로 보여준 것: 새로고침마다 count가 1, 2, 3… 올라가고, **VPN으로 영국 IP로 바꿔서 접속해도 같은 숫자**가 이어진다(같은 객체라는 증거). 그런데 잠깐 손을 놓고 다시 새로고침하면 count가 1로 돌아간다. **하이버네이션되면 클래스 프로퍼티(RAM)는 전부 날아가기** 때문이다. 그래도 살아 있는 동안은 전 세계 누구나 같은 값을 보니까, "재시작해도 상관없는 공유 상태"에는 여전히 쓸모가 있다.

> 📘 **공식 문서 보강 — 정확한 시간과 조건**
> - 요청·이벤트가 **10초** 동안 없으면 하이버네이션된다. 단, 진행 중인 `setTimeout`/`fetch()`/활성 요청/외부 TCP 연결이 없어야 한다.
> - 하이버네이션이 불가능한 상태로 놀고 있으면 **70~140초** 뒤에 완전히 퇴출(evict)된다.
> - WebSocket 클라이언트는 하이버네이션 중에도 **연결이 유지**된다(뒤에서 배울 WebSocket Hibernation API). 강의에서 "WebSocket이 있으면 2분쯤"이라고 한 것이 이 부분이다.
> - 깨어날 때 **`constructor()`가 다시 실행**된다 — 다음 절의 핵심 전제다.
> - 하이버네이션 시점은 개발자가 통제할 수 없다. "언제든 꺼질 수 있다"고 가정하고 중요한 것은 반드시 저장소에 두어야 한다.

---

## 5. 실습 코드 뜯어보기 ③ — 내장 SQLite "하드디스크" (2.4)

### constructor와 `ctx.storage`
```ts
export class DurablePotato extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS pongs (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				total INTEGER
			);
		`);

		ctx.storage.sql.exec(`
			INSERT OR IGNORE INTO pongs (id, total) VALUES (1, 0);
		`);
	}
	count = 0;
	increase() { ... }   // 아직은 RAM 버전
}
```

`ctx`(DurableObjectState)의 `storage` 안에 세 가지가 있다. **알람**(미래의 특정 시각에 DO를 깨우는 기능 — 1년 뒤도 가능, 뒤에서 배움), **KV**(Section 1의 KV와 같은 API인데 이 객체 전용), 그리고 **`sql`**(이 객체 전용 SQLite). 공식 문서는 이제 KV 대신 SQL을 쓰라고 권장한다.

### `await`가 없다!
KV를 쓸 때는 `await env.CLAW_KV.get()`처럼 항상 기다려야 했다. 네트워크 너머의 저장소였으니까. 그런데 DO의 SQLite는 **DO와 같은 프로세스 안에** 있어서 `sql.exec()`가 **동기(synchronous)** 로 즉시 끝난다.

### constructor는 "여러 번" 실행된다 — 그래서 `IF NOT EXISTS`, `OR IGNORE`
강의에서 `console.log('durable object started')`를 constructor에 넣고 보여줬다. 처음 만들 때 한 번 찍히고, 하이버네이션 뒤 다시 요청하면 **또 찍힌다.** 반면 SQL 데이터는 하이버네이션을 **살아남는다**(하드디스크니까). 두 사실을 합치면:

- 그냥 `CREATE TABLE pongs`라고 쓰면 두 번째 깨어날 때 "이미 있는 테이블"이라며 에러 → **`CREATE TABLE IF NOT EXISTS`**
- 그냥 `INSERT INTO pongs VALUES (1, 0)`이라고 쓰면 두 번째에 "id=1 이미 있음"(PRIMARY KEY 중복) 에러 → **`INSERT OR IGNORE`**

즉 constructor의 SQL은 **"몇 번 실행돼도 결과가 같도록"**(멱등하게) 써야 한다. 이 예제는 `pongs` 테이블에 `id=1, total=0` 행 하나만 두고 그 `total`을 카운터로 쓰는 구조다.

### 어디에 만들어지는가 — location hint와 jurisdiction
기본적으로 DO는 **처음 요청한 사용자와 가까운 지역**에 만들어진다(싱가포르 사용자가 `peter`를 처음 부르면 아시아에 생김). 바꾸고 싶으면:

```ts
// 힌트: "동유럽 근처에 만들어줘" (최선을 다하지만 보장은 없음)
env.DP.getByName('peter', { locationHint: 'eeur' });

// 관할권: "반드시 EU 안에" (법적 보장, getByName 전에 먼저 지정)
env.DP.jurisdiction('eu').getByName('peter');
```

DO는 RAM도 있고 데이터베이스도 있는 "데이터를 들고 있는 컴퓨터"라서, 개인정보 보호법 등 때문에 **데이터가 물리적으로 어디 있는지** 통제해야 할 때 jurisdiction을 쓴다.

> 📘 **공식 문서 보강 — 값 목록과 주의점**
> - `locationHint` 값: `wnam`, `enam`(북미 서/동), `sam`(남미), `weur`, `eeur`(유럽 서/동), `apac`, `apac-ne`, `apac-se`(아시아), `oc`(오세아니아), `afr`, `me`
> - `jurisdiction` 값: `eu`, `us`, `fedramp`
> - **DO는 한 번 만들어지면 위치를 옮기지 않는다**(현재 기준). 처음 만들 때 정한 위치가 계속 간다.
> - `getByName()`은 `idFromName()` + `get()`을 한 번에 하는 단축 메서드다. 다른 자료에서 `env.DP.get(env.DP.idFromName('peter'))`를 보면 같은 뜻이다.

---

## 6. 실습 코드 뜯어보기 ④ — 카운터를 RAM에서 하드디스크로 (2.5)

### 완성된 `src/do.ts`
```ts
import { DurableObject } from 'cloudflare:workers';

export class DurablePotato extends DurableObject<Env> {
	sql: SqlStorage;
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;           // 매번 ctx.storage.sql 쓰기 길어서 줄임
		ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS pongs ( ... );`);
		ctx.storage.sql.exec(`INSERT OR IGNORE INTO pongs (id, total) VALUES (1, 0);`);
	}

	increase() {
		// ① 읽기: 행이 하나뿐이니 .one()으로 바로 객체로 받고, 타입을 알려줌
		const { total } = this.sql.exec(`SELECT total FROM pongs LIMIT 1`).one() as { total: number };
		// ② 쓰기: ?에 total + 1 이 들어감 (파라미터 쿼리)
		this.sql.exec(`UPDATE pongs SET total = ? WHERE id = 1`, total + 1);
		return `count is ${total + 1}`;
	}
}
```
`count = 0` 프로퍼티는 삭제됐다. 이제 값은 SQL에만 있다. 강의에서는 `npm run dev` 서버를 **아예 죽였다가 다시 켜도** 숫자가 이어지는 걸 보여준다. 하드디스크가 생긴 것이다.

### 파라미터 쿼리와 SQL 인젝션
```ts
// ❌ 절대 이렇게 쓰지 말 것
this.sql.exec(`UPDATE pongs SET total = ${total + 1} WHERE id = 1`);
// ✅ 물음표 + 인자 (인자가 여러 개면 순서대로 ?에 대응)
this.sql.exec(`UPDATE pongs SET total = ? WHERE id = ?`, total + 1, 1);
```
값을 문자열에 직접 끼워 넣으면, 사용자 입력이 쿼리에 들어가는 순간 **SQL 인젝션**(입력값에 `; DROP TABLE pongs; --` 같은 SQL을 섞어 넣어 DB를 조작하는 공격)에 노출된다. `?` 자리표시자를 쓰면 Cloudflare가 값을 "SQL 코드"가 아니라 "그냥 값"으로만 취급해서 안전하다.

### 개발 중에 저장소를 통째로 지우는 법
테이블에 컬럼을 추가하고 싶어졌다고 `CREATE TABLE`을 고쳐도 소용없다. 이미 만들어진 테이블은 `IF NOT EXISTS` 때문에 건너뛰니까. 실제 서비스에서는 **마이그레이션**(ALTER TABLE 등)을 써야 하지만, **개발 중(`npm run dev`)이라면 프로젝트의 `.wrangler` 폴더를 삭제**하면 로컬 DO의 SQLite가 전부 초기화된다.

### 레이스 컨디션? — DO는 단일 스레드다
`increase()`는 "읽고(total=3) → 쓰기(4)" 두 단계다. 보통의 서버라면 그 사이에 다른 사용자가 끼어들어 똑같이 3을 읽고 4를 쓰면 한 번 증가가 유실된다(Section 1 KV 카운터가 정확히 이 문제를 갖고 있었다). **DO에서는 이 문제가 없다.** DO 하나는 **한 번에 한 요청만** 처리한다. 사용자 A가 `increase()`를 도는 동안 사용자 B의 `increase()`는 플랫폼이 알아서 기다리게 한다. 개발자가 할 일이 없다.

단일 스레드 DO가 실시간 게임 서버에 유리한 이유도 바로 이것이다. 게임 방 하나 = DO 하나로 만들면, 그 방의 상태 변경이 **항상 한 줄로 서서 순서대로** 처리되므로 잠금(lock)이나 트랜잭션 없이도 상태가 꼬이지 않고, 플레이어 수가 늘어도 방 단위로 자연스럽게 분산된다.

> 📘 **공식 문서 보강 — "단일 스레드"의 정확한 범위** ★강의에서 뭉뚱그린 부분
> DO는 "한 위치, 한 스레드"에서 실행되는 것은 맞지만, 정확히는 **입력 게이트(input gate)** 라는 장치가 동작한다. "저장소 작업이 진행 중인 동안에는 다른 이벤트가 배달되지 않는다"가 규칙이다.
> - 이 예제의 `increase()`는 `await` 없이 동기 SQL만 쓰므로 처음부터 끝까지 원자적(atomic)이다. 강의 설명대로 안전하다.
> - 그러나 메서드 안에서 **`await fetch(...)` 처럼 저장소가 아닌 것을 기다리면, 그 사이에 다른 요청이 끼어들 수 있다.** "읽기 → await fetch → 쓰기" 구조라면 레이스가 다시 생긴다.
> - 규칙: **저장소 읽기와 쓰기 사이에 외부 `await`를 두지 말 것.** 그러면 플랫폼 보장이 그대로 유지된다.
> - `.one()`은 결과가 정확히 1행이 아니면(0행 또는 2행 이상) 예외를 던진다. 행이 하나뿐인 테이블이라도 `LIMIT 1`을 붙이는 편이 안전하다.

### constructor에서 `await`가 필요하면 — `blockConcurrencyWhile`
```ts
constructor(ctx: DurableObjectState, env: Env) {
	super(ctx, env);
	ctx.blockConcurrencyWhile(async () => {
		const res = await fetch('https://...');   // 파일 다운로드, KV 읽기 등
		// ... 초기 설정
	});
}
```
constructor는 `async`일 수 없으니, 초기화에 `await`가 필요하면 이 안에 넣는다. 이 콜백이 끝나기 전까지 **어떤 요청도 DO에 배달되지 않는다.** "완전히 준비된 뒤에만 손님을 받는다"는 보장이다. 강의 프로젝트에서 자주 쓰진 않지만 알아두라고 한 부분이다.

---

## 7. 실습 코드 뜯어보기 ⑤ — 이름마다 저장소가 완전히 따로 논다 (2.6 저장소 격리 데모)

### `src/index.ts` 최종 형태
```ts
export default {
	async fetch(request, env, ctx): Promise<Response> {
		const { pathname, searchParams } = new URL(request.url);
		const nickname = searchParams.get('nickname') ?? 'anon';   // ?nickname=nico
		if (pathname === '/') {
			const dp = env.DP.getByName(nickname);                     // 닉네임 = DO 이름
			return new Response(await dp.increase());
		}
		if (pathname === '/ping') {                                  // DO 연결 확인용
			const dp = env.DP.getByName(nickname);
			return new Response(await dp.ping());
		}
		return new Response(null, { status: 404 });
	},
} satisfies ExportedHandler<Env>;
```

배포(`npm run deploy`) 후 `/`에 접속하면 `anon` DO의 카운트가 오르고, `/?nickname=nico`는 nico의 카운트, `/?nickname=lin`은 lin의 카운트가 **각각 따로** 1부터 시작한다. nico를 두 번 눌러도 lana·lin·anon은 그대로다. **DO마다 RAM도, KV도, SQLite도 완전히 격리**되어 있다는 증명이다.

### Cloudflare 대시보드의 Data Studio
Workers & Pages → 배포한 워커 → Bindings에 DO가 보이고, **Data Studio**에서 DO 이름(예: `lin`)과 jurisdiction을 고르면 **그 객체 하나의 SQLite를 직접 SQL로 조회**할 수 있다. anon의 `pongs.total`이 10 → 새로고침 → 11로 바뀌는 걸 실시간으로 확인할 수 있다. 이것이 곧 아주 유용해지는 이유는, **에이전트가 DO 위에 만들어지고 대화·메모리 등 많은 것이 이 SQLite에 저장되기 때문**이다. 디버깅할 때 여기서 들여다보게 된다.

### 아이디어의 확장
이름 하나당 "RAM + 메서드 + KV + SQLite를 가진 컴퓨터 한 대"를 무한정 찍어낼 수 있다. 이름을 **사용자**로 하면 사용자별 서버, **채팅방**으로 하면 방별 서버, **게임 세션**으로 하면 매치별 서버, **대화**로 하면 대화별 메모리를 가진 에이전트가 된다. 다음 주제로 "실시간(WebSocket)"이 예고됐다.

---

## 8. 실습 코드 뜯어보기 ⑥ — 알람: DO가 스스로 깨어난다 (2.7)

### 먼저 바로잡기 — "단일 스레드"의 정확한 범위
2.5에서 "DO는 한 번에 한 요청만 처리한다"고 배웠다. 2.7의 첫 부분은 그 말의 조건을 분명히 한다. **저장소(자기 SQLite) 안에서만 일하는 동안**은 사용자 A의 `increase()`가 끝날 때까지 B는 기다린다. 그런데 메서드 안에서 `await fetch('https://...')`처럼 **외부 자원을 기다리는 순간 그 잠금이 풀린다.** 그 사이에 B의 `increase()`가 시작될 수 있고, 같은 메서드 두 개가 동시에 도는 상황이 된다. "읽기 → `await fetch` → 쓰기" 구조를 만들면 KV 카운터에서 봤던 레이스가 그대로 돌아온다. (6절의 📘 블록이 바로 이 이야기다.)

### `RETURNING` — 읽기와 쓰기를 한 문장으로
```ts
// 2.5 버전: 두 단계 (읽고 → 쓰고)
const { total } = this.sql.exec(`SELECT total FROM pongs LIMIT 1`).one() as { total: number };
this.sql.exec(`UPDATE pongs SET total = ? WHERE id = 1`, total + 1);

// 2.7 버전: 한 문장 (올리고 → 올린 값을 바로 돌려받기)
const { total } = this.sql
	.exec('UPDATE pongs SET total = total + 1 WHERE id = 1 RETURNING total;')
	.one() as { total: number };
```
`RETURNING`은 SQLite 문법이다. `UPDATE`가 끝난 뒤의 값을 `SELECT`처럼 돌려주니, "읽기와 쓰기 사이"라는 틈 자체가 문법적으로 사라진다. 위에서 말한 외부 `await` 문제를 애초에 만들지 않는 가장 간단한 습관이다. `.one()`은 2.5와 같다 — 결과 커서에서 유일한 한 행을 객체로 꺼낸다.

### 알람이란
DO에게 **"이 시각에 나를 깨워서 `alarm()`을 실행해 줘"** 라고 예약하는 기능이다. 10초 뒤도 되고 1년 뒤도 된다. 예약해 두고 DO가 하이버네이션돼도 상관없다. 시각이 되면 Cloudflare가 DO를 깨워 `alarm()`을 호출한다. 개발자가 살려 둘 필요가 없다. 강의의 예시: 사용자가 가입하면 DO를 만들고 **일주일 뒤 알람**을 걸어 둔다 → 잊어버린다 → 일주일 뒤 `alarm()`에서 후속 이메일을 보낸다.

규칙은 두 가지다. **① DO 하나에 알람은 동시에 하나만**, **② 알람은 `alarm()` 메서드를 호출한다.**

### 완성된 `src/do.ts`
```ts
export class DurablePotato extends DurableObject<Env> {
	sql: SqlStorage;
	constructor(ctx: DurableObjectState, env: Env) { /* 2.4와 같음 */ }

	async increase() {
		const { total } = this.sql
			.exec('UPDATE pongs SET total = total + 1 WHERE id = 1 RETURNING total;')
			.one() as { total: number };

		if (total >= 30) {
			const currentAlarm = await this.ctx.storage.getAlarm();   // 예약된 시각(ms) 또는 null
			if (currentAlarm === null) {
				this.ctx.storage.setAlarm(Date.now() + 10_000);          // 10초 뒤
			}
		}
		return `count is ${total}`;
	}

	alarm() {
		this.sql.exec('UPDATE pongs SET total = 0 WHERE id = 1');
		// 알람이 여러 개 필요하면: alarms 테이블에서 다음 알람을 찾아 setAlarm()
	}
}
```
흐름: 카운터가 30에 닿으면 → 이미 걸린 알람이 있는지 확인(`getAlarm`) → 없으면 10초 뒤로 예약(`setAlarm`) → 10초 뒤 Cloudflare가 `alarm()`을 호출 → 카운터를 0으로. 알람은 한 번 울리면 해제되므로, 다시 30을 넘기면 새로 예약된다. `getAlarm`을 먼저 확인하는 이유는 규칙 ① 때문이다 — `setAlarm`은 기존 알람을 **덮어쓰므로**, 확인 없이 매번 부르면 30, 31, 32… 요청마다 알람이 10초씩 뒤로 밀려 영영 안 울릴 수 있다.

### 실습 중 겪은 함정 — `getAlarm()`에 `await`가 빠지면
```ts
const currentAlarm = this.ctx.storage.getAlarm();   // ❌ Promise 객체가 담긴다
if (currentAlarm === null) { ... }                  //    Promise는 null이 아니므로 항상 false
```
`sql.exec()`가 동기라서 `ctx.storage`의 다른 메서드도 동기일 거라고 생각하기 쉽지만, **`sql.exec()`만 예외**다. `get/put/getAlarm/setAlarm/deleteAlarm`은 모두 Promise를 돌려준다. `await`를 빼먹으면 비교가 항상 거짓이 되어 알람이 절대 예약되지 않는다. 증상은 "`console.log`는 찍히는데 `alarm()`은 안 불린다"이다. 브라우저 콘솔에서 `Promise.resolve(null) === null`을 쳐 보면 `false`가 나온다.

그렇다면 `setAlarm`은 왜 `await` 없이도 되는가? 돌려주는 값을 쓰지 않으니 흐름이 깨지진 않고, 아래 📘의 출력 게이트 덕분에 응답이 나가기 전에 예약이 확정된다. 다만 `await`가 없으면 예약 실패가 조용히 묻히므로(unhandled rejection) 붙여 두는 편이 안전하다.

### 알람이 여러 개 필요하면 — SQL에 목록을 두고 "다음 알람"을 이어 건다
```
alarms 테이블: name | when(시각) | fired(울렸는지)
  "내일"      2026-08-28 09:00   false
  "모레"      2026-08-29 09:00   false

setAlarm(내일)  →  alarm() 실행: 내일 일 처리, fired=true
                   → 테이블에서 아직 안 울린 가장 빠른 알람(모레)을 찾아 setAlarm(모레)
                   → 모레 alarm(): 처리 후 남은 게 없으면 끝
```
DO에는 자기 데이터베이스가 있으니 "예약 목록"은 거기에 두고, **알람이 울릴 때마다 다음 알람을 하나 거는** 방식으로 체인을 만든다. Section 3의 Agents SDK는 이 패턴을 이미 구현해 두어서 알람을 여러 개 걸 수 있다(`schedule()`).

### 실패와 재시도
`alarm()` 안에서 **잡히지 않은 예외**가 나면 실패로 간주되어 Cloudflare가 다시 호출한다. 핸들러는 `alarm(info)`로 `{ retryCount, isRetry }`를 받으므로 "이게 몇 번째 재시도인지"를 알 수 있다. `try/catch`로 삼킨 예외는 실패가 아니다.

> 📘 **공식 문서 보강 — 알람 API의 정확한 동작**
> - `getAlarm()` → `Promise<number | null>` (UNIX epoch 기준 ms). `alarm()` 실행 중에 부르면 `null`이다(이미 소비된 알람이므로).
> - `setAlarm(ms | Date)` → 기존 알람을 **덮어쓴다.** 현재 시각이나 과거를 넣으면 "즉시"에 가깝게 비동기로 실행된다. constructor 안에서 `setAlarm`을 부르면 깨어날 때마다 다음 알람을 덮어써 버리므로 피한다.
> - `deleteAlarm()` → 예약 취소. 이미 실행 중인 `alarm()`은 멈추지 않는다.
> - 실행 보장은 **at-least-once**(최소 한 번). 실패 시 **최대 6회 재시도**, 첫 실패 후 **2초부터 지수 백오프**(2, 4, 8…초). 한 DO에서 `alarm()`은 동시에 하나만 실행된다.
> - 알람은 저장소에 기록되므로 하이버네이션·퇴출·재배포를 넘어 유지된다.
> - `alarm()`의 실행 시간(wall time) 한도는 **15분**이다(HTTP/RPC 요청은 무제한).
> - **출력 게이트(output gate)**: DO는 저장소 쓰기(`put`, `setAlarm`, SQL 쓰기)가 디스크에 확정되기 전까지 바깥으로 응답을 내보내지 않는다. 그래서 `setAlarm`에 `await`를 안 붙여도 응답이 나갈 땐 예약이 끝나 있다. `allowUnconfirmed: true` 옵션으로 이 대기를 끌 수 있지만 기본은 켜 두는 것이 안전하다.
> - `alarm()`은 `async`로 선언하는 것이 관례다 — 플랫폼이 반환된 Promise를 기다렸다가 거부되면 재시도해 준다.

---

## 9. 실습 코드 뜯어보기 ⑦ — 요청을 통째로 DO에게 넘기기 (2.8)

### 여기서부터 DO가 진짜 빛난다
지금까지 한 것(카운터, SQLite)은 사실 워커 + KV로도 흉내 낼 수 있다. 알람은 DO만의 것이지만, DO가 **가장 많이 쓰이는 이유는 실시간**이다. 채팅방, 멀티플레이어 게임, 협업 도구, 그리고 "에이전트가 먼저 말을 거는" 기능은 모두 서버가 클라이언트와의 연결을 붙들고 있어야 한다. 그 도구가 WebSocket이다.

### HTTP와 WebSocket
| | HTTP | WebSocket |
|---|---|---|
| 연결 | 요청 → 응답 → **끊김** | 한 번 열면 누가 닫을 때까지 **유지** |
| 방향 | 클라이언트가 물어야 서버가 답함 | **양방향** — 서버가 먼저 보낼 수 있음 |
| 상태 | 무상태 (그래서 쿠키·세션이 필요) | 연결 자체가 상태 |
| 시작 | — | **HTTP 요청에 `Upgrade` 헤더**를 실어 보내면서 시작 |

WebSocket도 처음엔 HTTP 요청이다. 브라우저가 `Upgrade: websocket` 헤더를 붙여 보내면, 서버는 "이 사람은 WebSocket으로 갈아타고 싶구나"를 알고 연결을 승격(upgrade)한다.

### 구조가 바뀐다 — 워커는 "문지기", DO가 직접 응답
```
[2.2 ~ 2.7]  브라우저 → 워커 ──(dp.increase() 호출)──▶ DO
             브라우저 ◀── 워커가 new Response(...)로 응답  (DO는 HTTP를 모름)

[2.8 ~]      브라우저 → 워커 ──(dp.fetch(request) — 요청 통째로 전달)──▶ DO
             브라우저 ◀────────────── DO가 만든 Response가 그대로 전달 ──┘
```
워커는 요청이 오면 응답하고 **죽는다**. 그러니 워커 안에서 WebSocket을 열어 봤자 곧 끊긴다. 연결을 붙들고 있을 수 있는 건 살아 있고, 이름으로 지목되고, 여러 사람이 같은 것에 붙을 수 있는 DO다. 그래서 워커는 `Upgrade` 헤더가 있는지만 보고 **요청을 통째로** DO에게 넘긴다(문지기). DO가 그 요청으로 연결을 열고 직접 응답한다.

### `src/index.ts` / `src/do.ts`
```ts
// index.ts — 워커
const { pathname, searchParams } = new URL(request.url);
const roomId = searchParams.get('roomId') ?? 'public';   // 닉네임 대신 "방 이름"이 DO 이름
const upgrade = request.headers.get('Upgrade');
if (upgrade) {
	const dp = env.DP.getByName(roomId);
	return dp.fetch(request);                               // 요청을 넘기고, DO의 응답을 그대로 반환
}
return new Response(null, { status: 404 });

// do.ts — DO. 이전의 constructor / increase / alarm은 모두 삭제
export class DurablePotato extends DurableObject<Env> {
	fetch(request: Request) {
		return new Response('hello');
	}
}
```
DO의 `fetch(request)`는 **특별한 메서드**다. 2.3에서 배운 RPC 메서드(`increase`)는 워커가 값을 받아 자기가 응답을 만들었지만, `fetch`는 DO가 HTTP 요청을 받아 HTTP 응답을 돌려주는 "작은 HTTP 서버" 역할이다. 워커 쪽에서 `dp.fetch(request)`를 부르면 그 응답이 곧 사용자에게 가는 응답이 된다. DO 이름이 `roomId`가 되었다는 점도 중요하다 — **방 하나 = DO 하나**, 같은 방에 들어온 사람들은 같은 DO에 붙는다.

> 📘 **공식 문서 보강 — `fetch()` vs RPC 메서드**
> - `fetch(request: Request): Response | Promise<Response>`는 DO가 HTTP 서버처럼 동작하게 하는 핸들러다. 모든 핸들러(`fetch`, `alarm`, `webSocket*`)는 선택 사항이며 `async`여도 된다.
> - 공식 권장: **HTTP 요청/응답 흐름이 아닌 일은 RPC 메서드로**(compatibility date 2024-04-03 이후). WebSocket 승격처럼 "요청 객체 자체"가 필요할 때 `fetch`를 쓴다.
> - 워커에서 `Upgrade` 헤더를 검사할 때 공식 예제는 값이 정확히 `websocket`인지 확인하고, 아니면 **426 Upgrade Required**를 돌려준다. 강의는 존재 여부만 봤다.

---

## 10. 실습 코드 뜯어보기 ⑧ — WebSocket 열기 (2.9)

### `WebSocketPair` — 실 전화기의 양쪽 끝
```ts
export class DurablePotato extends DurableObject<Env> {
	fetch(request: Request) {
		const url = new URL(request.url);
		const nickname = url.searchParams.get('nickname') ?? 'anon';

		const webSocketPair = new WebSocketPair();                 // 양쪽 끝 두 개가 생긴다
		const [client, server] = Object.values(webSocketPair);

		this.ctx.acceptWebSocket(server);                          // server 끝은 DO가 보관

		return new Response(null, { status: 101, webSocket: client });   // client 끝은 브라우저에게
	}

	webSocketMessage(ws: WebSocket, message: string) { console.log(message); }
	webSocketClose(ws: WebSocket) { console.log('someone left'); }
}
```
`new WebSocketPair()`는 **서로 연결된 소켓 두 개**를 만든다. 하나(`client`)는 `101 Switching Protocols` 응답에 실어 브라우저에 주고, 다른 하나(`server`)는 `this.ctx.acceptWebSocket()`으로 DO의 메모리에 보관한다. 이제 브라우저가 `client`에 말하면 DO의 `server`에서 들리고, 반대도 된다. 워커가 아니라 DO여야 하는 이유가 바로 이 `server` 끝을 **계속 들고 있어야** 하기 때문이다.

`acceptWebSocket`을 부르는 순간 DO 클래스에 숨어 있던 메서드 세 개가 활성화된다. 오버라이드만 하면 되고 따로 연결할 게 없다.

| 메서드 | 언제 불리나 |
|---|---|
| `webSocketMessage(ws, message)` | 클라이언트가 메시지를 보냈을 때 |
| `webSocketClose(ws, code, reason, wasClean)` | 클라이언트가 나갔을 때 |
| `webSocketError(ws, error)` | 연결 끊김이 아닌 오류가 났을 때 |

워커 쪽은 `/ws` 경로에서만 승격을 받도록 정리됐다(`if (pathname === '/ws')` 안에 `Upgrade` 검사).

### 터미널에서 붙어 보기
```bash
brew install websocat
websocat "ws://localhost:8787/ws?roomId=private&nickname=nico"
# 연결되면 프롬프트가 안 끝난다 = 연결 유지 중. 타이핑 → Enter → 서버 콘솔에 찍힘
```
`npm run dev` 콘솔에 `GET /ws 101 Switching Protocols`가 찍히면 승격 성공이다. 브라우저 콘솔에서도 한 줄로 확인할 수 있다: `const s = new WebSocket('ws://localhost:8787/ws?nickname=me'); s.onopen = () => s.send('hello')`.

### 하이버네이션되면 연결이 끊기지 않나?
DO는 여전히 조용해지면 잠든다(2.3에서 배운 대로). 그런데 WebSocket 연결은 사실 **DO가 아니라 항상 켜져 있는 Cloudflare 네트워크에** 붙어 있고, Cloudflare가 그것을 내부적으로 DO에 이어 준다.

```
브라우저 ══ WebSocket ══ Cloudflare 네트워크(항상 켜짐) ──내부 전달──▶ DO (잠들 수 있음)
```
그래서 채팅방에 아무 말이 없으면 DO는 잠들지만 연결은 살아 있고, 누군가 메시지를 보내면 Cloudflare가 DO를 깨워 `webSocketMessage`를 호출한다. 조용한 방 수천 개가 열려 있어도 컴퓨팅 비용이 거의 들지 않는다.

> 📘 **공식 문서 보강 — WebSocket Hibernation API**
> - 이것이 되는 건 **`ctx.acceptWebSocket(server)`를 썼기 때문**이다. 표준 방식인 `server.accept()` + `addEventListener('message')`를 쓰면 DO가 연결을 자기 메모리에서 직접 들고 있어야 해서 **하이버네이션이 불가능**하고, 연결이 있는 내내 요금(GB-s)이 붙는다. 강의 방식(Hibernation API)은 잠든 동안 요금이 붙지 않는다.
> - 잠들었다 깨면 **메모리는 초기화되고 constructor가 다시 실행**된다. 연결마다 붙여 둔 정보가 필요하면 다음 절의 `serializeAttachment`를 써야 한다.
> - `acceptWebSocket(ws, tags?)`로 태그를 붙이고 `getWebSockets(tag?)`로 골라낼 수 있다(예: 같은 사용자의 여러 탭).
> - ping/pong 같은 제어 프레임은 런타임이 자동 처리하고 `webSocketMessage`에 오지 않으며 하이버네이션을 깨우지 않는다. compatibility date 2026-04-07 이후에는 Close 프레임 응답도 자동이다.
> - `setTimeout`/`setInterval`, 진행 중인 알람·요청이 있으면 잠들지 못한다. **DO가 클라이언트로 여는** 바깥 방향 WebSocket은 하이버네이션되지 않고 최대 15분까지 DO를 깨워 둔다.
> - **재배포하면 모든 DO가 재시작되어 WebSocket이 전부 끊긴다.** 개발 중 파일을 저장해도 같은 일이 일어난다(강의에서 저장할 때마다 websocat이 끊긴 이유). 클라이언트는 재접속 로직을 가져야 한다.
> - 받는 메시지 크기 한도 **32 MiB**. 여러 작은 메시지보다 50~100ms 단위로 묶어 보내는 편이 효율적이다.

---

## 11. 실습 코드 뜯어보기 ⑨ — 닉네임과 브로드캐스트 (2.10)

### 연결에 데이터 붙이기 — `serializeAttachment`
```ts
this.ctx.acceptWebSocket(server);
server.serializeAttachment({ nickname });          // 이 연결에 작은 데이터를 붙인다

webSocketMessage(ws: WebSocket, message: string) {
	const { nickname } = ws.deserializeAttachment() as { nickname: string };   // 꺼낸다
	...
}
```
URL로 받은 닉네임을 매번 다시 파싱하지 않고 **연결 자체에 붙여 둔다.** 이후 `webSocketMessage`·`webSocketClose`에서 Cloudflare가 넘겨주는 `ws`에서 `deserializeAttachment()`로 꺼내면 "누가 말했는지"를 안다. 사용자 ID, 방 안 역할 같은 것을 넣는 자리다.

### 보낸 사람에게 답하기 — `ws.send()`
핸들러가 받는 `ws`는 지금 메시지를 보낸 바로 그 연결이다. `ws.send('hello, ' + nickname)`이면 그 사람에게만 답이 간다.

### 모두에게 뿌리기 — `broadcast`
클라이언트끼리는 서로 연결돼 있지 않다(P2P가 아니다). 전원이 같은 DO(서버)에 붙어 있으므로, **서버가 받은 메시지를 나머지 전원에게 전달**해야 채팅이 된다.

```ts
broadcast(message: string, exclude?: WebSocket) {
	for (const socket of this.ctx.getWebSockets()) {     // 이 DO에 붙은 모든 연결
		if (socket !== exclude) {
			socket.send(message);
		}
	}
}

webSocketMessage(ws: WebSocket, message: string) {
	const { nickname } = ws.deserializeAttachment() as { nickname: string };
	this.broadcast(`${nickname} said: ${message}`, ws);   // 보낸 본인은 제외
}

webSocketClose(ws: WebSocket) {
	const { nickname } = ws.deserializeAttachment() as { nickname: string };
	this.broadcast(`${nickname} has left the building.`);  // 나간 사람은 이미 없으니 제외 불필요
}
```
`this.ctx.getWebSockets()`가 **이 DO(= 이 방)에 붙어 있는 연결 전부**를 준다. 처음 버전은 보낸 사람에게도 자기 메시지가 되돌아가는 버그가 있었고, `exclude` 인자로 그 연결 하나를 건너뛰게 해서 고쳤다. 방 이름(`roomId`)이 DO 이름이므로 `private` 방의 브로드캐스트는 `public` 방에 절대 새지 않는다 — 2.6의 저장소 격리가 연결 격리로도 이어진 것이다.

nico와 lin이 `private` 방에 각각 websocat으로 붙어서: nico가 "hi" → lin에게만 `nico said: hi`, lin이 나가면 → nico에게 `lin has left the building.` 채팅방 완성이다.

> 📘 **공식 문서 보강 — attachment의 한계**
> - `serializeAttachment(value)`의 값은 구조적 복제(structured clone)가 가능한 것이어야 하고, 직렬화 크기 **최대 16,384바이트(16 KiB)** 다. "작은 식별 정보"용이지 데이터 저장소가 아니다. 큰 것은 SQLite에 두고 attachment에는 키만 넣는다.
> - 값을 바꾸면 다시 `serializeAttachment`를 불러야 반영된다(참조가 아니라 복사본).
> - 연결이 건강한 동안 **하이버네이션을 넘어 유지**되고, 어느 쪽이든 연결을 닫으면 사라진다.
> - `webSocketMessage`의 `message`는 텍스트면 `string`, 바이너리면 `ArrayBuffer`다.

---

## 12. 섹션 마무리와 한도 (2.11), 섹션별 템플릿 안내 (2.12)

### 이 섹션이 곧 에이전트의 뼈대다
Section 3부터 쓰는 **Agent 클래스는 "배관이 미리 깔린 DO"** 다. 지금까지 손으로 한 일이 그대로 메서드로 들어 있다.

| 이번 섹션에서 직접 만든 것 | Agents SDK에서는 |
|---|---|
| `CREATE TABLE messages …` | `messages` 테이블이 이미 있음 |
| `broadcast()` 직접 구현 | `this.broadcast()` 내장 |
| `WebSocketPair` + `acceptWebSocket` + 핸들러 | 실시간 연결이 기본 제공 |
| 알람 하나 + SQL로 다음 알람 체인 | `schedule()`로 여러 개 예약 |
| `getByName(roomId)` | 사용자/대화별 에이전트 인스턴스 |

사용자마다 에이전트를 하나씩 줘도 된다 — 객체 수가 무제한이기 때문이다.

### 한도
| 항목 | 한도 |
|---|---|
| 객체 수 (계정/클래스당) | **무제한** |
| DO 클래스 수 (`wrangler.jsonc`의 class_name) | 계정당 **500**(유료) / 100(무료), 요청 시 상향 가능 |
| 저장소 — 계정당 | 무제한(유료) / 5 GB(무료) |
| 저장소 — 클래스당 | 무제한 |
| 저장소 — **객체 하나당** | **10 GB** |
| 받는 WebSocket 메시지 | 32 MiB |

> 📘 **공식 문서 보강 — SQL 세부 한도와 성능 기준**
> - 테이블당 컬럼 100개, 행/문자열/BLOB 하나 2 MB, SQL 문 길이 100 KB, 바인딩 파라미터(`?`) 쿼리당 100개, `LIKE`/`GLOB` 패턴 50바이트.
> - 요청당 CPU 시간 기본 30초(설정으로 5분까지). 동시 바깥 연결(fetch 등) 요청당 6개.
> - 객체 하나당 초당 약 **1,000 요청이 소프트 한도**다. 넘으면 "overloaded" 오류가 난다. 인기 있는 방 하나에 모두가 몰리면 DO 하나로는 감당이 안 되므로, 방을 쪼개거나(샤딩) 이름 설계를 다시 하는 것이 해법이다.

### 2.12 — 섹션마다 시작 템플릿이 제공된다
각 섹션의 **소개 영상 위에 명령어**가 하나 붙어 있다. 그걸 실행하면 그 섹션의 시작 시점과 같은 폴더(보일러플레이트 삭제, 기본 설정 완료)가 만들어진다. 영상 안에서 "CSS 지워라, 이 코드 복사해라, 위 링크에서 코드 받아라"라고 해도 **따르지 않아도 된다** — 템플릿이 그 상태를 이미 담고 있다. 강사 저장소의 `templates/` 폴더가 그 원본이다.

---

## 13. 실습 프로젝트(`introduction-to-durable-objects`) 정리 메모

강의 순서대로 2.2 → 2.3 → 2.4 → 2.5 네 단계로 나눠 학습 주석과 함께 커밋했다. 각 커밋은 `npx tsc --noEmit`과 `npx vitest run`을 통과한 상태다.

- 처음 작성했던 코드에서 `getByName('defualt')`(오타)와 만들어 두고 쓰지 않던 `nickname` 변수를 `getByName(nickname)`으로 연결해 격리 데모가 재현되도록 고쳤다. 오타 상태로도 "그 이름의 DO 하나"가 생겨 동작은 하지만, 배포 후 Data Studio에서 `defualt`라는 이름으로 찾아야 하는 함정이 있었다.
- 강의 코드는 `/` 외의 경로를 전부 404로 보내지만, 2.2에서 만든 `ping()`을 `/ping` 경로로 남겨 두어 DO 연결 확인용으로 쓸 수 있게 했다.
- 테스트는 `SELF.fetch`(워커 → 바인딩 → DO까지 통합)와 `runInDurableObject`(DO 안에 들어가 SQLite 값을 직접 확인)를 함께 쓴다. 동시 요청 10개를 보내도 증가가 유실되지 않는 테스트로 단일 스레드 보장을 직접 확인했다.
- 2.7 알람 실습에서는 `getAlarm()`에 `await`를 빠뜨려 알람이 걸리지 않는 문제를 겪었다(8절). 2.8부터는 카운터 코드를 지우고 채팅방으로 바꾸므로, 2.7 상태를 커밋으로 남겨 두면 나중에 알람 예제를 다시 볼 수 있다.
- 2.8 ~ 2.10은 `fetch` 전달 → `WebSocketPair` 승격 → attachment/broadcast 순으로 커밋을 나눈다. WebSocket은 `SELF.fetch`에 `Upgrade: websocket` 헤더를 붙여 101이 오는지, `runInDurableObject`로 `getWebSockets().length`가 늘어나는지로 테스트한다.

---

## 14. 핵심 요약

1. **워커는 "누가 같은 서버에 붙는지"를 고를 수 없어서** 채팅·게임·실시간 협업·에이전트를 못 만든다. 상태 있는 서버는 (a) 유일하게 지목 가능하고 (b) 연결 동안 살아 있어야 한다.
2. **Durable Object = 이름당 전 세계에 하나뿐인 작은 컴퓨터.** RAM(클래스 프로퍼티) + 하드디스크(내장 SQLite) + 키보드(메서드)를 갖는다. `new` 하지 않고 `env.DP.getByName('이름')`으로 얻는다.
3. **요청이 10초쯤 없으면 하이버네이션**되어 RAM이 날아가고, 깨어날 때 **constructor가 다시 실행**된다. 그래서 스키마 코드는 `IF NOT EXISTS` / `OR IGNORE`로 멱등하게 쓴다.
4. **SQLite는 같은 프로세스라 `sql.exec()`만 동기**다. `ctx.storage`의 나머지(`get/put/getAlarm/setAlarm`)는 Promise → `await` 필수 📘. 값은 `?` 파라미터로, 읽기+쓰기는 `RETURNING`으로 한 문장에.
5. **DO는 한 번에 한 요청만 처리**하지만, 메서드 안에서 외부 `await`(fetch 등)를 만나면 잠금이 풀려 다른 요청이 끼어든다. 저장소 읽기·쓰기 사이에 외부 `await`를 두지 말 것.
6. **알람은 DO당 하나.** `getAlarm()`으로 확인 → `setAlarm(ms)`로 예약 → 시각이 되면 `alarm()` 호출. 하이버네이션을 넘어 유지되고, 실패하면 최대 6회 지수 백오프 재시도(at-least-once) 📘. 여러 개가 필요하면 SQL에 목록을 두고 다음 알람을 이어 건다.
7. **WebSocket = `Upgrade` 헤더로 시작하는 양방향 상시 연결.** 워커는 문지기로서 요청을 `dp.fetch(request)`로 통째로 넘기고, DO가 `WebSocketPair`를 만들어 `client`는 101 응답에, `server`는 `ctx.acceptWebSocket()`에 준다.
8. **Hibernation API 덕분에 DO가 잠들어도 연결은 Cloudflare가 붙들고 있다** — 메시지가 오면 깨운다. 잠든 동안 요금이 없다 📘. 연결별 정보는 `serializeAttachment`(16 KiB 한도 📘)에, 전체 전송은 `getWebSockets()` 순회(`broadcast`)로.
9. **한도**: 객체 수 무제한, 객체당 SQLite 10 GB, 클래스 500개, 객체당 약 1,000 req/s(소프트) 📘. 재배포하면 모든 WebSocket이 끊긴다 📘.
10. **Agent 클래스는 이 모든 배관이 깔린 DO다.** messages 테이블, broadcast, 실시간 연결, 다중 스케줄이 기본 제공된다.

---

## 15. 다음 섹션 미리보기

Section 2에서 만든 것을 한 줄로 요약하면 **"이름당 하나뿐이고, 자기 DB가 있고, 스스로 깨어나고, 연결을 붙들 수 있는 작은 서버"** 다. Section 3의 Agents SDK는 이 위에 `Agent` 클래스를 얹는다. `this.setState()`로 상태를 두면 연결된 클라이언트 전원에게 자동 브로드캐스트되고(2.10의 `broadcast`), `this.schedule()` / `scheduleEvery()`로 알람을 여러 개 걸 수 있으며(2.7의 알람 체인), `@callable` 메서드는 브라우저에서 RPC처럼 부른다(2.3의 스텁 호출). 지금까지의 흐름:

```
Workers (무상태 함수)
  └─ Durable Objects (이름당 하나, RAM + SQLite, 단일 스레드)
       └─ + Alarms + WebSockets (스케줄, 실시간)                 ← 지금 여기 (Section 2 완료)
            └─ Agents SDK의 Agent 클래스 (AgentState, Callables, schedule)   ← 다음
                 └─ Nomad Claw
```
