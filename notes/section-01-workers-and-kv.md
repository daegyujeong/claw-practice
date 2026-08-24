# Cloudflare Agents 강의 학습 정리 (입문자용)

> Nomad Coders 「Cloudflare Agents」 강의 Section 1을 정리한 학습 노트입니다.
> 📘 표시가 붙은 부분은 **Cloudflare 공식 문서(developers.cloudflare.com)** 를 참조해 강의 내용에 없던 사실을 보강한 것입니다.

---

## 0. 지금까지의 강의 흐름 한눈에 보기

```
① 강의 소개: Cloudflare Agents가 뭔가? + Nomad Claw(최종 결과물) 데모
② 수강 준비: 선수 지식, Cloudflare 요금제
③ Workers 기초: 워커란 무엇인가 + 첫 프로젝트 생성
④ Workers 심화: 런타임 특징, 배포(wrangler)
⑤ Bindings & KV: 상태(state)가 없는 워커에 데이터 저장소 연결하기  ← 커밋 4d96cd7이 여기
```

핵심 줄거리는 하나입니다. **"AI 에이전트를 Cloudflare 위에 만들 건데, 그 기반이 되는 Workers부터 차근차근 배운다."** 아직 AI는 등장하지 않았고, 지금은 토대를 다지는 단계입니다.

---

## 1. 이 강의는 무엇을 만드는가 — Nomad Claw

이 강의의 최종 목표는 **Nomad Claw**라는 풀기능 AI 에이전트를 직접 만드는 것입니다.

### 왜 Cloudflare Agents인가?
- **웹 기반 에이전트**(실시간 통신, 보안, 인증, 복구, 다양한 입력)를 만들기에 가장 적합한 프레임워크라고 소개
- Python 서버 기반 프레임워크와 달리 **서버 관리 부담이 거의 없음**
- **서버리스 과금**: 에이전트가 놀고 있으면 비용 0원, 실제로 동작할 때만 과금 (AI 모델 호출 비용은 별도지만 전반적으로 저렴)

### 데모에서 보여준 Nomad Claw의 기능들 (앞으로 하나씩 만들 것들)
| 기능 | 설명 |
|---|---|
| 스트리밍 채팅 | ChatGPT처럼 실시간으로 답변이 흘러나오고, DB에 대화가 저장됨 |
| 메모리 | `set_context` 툴로 사용자 정보(이름, 취향)를 자동 저장하고 세션이 바뀌어도 기억 |
| 스킬(Skills) | 필요할 때만 프롬프트를 불러오는 방식 (시스템 프롬프트를 안 더럽힘) |
| 문서 Q&A | PDF/CSV/Excel 업로드 후 내용 기반 질의응답 (Vectorize 벡터 DB 활용) |
| 클라이언트 툴 | 서버가 아니라 **사용자 브라우저에서 실행되는 툴** (예: 사용자 시간대 감지) |
| 스케줄/리마인더 | 시간이 되면 에이전트가 **먼저** 말을 걸어옴 |
| 격리된 파일시스템 | 에이전트 전용 샌드박스 파일시스템에서 폴더/파일 생성 |
| 워크플로우 + 인간 승인 | 항공권 예약 같은 긴 작업을 백그라운드로 돌리고 사용자가 승인/거절 |
| 서브 에이전트 | 리서처 1·2·3처럼 병렬로 하위 에이전트를 띄워 동시 조사 |
| MCP | Nomad Claw가 MCP **서버도 되고 클라이언트도 됨** (Claude/GPT에서 호출 가능) |
| 음성 모드 | 실시간 음성 대화 |
| 공유 라이브 브라우저 | 에이전트와 사용자가 **같은 브라우저를 동시에** 조작 (CAPTCHA는 사람이 풀어주기 가능) |
| 자가 툴 제작 | 에이전트가 런타임에 스스로 새 툴을 작성·등록해서 바로 사용 |
| 이메일 인터페이스 | 전용 주소로 메일을 보내면 에이전트가 처리하고 채팅 UI에도 동기화 |

### 수강 전 준비물
- **선수 지식**: React.js, TypeScript, 기초 SQL, 프론트/백엔드 구분에 대한 이해
- **Cloudflare 계정**: 무료 플랜도 되지만 한도가 낮음 (Workers 10만 요청/일, 브라우저 ~10분/일)
- **유료 플랜($5/월) 강력 추천**: Workers 1,000만 요청/일, 브라우저 10시간/일($0.09/시간 추가) 등
- **주의**: 최신(bleeding-edge) 기술이라 API가 버전마다 바뀔 수 있음 → 막히면 ① 공식 문서 확인 → ② 문서의 "View as Markdown"을 AI에게 붙여넣어 질문 → ③ 그래도 안 되면 강의 댓글/GitHub 이슈

