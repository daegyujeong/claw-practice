# Practice #4 — Realtime Chat Room (Alarms + WebSockets)

> Section 2 과제: DO 하나에서 WebSocket(실시간 연결)과 Alarm(스스로 깨어나기)을 함께 쓴다.
> 마감: 익일 오전 6시, 배포된 `*.workers.dev` URL 제출.

## 뼈대 상태

| 파일 | 상태 |
|---|---|
| `src/index.ts` | **완성** — `/`는 테스트용 채팅 UI, `/ws`는 Upgrade 확인 후 DO로 전달 |
| `src/do.ts` | **뼈대** — 테이블 생성까지만 완성, 메서드 본문은 TODO (여기가 과제) |
| `wrangler.jsonc` | 완성 — `ChatRoom` ↔ `env.CHAT` 바인딩 |

## 작업 순서

1. `npm install` → `npm run cf-typegen` (Env에 CHAT 타입 생성)
2. `src/do.ts`의 TODO를 위에서부터 채운다: `fetch`(연결 수락) → `broadcast` → `webSocketMessage`(저장+전송) → `alarm`(삭제+재예약)
3. `npm run dev` → 브라우저 탭 두 개로 `http://localhost:8787` 열어 확인
4. `npx tsc --noEmit`으로 타입 체크
5. `npx wrangler deploy` → 나온 `*.workers.dev` URL을 탭 두 개로 다시 확인 후 제출

## 테스트 체크리스트

- [ ] 탭 A에 입력한 메시지가 탭 B에 즉시 나타난다 (반대 방향도)
- [ ] 배포 후 대시보드 Data Studio에서 `messages` 테이블에 행이 쌓이는 게 보인다
- [ ] 메시지를 보내고 5~6분 뒤 Data Studio에서 그 행이 사라져 있다 (알람 동작 증거)
- [ ] `?roomId=other`로 접속한 탭에는 `public` 방 메시지가 안 보인다

## 함정 미리 알기 (노트 8·10절)

- `getAlarm()`은 **Promise** — `await` 없이 `=== null` 비교하면 항상 false라 알람이 안 걸린다.
- `server.accept()`가 아니라 **`this.ctx.acceptWebSocket(server)`** — 전자는 하이버네이션이 안 된다.
- SQL 값은 반드시 `?` 파라미터로.
- 파일을 저장하면 dev 서버가 재시작되어 연결이 끊긴다 — 버그가 아니니 새로고침.
