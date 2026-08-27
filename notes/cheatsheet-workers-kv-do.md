# Cloudflare Workers · KV · Durable Objects 세팅 치트시트

> 강의를 다시 보지 않고도 프로젝트를 처음부터 만들 수 있도록, **어느 파일에 무엇을 쓰고 터미널에 무엇을 치는지**만 모은 자료다.
> 개념 설명은 `section-01-workers-and-kv.md`, `section-02-durable-objects.md`에 있다. 이름(`CLAW_KV`, `NOTE_KV`, `DP`, `DurablePotato`)은 이 저장소에서 실제로 쓴 것을 그대로 썼다.

---

## 0. 공통 — 어떤 프로젝트든 이 순서

```
[터미널]   npx create-cloudflare@latest <프로젝트명>        ① 뼈대 생성 (Hello World → Worker only → TypeScript)
[터미널]   npx wrangler login                                ①' 계정 인증 (컴퓨터당 한 번)
[wrangler.jsonc]   바인딩 선언 (KV / DO / …)                 ② 연결
[터미널]   npm run cf-typegen                                ③ env.XXX 타입 생성 — 바인딩을 바꿀 때마다
[src/*.ts] 코드 작성 — env.XXX 로 바인딩 사용                  ④
[터미널]   npm run dev  →  curl/브라우저로 확인               ⑤ 로컬 실행 (http://localhost:8787)
[터미널]   npx tsc --noEmit  &&  npx vitest run               ⑥ 검증
[터미널]   npm run deploy                                     ⑦ 배포 → https://<name>.<계정>.workers.dev
```

### 파일별 역할

| 파일/폴더 | 역할 | 내가 손대나 |
|---|---|---|
| `wrangler.jsonc` | 워커 이름, 진입 파일, **모든 바인딩 선언** | ✅ 바인딩 추가할 때 |
| `src/index.ts` | 워커 진입점. `fetch(request, env, ctx)` 핸들러 | ✅ |
| `src/do.ts` | Durable Object 클래스 (DO 쓸 때만) | ✅ |
| `worker-configuration.d.ts` | `cf-typegen`이 생성하는 `Env` 타입. **직접 수정 금지** | ❌ 자동 생성 |
| `test/index.spec.ts` | vitest 테스트 | ✅ |
| `.wrangler/` | 로컬 dev의 KV·DO 에뮬레이션 데이터. 지우면 초기화 | 필요할 때 삭제 |
| `node_modules/`, `.wrangler/` | `.gitignore`에 이미 포함 | — |

### 명령어 표

| 명령어 | 언제 |
|---|---|
| `npx create-cloudflare@latest <이름>` | 새 챕터/과제 시작 |
| `npx wrangler login` | 처음 한 번 |
| `npm run cf-typegen` | `wrangler.jsonc` 바인딩을 추가·변경한 직후 |
| `npm run dev` | 로컬 실행. `.wrangler/`에 데이터 저장 |
| `npx tsc --noEmit` | 타입 체크만 |
| `npx vitest run` | 테스트 1회 실행 (`npm test`는 watch 모드) |
| `npm run deploy` (= `npx wrangler deploy`) | 배포. 재배포도 같은 명령 |
| `npx wrangler tail` | 배포된 워커의 실시간 로그 (`console.log` 확인) |
| `npx wrangler kv namespace create <이름>` | KV 저장소 생성 + 바인딩 자동 추가 |

---

## 1. Worker 기본 뼈대 (`src/index.ts`)

```ts
export default {
	async fetch(request, env, ctx): Promise<Response> {
		const { pathname, searchParams } = new URL(request.url);

		// 고정 경로면 "메서드 + 경로"를 키 하나로 만들어 switch — 중첩 if보다 단순
		switch (`${request.method} ${pathname}`) {
			case 'GET /':
				return new Response('usage...');
			case 'POST /something':
				return Response.json({ ok: true });          // JSON + Content-Type 자동
			default:
				return new Response('Not found', { status: 404 });   // 상태 코드를 꼭 명시
		}
	},
} satisfies ExportedHandler<Env>;
```

경로 안에 변하는 값이 있으면(`/notes/:key`) `pathname.split('/')` → `["", "notes", "hello"]`로 쪼개서 `parts[2]`를 쓴다.

요청에서 꺼낼 수 있는 것: `request.method`, `request.headers.get('CF-Connecting-IP')`(방문자 IP), `request.cf?.city` / `request.cf?.country`(위치, Cloudflare가 무료 제공), `await request.text()` / `await request.json()`(본문). `request.cf`와 IP 헤더는 **로컬 dev·테스트에서는 비어 있을 수 있으니** `?? 'unknown'` 기본값을 둔다.

함정: 브라우저는 페이지를 열 때 `/favicon.ico`를 자동 요청한다. 루트(`/`)에서만 카운트하지 않으면 새로고침 1번에 2씩 오른다.

---

## 2. KV 붙이기

### 단계