---

## 2. Cloudflare Worker란 무엇인가

### 워커 = 서버가 아니라 "함수"
- 워커는 Cloudflare 서버에 업로드해 두는 **하나의 함수**입니다. 누군가 워커의 URL을 호출하면 실행됩니다.
- 동작 방식: 요청이 오면 Cloudflare가 **사용자와 가까운 지역**(독일, 일본 등)에 순간적으로 가상 샌드박스를 만들고 → 함수를 실행하고 → **즉시 파괴**합니다.
- 그래서 **서버에 대한 통제권이 없습니다**: OS 선택 불가, 소프트웨어 설치 불가.
- 대신 **확장성이 엄청납니다**: 100만 명이 동시에 접속하면 그냥 100만 개의 인스턴스가 뜹니다.

> 📘 **공식 문서 보강 — 그 "가상 샌드박스"의 정체는 V8 Isolate**
> 강의에서는 이해를 돕기 위해 "가상 머신을 만들었다 파괴한다"고 표현했지만, 실제로는 컨테이너나 VM이 아니라 **V8 isolate**(Chrome/Node.js에 들어가는 V8 엔진의 경량 격리 컨텍스트)입니다. 하나의 런타임 프로세스 안에서 수백~수천 개의 isolate가 각자 완전히 격리된 메모리로 동시에 실행됩니다.
> - 시작 속도가 컨테이너/VM 위의 Node 프로세스보다 **약 100배 빠르고**, 메모리도 한 자릿수 이상 적게 사용 → 사실상 **콜드 스타트가 없음**
> - 다만 isolate는 리소스 한도 초과 등으로 **언제든 퇴출(evict)될 수 있으므로**, 전역 변수에 상태를 저장하면 안 된다는 결론은 강의 내용과 정확히 일치합니다.

### 가장 중요한 개념: 워커는 Stateless(무상태)
- 워커는 "요청 받기 → 응답 주기 → 죽기"가 전부입니다. **실행 사이에 데이터를 기억하지 못합니다.**
- 예: 워커 안에 `let count = 0`을 두고 증가시켜도, 요청마다/지역마다 다른 인스턴스가 뜨므로 싱가포르 사용자는 `count = 3`, 미국 사용자는 `count = 1`을 보게 됩니다.
- **결론: 유지해야 할 데이터는 반드시 외부 저장소(KV, D1 등)에 둬야 합니다.** → 이게 곧 배울 Bindings/KV의 존재 이유

### 런타임 특징 (Node.js가 아님!)
- 워커는 Cloudflare 자체 JavaScript 런타임에서 돕니다. `Request`, `Response`, `URL`, `FormData` 같은 **표준 Web API**를 사용합니다.
- 대부분의 npm 패키지는 동작하지만, 파일시스템 접근이나 바이너리 설치가 필요한 패키지는 안 됩니다. (`http2`, `os`, child process 등 일부 Node API 미지원)
- `wrangler.jsonc`의 `compatibility_flags: ["nodejs_compat"]`로 Node.js 호환성을 어느 정도 켤 수 있습니다.

### 워커의 트리거(진입점)
워커는 "트리거 함수를 가진 객체"를 default export 합니다.
- **`fetch`**: HTTP 요청이 올 때마다 실행. 이 함수가 있으면 워커에 **공개 URL이 생김**
- **`scheduled`**: cron 스케줄(예: 매주 월요일 새벽 3시)로 실행. URL은 생기지 않음

---

## 3. 프로젝트 만들기 & 배포 (Wrangler)

### 첫 프로젝트 생성
```bash
npx create-cloudflare@latest
```
선택 옵션: 프로젝트명 입력(예: `introduction-to-workers`) → **Hello World** 템플릿 → **Worker Only** → **TypeScript** → agents MD 파일 생성 O, Git O, 즉시 배포는 X. (Wrangler는 이 과정에서 자동 설치됨)

> 팁: 챕터마다 새 폴더/새 프로젝트로 시작해서 코드가 뒤섞이지 않게 관리

### Wrangler = Cloudflare용 CLI 도구
| 명령어 | 역할 |
|---|---|
| `npx wrangler@latest login` | 브라우저가 열리며 Cloudflare 계정 인증 |
| `npm run dev` | 로컬 개발 서버 실행 |
| `npm run deploy` | 프로덕션 배포 (fetch 함수 감지 → 공개 URL 발급, 재배포도 같은 명령) |
| `npm run cf-typegen` | `wrangler.jsonc` 기반으로 TypeScript 타입 재생성 (바인딩 자동완성) |
| `npx wrangler tail` | **배포된** 워커의 실시간 로그 스트리밍 |

