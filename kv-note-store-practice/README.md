# Practice #2 — KV Note Store

> Nomad Coders 「Cloudflare Agents」 강의 과제(챌린지). Section 1에서 배운 **Workers + KV 바인딩**만으로 노트 저장 API를 만든다.

## 무엇을 만들었나

KV를 저장소로 쓰는 초간단 노트 API. 서버도 DB 설정도 없이, 워커 하나와 KV 네임스페이스 바인딩(`NOTE_KV`) 하나로 동작한다.

| 메서드 | 경로 | 동작 |
|---|---|---|
| `GET` | `/` | 사용법(USAGE) 안내 반환 |
| `POST` | `/notes/:key` | 요청 본문(body)을 `:key`라는 키로 KV에 저장 |
| `GET` | `/notes/:key` | `:key`에 저장된 노트 조회 |
| `GET` | `/notes` | 저장된 키 목록 조회 (`list()` → 키 이름 배열) |
| 그 외 경로 | — | "Wrong path" 안내 + 올바른 사용법 반환 |

## 코드 흐름

```
요청 도착 (fetch 핸들러)
 ├─ GET
 │   ├─ /notes/:key → env.NOTE_KV.get(key) → JSON 응답
 │   ├─ /notes      → env.NOTE_KV.list()  → 키 이름 배열 응답
 │   ├─ /           → USAGE 안내
 │   └─ 그 외        → Wrong path 안내
 └─ POST
     └─ /notes/:key → request.text()로 본문 읽기 → env.NOTE_KV.put(key, note)
```

- 라우팅은 프레임워크 없이 `url.pathname.split('/')`로 직접 처리한다. `"/notes/hello"` → `["", "notes", "hello"]`이므로 `parts[1]`이 리소스, `parts[2]`가 키다.
- `wrangler.jsonc`의 `"remote": true` 덕분에 로컬 `npm run dev` 중에도 실제 원격 KV에 붙는다.

## 명령어

| 명령어 | 역할 |
|---|---|
| `npm run dev` | 로컬 개발 서버 (http://localhost:8787) |
| `npm run deploy` | 배포 (재배포도 같은 명령) |
| `npx wrangler kv namespace create NOTE_KV` | KV 네임스페이스 생성 + 바인딩 추가 |
| `npm run cf-typegen` | 바인딩 변경 후 `Env` 타입 재생성 |
| `curl -X POST <URL>/notes/hello -d "my note"` | 저장 테스트 |
| `curl <URL>/notes/hello` | 조회 테스트 |

## 학습용 예제로서의 한계

- 값이 없는 키를 조회하면 `get()`이 `null`을 반환하는데, 지금은 그대로 `"null"` 문자열이 응답된다 — 404로 구분해주는 게 다음 단계의 개선 거리다.
- KV는 최종 일관성(쓰기 반영 최대 60초)에 같은 키 초당 1회 쓰기 제한이 있어, 동시에 여러 명이 쓰는 실시간 데이터에는 맞지 않는다. 그 한계의 답이 Section 3의 **Durable Objects / Agent 내장 SQL**로 이어진다.

## 커밋 로드맵

- [x] `Practice #2: KV Note Store Practice` — 기본 GET/POST 라우팅과 KV 연동
- [x] `Practice #2: ... - Error Handling` — 잘못된 경로/누락 키 안내
- [x] `Practice #2: ... - Usage Message, deployment` — `GET /` 사용법 안내(과제 요구사항) + 배포