```
[터미널]        npx wrangler kv namespace create CLAW_KV     ① 저장소 생성 — wrangler.jsonc에 바인딩 자동 추가됨
[wrangler.jsonc] kv_namespaces 확인 (+ "remote": true 선택)   ② 연결
[터미널]        npm run cf-typegen                            ③ env.CLAW_KV 타입
[src/index.ts]  await env.CLAW_KV.get / put / delete / list   ④ 사용
```

### `wrangler.jsonc`

```jsonc
"kv_namespaces": [
	{
		"binding": "CLAW_KV",                          // 코드에서 부를 이름 → env.CLAW_KV
		"id": "87ee70e3350648f5963305d24b20f780",      // ①에서 발급된 실제 ID
		"remote": true                                 // 로컬 dev에서도 진짜 KV 사용 (빼면 로컬 에뮬레이션)
	}
]
```

### API 요약 — 전부 `await` 필요 (네트워크 너머)

| 호출 | 반환 | 메모 |
|---|---|---|
| `await env.CLAW_KV.get('key')` | `string \| null` | 없으면 `null`. `get('key', 'json')`이면 파싱까지 |
| `await env.CLAW_KV.put('key', value)` | — | **value는 문자열**. 숫자는 `` `${n}` ``. `{ expirationTtl: 60 }` 옵션 가능 |
| `await env.CLAW_KV.delete('key')` | — | |
| `await env.CLAW_KV.list()` | `{ keys: [{ name }] }` | 키 목록. `list({ prefix: 'a' })` |

### 함정

- 값은 전부 문자열: `Number((await env.CLAW_KV.get('count')) ?? 0)` 패턴.
- 같은 키 쓰기는 **초당 1회**, 다른 지역 반영은 최대 60초(최종 일관성). 정확한 카운터·실시간 상태에는 부적합 → DO.
- `remote: true`인 프로젝트에서 vitest를 돌리면 실제 KV에 붙으려다 실패할 수 있다 → `vitest.config.mts`에 `remoteBindings: false`.

---

## 3. Durable Object 붙이기

### 단계 — CLI로 "생성"하는 명령은 없다. 코드 + 설정이 전부이고 인스턴스는 첫 요청 때 Cloudflare가 만든다.

```
[src/do.ts]      export class DurablePotato extends DurableObject<Env> { … }     ① 설계도
[src/index.ts]   export { DurablePotato } from './do';                            ② 노출 (진입 파일에서 재export)
[wrangler.jsonc] durable_objects.bindings + migrations                            ③ 등록·연결
[터미널]         npm run cf-typegen                                               ④ env.DP 타입
[src/index.ts]   const stub = env.DP.getByName('global'); await stub.method()     ⑤ 사용
[터미널]         npm run dev → npm run deploy                                      ⑥
```

### `wrangler.jsonc`

```jsonc
"durable_objects": {
	"bindings": [
		{
			"class_name": "DurablePotato",   // ①에서 export 한 클래스 이름과 정확히 일치
			"name": "DP"                     // 코드에서 부를 이름 → env.DP
		}
	]
},
"migrations": [
	{
		"tag": "v1",                                   // 설정 변경 이력 번호. 클래스 이름 변경/삭제 시 v2, v3…
		"new_sqlite_classes": ["DurablePotato"]        // "SQLite 저장소를 쓰는 DO" (무료 플랜은 이 방식만)
	}
]
```

### `src/do.ts` 최소 골격

```ts
import { DurableObject } from 'cloudflare:workers';

export class DurablePotato extends DurableObject<Env> {
	sql: SqlStorage;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
		// constructor는 생성 시 + 하이버네이션에서 깨어날 때마다 실행 → 멱등하게
		this.sql.exec(`CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY AUTOINCREMENT, v INTEGER);`);
		this.sql.exec(`INSERT OR IGNORE INTO t (id, v) VALUES (1, 0);`);   // 초기 행이 필요할 때만
	}

	// 워커가 RPC로 부르는 메서드. 인자/반환값은 JSON처럼 직렬화 가능한 값만
	method(arg: string) {
		return 'result';
	}
}
```

### `src/index.ts` 사용

```ts
export { DurablePotato } from './do';                 // 없으면 "class not found"

const stub = env.DP.getByName('global');              // 이름당 전 세계에 하나. 없으면 만들고 있으면 가져옴
return Response.json(await stub.method('x'));         // 메서드 호출 = 네트워크 요청 → await 필수
```

이름을 바꾸면 다른 DO다: 사용자별이면 `getByName(userId)`, 방별이면 `getByName(roomId)`. `new DurablePotato()`는 절대 쓰지 않는다. 위치를 지정하려면 `getByName('x', { locationHint: 'apac' })` 또는 `env.DP.jurisdiction('eu').getByName('x')`.

### SQL API 요약 — `await` 없음 (같은 프로세스)

| 호출 | 반환 | 메모 |
|---|---|---|
| `this.sql.exec(query, ...args)` | 커서 | `?` 자리표시자에 args가 순서대로. **값을 문자열에 직접 끼우지 말 것**(SQL 인젝션) |
| `.one()` | 행 객체 | **정확히 1행**이 아니면 예외. 행이 없을 수도 있으면 쓰지 말 것 |
| `.toArray()` | 행 배열 | 0행이면 `[]` → `.toArray()[0] ?? 기본값` 패턴 |
| `.toArray() as Row[]` | | TypeScript에 컬럼 타입 알려주기 |