### wrangler.jsonc = 워커 설정 파일
- `name`: 워커 이름 (URL에 들어감), 커스텀 도메인 연결도 가능
- `compatibility_flags`: `nodejs_compat` 등
- `kv_namespaces`: KV 바인딩 (아래에서 설명)

---

## 4. Bindings & KV — 무상태 워커에 기억력 달아주기

### Binding(바인딩)이란?
- 워커와 다른 Cloudflare 서비스(KV, D1, Vectorize, Workers AI, Browser Rendering 등)를 **연결해주는 통로**
- **API 키가 필요 없습니다.** `wrangler.jsonc`에 선언만 하면 Cloudflare가 알아서 연결해주고, 코드에서는 마치 설치된 패키지/객체처럼 씁니다.
- 바인딩 이름은 **내 코드에서 부를 변수명일 뿐**이라 아무거나 가능 (`database`, `potato`...). Cloudflare는 내부적으로 서비스 ID로 연결합니다.
- 바인딩을 만들거나 바꾸면 `npm run cf-typegen`을 실행해야 TypeScript가 `env.POTATO`를 인식하고 자동완성됩니다.

> 📘 **공식 문서 보강 — 바인딩은 "권한 + API가 하나로 합쳐진 것"**
> 공식 문서는 바인딩을 "a permission and an API in one piece"라고 정의합니다. 비밀 키가 코드에 아예 존재하지 않으므로 **유출 자체가 불가능**하다는 것이 보안상 핵심 장점입니다.
> - 바인딩 종류는 25가지 이상: KV, **D1**(SQL), **R2**(오브젝트 스토리지), **Durable Objects**, AI, **Vectorize**, Queues, **Workflows**, Browser Rendering, Hyperdrive, Service bindings(워커↔워커), Secrets, 환경변수 등 — Nomad Claw 데모에서 본 기능들이 전부 이 바인딩들의 조합입니다.
> - `env`로 접근하는 방법도 3가지: ① `fetch(request, env, ctx)` 핸들러 인자(강의에서 배운 방식), ② DurableObject/Workflow 클래스의 속성, ③ `import { env } from "cloudflare:workers"` (파일 최상단에서 사용)

### KV(Key-Value) 저장소
- 전 세계에 분산된 키-값 데이터베이스. **모든 값은 문자열(string)** 입니다.
- 워커가 죽거나 다른 지역에서 떠도 **모든 인스턴스가 같은 데이터를 봅니다.** ← 무상태 문제 해결
- 사용 가능한 메서드: `get`, `put`, `delete`, `list`, `getWithMetadata`

> 📘 **공식 문서 보강 ① — KV는 "최종 일관성(eventual consistency)"** ★강의에 없던 가장 중요한 개념
> KV는 중앙 저장소에 데이터를 두고 각 엣지 지역에 **캐시**하는 구조입니다. 그래서:
> - 쓰기(put)는 **쓴 지역에서는 즉시** 보이지만, **다른 지역까지 퍼지는 데 최대 60초 이상** 걸릴 수 있습니다. "모든 인스턴스가 같은 데이터를 본다"는 말은 정확히는 "결국(eventually) 같은 데이터를 보게 된다"입니다.
> - 없는 키를 조회한 결과(null)도 캐시되므로, 방금 만든 키가 다른 지역에서 잠시 안 보일 수 있습니다.
> - 읽기는 캐시에 있으면(hot read) 매우 빠르고, 없으면(cold read) 중앙 저장소까지 다녀와서 느립니다. `cacheTtl` 옵션(기본 60초, 최소 30초)을 늘리면 읽기 성능이 좋아지는 대신 갱신 반영이 늦어집니다.
> - **KV의 용도**: 자주 읽고 가끔 쓰는 데이터(설정, 캐시 등)에 최적. 같은 키를 초당 수십 번 갱신하는 Redis식 워크로드에는 부적합 → 그런 경우 **Durable Objects**(다음 섹션 예고편!)가 정답입니다.

> 📘 **공식 문서 보강 ② — 메서드 상세 옵션**
> - `get(key, type?)`: `type`으로 `"text"`(기본) 외에 `"json"`, `"arrayBuffer"`, `"stream"` 지정 가능 → `"json"`을 쓰면 `JSON.parse`를 직접 안 해도 됨. 키 배열을 넘겨 **한 번에 최대 100개** 벌크 조회도 가능. 없는 키는 `null` 반환.
> - `put(key, value, options?)`: 값은 string 외에 `ReadableStream`, `ArrayBuffer`도 가능(최대 25MiB). `expirationTtl`(초 단위, 최소 60초)로 **자동 만료** 설정 가능, `metadata`(최대 1024바이트 JSON)를 곁들여 저장 가능.
> - **같은 키에는 초당 1회만 쓸 수 있음** — 초과하면 429 에러가 나므로 재시도 로직이나 쓰기 통합이 필요.

