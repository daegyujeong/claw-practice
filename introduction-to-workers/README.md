# Section 1 — Introduction to Workers

> Nomad Coders 「Cloudflare Agents」 강의 1챕터 실습 프로젝트.
> 최종 목표(Nomad Claw AI 에이전트)의 토대인 **Workers · Wrangler · Bindings · KV**를 배운다.

## 이 챕터에서 배운 것

### 1. 워커(Worker)란
서버가 아니라 **요청마다 사용자 근처에서 생겼다 사라지는 함수**다. 실제 실행 단위는 VM/컨테이너가 아니라 **V8 isolate**(경량 격리 컨텍스트)라서 콜드 스타트가 사실상 없고, 100만 동시 요청이 오면 100만 개가 뜰 만큼 확장된다. 대가로 두 가지를 포기한다: 서버 통제권(OS/설치 불가), 그리고 **기억(stateless)** — 전역 변수는 요청/지역마다 리셋된다.

런타임은 Node.js가 아니라 Cloudflare 자체 런타임이며 **표준 Web API**(`Request`, `Response`, `URL` 등)를 쓴다. Node 호환이 필요하면 `compatibility_flags: ["nodejs_compat"]`.

### 2. Wrangler = Cloudflare CLI
| 명령어 | 역할 |
|---|---|
| `npx create-cloudflare@latest` | 프로젝트 생성 (Hello World → Worker Only → TypeScript) |
| `npx wrangler login` | 계정 인증 |
| `npm run dev` | 로컬 개발 서버 (http://localhost:8787) |
| `npm run deploy` | 배포 → 공개 URL 발급 (재배포도 같은 명령) |
| `npm run cf-typegen` | 바인딩 변경 후 타입 재생성 (자동완성 필수) |
| `npx wrangler tail` | 배포된 워커의 실시간 로그 |
| `npx wrangler kv namespace create CLAW_KV` | KV 데이터베이스 생성 + 바인딩 자동 추가 |

### 3. 바인딩(Binding)과 KV
- **바인딩** = 워커와 Cloudflare 서비스(KV, D1, R2, Vectorize, AI...)를 잇는 통로. **API 키 없이** `wrangler.jsonc` 선언만으로 연결되고, 코드에서는 `env.CLAW_KV`처럼 쓴다. 바인딩 이름은 내 마음대로(강의에서는 `POTATO`).
- **KV** = 전 세계 분산 키-값 저장소. 값은 전부 **문자열**. 메서드: `get` / `put` / `delete` / `list` / `getWithMetadata`.
- `"remote": true`를 바인딩에 넣으면 로컬 개발 중에도 진짜 원격 KV에 연결, 빼면 로컬 에뮬레이션(코드는 동일).

### 4. KV의 성격 (공식 문서 보강)
KV는 **최종 일관성(eventually consistent)** 이다 — 쓰기는 그 지역에서만 즉시 보이고 전 세계 반영은 최대 60초. 같은 키에는 **초당 1회**만 쓸 수 있다(초과 시 429). 즉 "자주 읽고 가끔 쓰는" 데이터용이고, 정확한 카운터나 실시간 상태에는 **Durable Objects**(다음 섹션)가 맞다. `src/index.ts`의 카운터는 이 한계를 몸으로 배우기 위한 학습용 예제다.

## 실습 코드: KV 방문자 카운터

```
브라우저 → GET /  →  fetch(request, env, ctx)
                      ├─ pathname !== '/' → 404  (favicon.ico로 2씩 오르는 버그 방지)
                      └─ pathname === '/' → env.CLAW_KV.get('count')  ← 문자열!
                                            → +1 → put('count')
                                            → "Count is N"
```

동작 확인 포인트: `localhost`와 배포된 워커가 **같은 카운트를 공유**하고(remote: true), Cloudflare 대시보드 → KV → KV Pairs에서도 같은 값이 보인다.

## 커밋 로드맵 (강의 원본 저장소 기준)

- [x] 1.0 Your First Worker — 프로젝트 생성, Hello World
- [x] 1.3 Bindings — `wrangler kv namespace create CLAW_KV`
- [x] 1.4 Workers KV — KV 카운터 (이 커밋)
- [ ] Section 2 — Durable Objects: "모든 에이전트의 토대가 되는 가장 중요한 빌딩 블록"