```ts
const { v } = this.sql.exec(`SELECT v FROM t WHERE id = 1`).one() as { v: number };
this.sql.exec(`UPDATE t SET v = ? WHERE id = 1`, v + 1);
const last = this.sql.exec(`SELECT * FROM t ORDER BY id DESC LIMIT 1`).toArray()[0];
const rows = this.sql.exec(`SELECT * FROM t ORDER BY id DESC LIMIT ?`, 100).toArray();
```

SQLite 타입은 `INTEGER`, `TEXT`, `REAL`, `BLOB`만 쓴다(`STRING`은 표준 아님). 시각은 `created_at TEXT DEFAULT CURRENT_TIMESTAMP`.

### 함정

- `request`(IP, `cf`, 헤더)는 워커에만 있다. DO에 필요한 값은 워커에서 뽑아 **메서드 인자로** 넘긴다.
- DO는 한 번에 한 요청만 처리한다. 읽기→쓰기 사이에 `await`가 없으면 레이스 없음. `await fetch()`를 끼우면 깨진다.
- constructor에서 `await`가 필요하면 `ctx.blockConcurrencyWhile(async () => { … })`.
- 클래스 프로퍼티(RAM)는 약 10초 요청이 없으면 하이버네이션으로 사라진다. 남겨야 하면 SQL에.
- 개발 중 스키마를 바꾸고 싶으면 `.wrangler/` 폴더 삭제(로컬 저장소 초기화). 배포된 것은 마이그레이션.

---

## 4. 테스트 골격 (`test/index.spec.ts`)

```ts
import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

it('통합: 워커 → 바인딩 → DO', async () => {
	const res = await SELF.fetch('https://example.com/count');
	expect(await res.json()).toEqual({ count: 0 });
});

it('POST 요청', async () => {
	const res = await SELF.fetch('https://example.com/increment', { method: 'POST', headers: { 'CF-Connecting-IP': '1.2.3.4' } });
	expect(res.status).toBe(200);
});

it('DO 안의 SQLite 직접 확인', async () => {
	const stub = env.DP.getByName('global');
	const row = await runInDurableObject(stub, (_i, state) => state.storage.sql.exec(`SELECT * FROM t`).one());
	expect(row).toMatchObject({ id: 1 });
});
```

같은 이름의 DO는 테스트 사이에도 살아 있을 수 있다 → 테스트마다 다른 이름을 쓰거나, 절대값 대신 "전후 차이"로 검증한다.

---

## 5. 확인 방법

```bash
# 로컬
curl localhost:8787/count
curl -X POST localhost:8787/increment
curl -X POST "localhost:8787/notes/hello" -d "note body"

# 배포 후
curl https://<name>.<계정>.workers.dev/count
npx wrangler tail            # 실시간 로그
```

대시보드(dash.cloudflare.com) → Workers & Pages → 워커 선택: **Bindings**에서 KV/DO 연결 확인, KV는 **KV Pairs**에서 값 확인, DO는 **Data Studio**에서 이름(예: `global`)을 골라 SQLite를 SQL로 직접 조회.

---

## 6. 이름 일치 체크리스트 & 자주 나는 에러

이름이 같아야 하는 곳:

| 무엇 | 어디어디 |
|---|---|
| KV 바인딩 이름 (`CLAW_KV`) | `wrangler.jsonc`의 `binding` ↔ 코드의 `env.CLAW_KV` |
| DO 클래스 이름 (`DurablePotato`) | `do.ts`의 class ↔ `index.ts`의 `export { }` ↔ `class_name` ↔ `new_sqlite_classes` |
| DO 바인딩 이름 (`DP`) | `wrangler.jsonc`의 `name` ↔ 코드의 `env.DP` |

| 증상 | 원인 → 해결 |
|---|---|
| `env.DP`에 빨간 줄 / `Property 'DP' does not exist` | `cf-typegen` 안 돌림 → `npm run cf-typegen` |
| `Class "DurablePotato" not found` / 배포 실패 | `index.ts`에 `export { DurablePotato } from './do'` 누락 |
| `wrangler.jsonc` 파싱 에러 | 블록 앞 항목 뒤에 쉼표 누락 |
| `.one()` 예외 | 0행 또는 2행 이상 → `.toArray()[0]` 또는 `LIMIT 1` |
| `table already exists` | constructor 재실행 → `IF NOT EXISTS` |
| `UNIQUE constraint failed` | 초기 행 재삽입 → `INSERT OR IGNORE` |
| SQL `syntax error` | 컬럼 사이 쉼표 누락, `STRING` 같은 비표준 타입 |
| 로컬에서 IP/도시가 `unknown` | 정상. 배포 후 확인 |
| 새로고침마다 2씩 증가 | `/favicon.ico` → 루트 경로만 처리 |
| KV `429` | 같은 키 초당 1회 초과 |
| vitest가 원격 KV에 붙으려 함 | `remote: true` → vitest 설정에 `remoteBindings: false` |