> 📘 **공식 문서 보강 ③ — 주요 한도**
>
> | 항목 | 한도 |
> |---|---|
> | 키 크기 | 최대 512바이트 |
> | 값 크기 | 최대 25MiB |
> | 같은 키 쓰기 | 초당 1회 (무료/유료 동일) |
> | 워커 1회 호출당 외부 서비스 작업 | 최대 1,000회 |
> | 무료 플랜 | 읽기 10만/일, (서로 다른 키) 쓰기 1,000/일, 저장 1GB |
> | 유료 플랜 | 읽기·쓰기·저장 무제한 |

### KV 네임스페이스 만들기
```bash
npx wrangler kv namespace create CLAW_KV
```
실행하면 Cloudflare 계정에 KV DB가 생기고, wrangler가 `wrangler.jsonc`에 바인딩 설정을 자동으로 추가해줍니다.

### local vs remote (`remote: true`)
- 바인딩에 `"remote": true`를 넣으면 → 로컬 개발(`npm run dev`) 중에도 **진짜 Cloudflare KV**에 연결
- 빼면 → Cloudflare가 **내 컴퓨터에서 KV를 흉내**냄 (오프라인 개발 가능, 실서비스 데이터 실수로 건드릴 위험 없음)
- 어느 쪽이든 **코드는 완전히 동일**하고 데이터의 출처만 다릅니다. 실사용자가 있다면 local 에뮬레이션 권장. (강의에서는 `remote: true` 사용)

---

## 5. 커밋 4d96cd7 「1.4 Workers KV」 코드 뜯어보기

이 커밋이 바로 위 KV 수업을 코드로 구현한 것입니다. 변경된 파일은 3개뿐입니다.

### ① `wrangler.jsonc` — KV 바인딩 선언
```jsonc
"kv_namespaces": [
  {
    "binding": "POTATO",   // 코드에서 쓸 변수명 (env.POTATO)
    "id": "87ee70e3...",   // 실제 KV 데이터베이스의 ID
    "remote": true,        // 로컬 개발 중에도 진짜 원격 KV에 연결
  },
],
```
"내 워커에 POTATO라는 이름으로 이 KV 데이터베이스를 연결해줘"라는 선언입니다.

### ② `worker-configuration.d.ts` — 타입 자동 생성
```ts
interface Env {
  POTATO: KVNamespace;   // ← npm run cf-typegen이 추가해준 것
}
```
직접 수정하는 파일이 아니라, 타입 생성 명령이 만들어준 결과물입니다. 덕분에 `env.POTATO.`를 치면 자동완성이 뜹니다.

### ③ `src/index.ts` — 방문자 카운터 구현
```ts
export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    console.log(request.cf?.country);           // 요청자의 국가 로그 (wrangler tail로 확인)
    if (url.pathname === '/') {                 // ★ 루트 경로만 카운트
      const count = Number((await env.POTATO.get('count')) ?? 0);
      await env.POTATO.put('count', `${count + 1}`);
      return new Response(`Count is ${count + 1}`);
    }
    return new Response(null, { status: 404 }); // 그 외 경로는 404
  },
} satisfies ExportedHandler<Env>;
```

한 줄씩 이해하기:

1. **`fetch(request, env, ctx)`** — HTTP 요청마다 실행. `request`에는 IP/경로/헤더 등, `env`에는 바인딩(여기선 `POTATO`), `ctx`는 실행 컨텍스트가 들어옵니다.
2. **`url.pathname === '/'` 체크가 왜 필요한가?** — 수업 중 카운트가 **한 번에 2씩** 올라가는 버그가 있었는데, 브라우저가 페이지 요청과 별도로 `/favicon.ico`도 요청해서 워커가 두 번 실행됐기 때문입니다. 루트 경로만 세도록 고쳐서 해결했습니다.
3. **`env.POTATO.get('count')`** — KV에서 값을 읽습니다. 처음엔 값이 없으므로 `?? 0`으로 기본값 처리.
4. **`Number(...)` 변환** — KV의 값은 전부 **문자열**이므로 숫자로 바꿔서 계산해야 합니다.
5. **`put('count', \`${count + 1}\`)`** — 1 증가시킨 값을 다시 문자열로 저장. 이 데이터는 워커가 죽어도, 어느 지역에서 실행돼도 유지됩니다.
6. 실제로 로컬(`localhost`)과 배포된 워커가 **같은 카운트를 공유**하는 것, 그리고 Cloudflare 대시보드의 KV Pairs 메뉴에서 같은 값이 보이는 것까지 확인했습니다.

