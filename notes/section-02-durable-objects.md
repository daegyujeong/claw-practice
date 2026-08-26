# Cloudflare Agents 강의 학습 정리 — Section 2: Durable Objects (입문자용)

> Nomad Coders 「Cloudflare Agents」 강의 Section 2(Durable Objects) 앞부분(2.2 ~ 2.5 + 저장소 격리 데모)을 정리한 학습 노트다.
> 📘 표시가 붙은 부분은 **Cloudflare 공식 문서(developers.cloudflare.com)** 를 참조해 강의에 없던 사실을 보강한 것이다.

---

## 0. 이번 섹션 흐름 한눈에 보기

```
2.2 Using Durable Objects     : 워커로는 안 되는 게 뭔지 + DO 클래스 만들고 바인딩 연결
2.3 Durable Object Lifecycle  : getByName으로 DO 얻기, 메서드 호출, 생명주기와 "RAM"
2.4 Durable Object Storage    : 내장 SQLite("하드디스크"), constructor는 여러 번 실행된다
2.5 Concurrency               : 카운터를 RAM → SQL로 이동, 파라미터 쿼리, 단일 스레드
  + 저장소 격리 데모           : 닉네임별로 DO를 따로 만들어 저장소가 격리됨을 증명
```

Section 1의 결론은 "워커는 무상태(stateless)라 기억을 못 하니 KV에 밖에 둔다"였다. Section 2는 거기서 한 걸음 더 나가 **"그래도 안 되는 앱이 있다 → 그래서 상태를 자기 안에 갖는 Durable Objects가 있다"** 는 이야기다. 최종 목표인 AI 에이전트(Nomad Claw)가 바로 이 Durable Objects 위에 만들어진다.

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

## 7. 실습 코드 뜯어보기 ⑤ — 이름마다 저장소가 완전히 따로 논다 (저장소 격리 데모)

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

## 8. 실습 프로젝트(`introduction-to-durable-objects`) 정리 메모

강의 순서대로 2.2 → 2.3 → 2.4 → 2.5 네 단계로 나눠 학습 주석과 함께 커밋했다. 각 커밋은 `npx tsc --noEmit`과 `npx vitest run`을 통과한 상태다.

- 처음 작성했던 코드에서 `getByName('defualt')`(오타)와 만들어 두고 쓰지 않던 `nickname` 변수를 `getByName(nickname)`으로 연결해 격리 데모가 재현되도록 고쳤다. 오타 상태로도 "그 이름의 DO 하나"가 생겨 동작은 하지만, 배포 후 Data Studio에서 `defualt`라는 이름으로 찾아야 하는 함정이 있었다.
- 강의 코드는 `/` 외의 경로를 전부 404로 보내지만, 2.2에서 만든 `ping()`을 `/ping` 경로로 남겨 두어 DO 연결 확인용으로 쓸 수 있게 했다.
- 테스트는 `SELF.fetch`(워커 → 바인딩 → DO까지 통합)와 `runInDurableObject`(DO 안에 들어가 SQLite 값을 직접 확인)를 함께 쓴다. 동시 요청 10개를 보내도 증가가 유실되지 않는 테스트로 단일 스레드 보장을 직접 확인했다.

---

## 9. 핵심 요약

1. **워커는 "누가 같은 서버에 붙는지"를 고를 수 없어서** 채팅·게임·실시간 협업·에이전트를 못 만든다. 상태 있는 서버는 (a) 유일하게 지목 가능하고 (b) 연결 동안 살아 있어야 한다.
2. **Durable Object = 이름당 전 세계에 하나뿐인 작은 컴퓨터.** RAM(클래스 프로퍼티) + 하드디스크(내장 SQLite) + 키보드(메서드)를 갖는다.
3. **직접 `new` 하지 않는다.** `env.DP.getByName('이름')`으로 Cloudflare에 요청하면 있으면 주고 없으면 만든다. 메서드 호출은 사실 네트워크 요청이라 `await`가 필요하다.
4. **요청이 10초쯤 없으면 하이버네이션**되어 RAM(프로퍼티)이 날아가고, 깨어날 때 **constructor가 다시 실행**된다. 📘 (완전 퇴출은 70~140초, WebSocket은 연결 유지)
5. **SQLite는 같은 프로세스에 있어 `await` 없이 동기로 쓴다.** constructor의 스키마 코드는 `CREATE TABLE IF NOT EXISTS`, `INSERT OR IGNORE`로 여러 번 실행돼도 안전하게 쓴다.
6. **값은 `?` 파라미터로 넘긴다** (SQL 인젝션 방지). 읽을 때는 `.one()`(정확히 1행 아니면 예외 📘).
7. **DO는 한 번에 한 요청만 처리**하므로 읽기→쓰기 사이 레이스가 없다. 단, 그 사이에 외부 `await`(fetch 등)를 넣으면 끼어들 수 있다 📘. constructor에서 `await`가 필요하면 `blockConcurrencyWhile`.
8. **이름마다 저장소가 완전히 격리**된다. 사용자별·방별·대화별 서버를 이름만 바꿔 무한히 만들 수 있고, 대시보드 Data Studio에서 객체 하나의 SQLite를 들여다볼 수 있다.
9. **AI 에이전트(Agents SDK)는 이 Durable Objects 위에 만들어진다.** 대화별 메모리·스케줄·실시간 연결이 전부 여기서 나온다.

> 📘 **참고 — 알아두면 좋은 한도**
> SQLite 저장소는 **객체당 10 GB**, 계정 전체는 무료 5 GB / 유료 무제한. 객체 수는 무제한. 객체 하나당 초당 약 1,000 요청(소프트 한도). 요청당 CPU 시간 기본 30초. 무료 플랜은 SQLite 방식 DO만 가능.

---

## 10. 다음 미리보기

이번 범위 다음에 올 내용은 `2.7 Alarms`(정해진 시각에 DO 스스로 깨어나기 — 리마인더 기능의 토대), `2.8 WebSockets` / `2.9 Upgrades`(드디어 실시간 연결), `2.10 Messages`다. 그 다음 Section 3부터 `AgentState`, `Callables` 등 **Agents SDK**로 넘어간다. 지금까지의 흐름을 쌓아 올리면:

```
Workers (무상태 함수)
  └─ Durable Objects (이름당 하나, RAM + SQLite, 단일 스레드)   ← 지금 여기
       └─ + Alarms + WebSockets (스케줄, 실시간)                 ← 다음
            └─ Agents SDK의 Agent 클래스
                 └─ Nomad Claw
```