> 참고: 강의 영상에서는 바인딩 이름 예시로 `database`/`potato`를 썼고, 실제 커밋에서는 대문자 `POTATO`로 정착했습니다. 이름은 정말 아무거나 상관없다는 것을 보여주는 예시입니다.

> 📘 **공식 문서 보강 — 이 카운터는 학습용이지 실전용은 아닙니다**
> KV의 특성을 알고 나면 이 카운터 코드의 한계도 보입니다.
> 1. **초당 1회 쓰기 제한**: 방문자가 초당 2명만 넘어도 같은 `count` 키에 대한 put이 429 에러로 실패할 수 있습니다.
> 2. **레이스 컨디션**: 두 요청이 동시에 `get`(둘 다 5를 읽음) → 각자 `put`(둘 다 6을 씀) 하면 방문 1회가 유실됩니다. KV는 "마지막 쓰기가 이긴다(last write wins)" 방식이라 이를 막아주지 않습니다.
> 3. **전파 지연**: 다른 지역 사용자는 최대 60초 전의 카운트를 볼 수 있습니다.
>
> 정확한 카운터·실시간 상태가 필요하면 **Durable Objects**를 쓰는 것이 정석이고, 강의도 바로 그래서 다음 섹션에서 Durable Objects로 넘어갑니다. 즉 이 예제는 "KV 사용법 + KV의 한계"를 동시에 가르쳐주는 장치입니다.

---

## 6. 핵심 요약

1. **워커는 서버가 아니라 요청마다 생겼다 사라지는 함수다.** 그래서 무한히 확장되지만, 아무것도 기억하지 못한다(stateless).
2. **기억이 필요하면 바인딩으로 외부 저장소를 연결한다.** KV는 그 첫 번째 도구이고, 다음 섹션에서 D1(SQL) 등 더 강력한 옵션이 나온다.
3. **바인딩은 API 키 없는 연결이다.** `wrangler.jsonc`에 선언 → `npm run cf-typegen` → 코드에서 `env.이름`으로 사용.
4. **KV 값은 전부 문자열이다.** 숫자 계산 시 변환 필수.
5. **워커 런타임은 Node.js가 아니라 Web API 기반이다.** (실행 단위는 VM이 아니라 V8 isolate — 그래서 콜드 스타트가 없다 📘)
6. **KV는 최종 일관성이다.** 같은 키 쓰기는 초당 1회, 다른 지역 전파는 최대 60초 — 자주 읽고 가끔 쓰는 데이터용 📘
7. 다음 배울 것: **Durable Objects** — "모든 에이전트의 토대가 되는 가장 중요한 빌딩 블록"이라고 예고됨.

---

## 7. 📘 다음 섹션 미리보기 — 이 강의가 Durable Objects로 가는 이유

공식 문서 기준으로 Cloudflare **Agents SDK**(TypeScript 프레임워크)의 구조를 보면 지금 배우는 순서가 왜 이런지 명확해집니다.

- Agents SDK의 **Agent 클래스**는 에이전트 하나하나에게 **고유한 정체성(durable identity) + 내장 SQL 데이터베이스 + 실시간 WebSocket 연결 + 작업 스케줄링 + 복구 가능한 실행**을 제공합니다.
- Nomad Claw 데모에서 본 "대화가 저장되는 SQL 메모리", "시간 되면 먼저 말 거는 리마인더", "실시간 스트리밍"이 전부 이 Agent 클래스의 기본 기능입니다.
- 그리고 이 Agent 클래스가 바로 **Durable Objects 위에 구축**되어 있습니다. 구조를 쌓아 올리면:

```
Workers (지금 배운 것: 무상태 함수)
  └─ Durable Objects (다음 섹션: 상태를 "가진" 워커 — ID별로 하나씩 존재, 자체 스토리지)
       └─ Agents SDK의 Agent 클래스 (SQL, WebSocket, 스케줄 내장)
            └─ Nomad Claw (최종 목표)
```

지금까지 배운 "워커는 무상태다 → KV로 상태를 밖에 둔다 → 하지만 KV는 동시성·일관성에 약하다"라는 흐름은, **"그래서 상태를 자기 안에 갖는 Durable Objects가 필요하다"** 로 이어지는 빌드업입니다.
