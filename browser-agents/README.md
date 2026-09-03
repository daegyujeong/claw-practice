# Section 7 — Browser Agents

> Nomad Coders 「Cloudflare Agents」 강의 7챕터 실습 프로젝트.
> AIChatAgent에 **브라우저**를 준다. Cloudflare 서버의 Chrome에 바인딩으로 접속하고, 그 연결을 모델에게 쥐여 주는 두 가지 방식 — Cloudflare가 주는 자동 툴(7.3)과 직접 만드는 Puppeteer 툴(7.4) — 을 실습한다.
> 회차 구성은 강의 코드 저장소(nomadcoders/nomadclaw)의 커밋 체계를 따른다: 7.0 Introduction → (7.1~7.2 Worker Loaders 설명, 코드 없음) → 7.3 Browser Tools → 7.4 Puppeteer Tools → 7.5 File Uploads → 7.6 Public Files → 7.9 Live View.
> 개념 정리는 `../notes/section-07-browser-agents.md`. 챌린지 일정상 Section 5·6은 건너뛰고 7로 왔다.

## 이 챕터에서 배운 것

### 1. 브라우저는 서버에, 워커는 연결만 (7.0)
`npm create cloudflare` React 스타터 + Section 4와 같은 다섯 패키지. `src/App.tsx`는 Section 4.6 시점의 채팅 UI를 그대로 복원(이 챕터에서 프론트는 안 건드린다). wrangler.jsonc에 AI·DO 바인딩 외에 **`"browser": { "binding": "BROWSER" }`**(Browser Rendering — Cloudflare 서버의 Chrome에 접속하는 통로)와 **`"worker_loaders": [{ "binding": "LOADER" }]`**(동적 워커를 띄우는 통로, 배열임에 주의)를 추가하고 `npm run cf-typegen`. 새 wrangler가 만든 `Env`에서 BROWSER의 타입 이름은 `BrowserRun`이다(Browser Rendering의 새 이름).

### 2. 동적 워커가 필요한 이유 (7.1~7.2)
7.3의 브라우저 툴은 **모델이 CDP 조작 코드를 직접 써서** 실행하는 방식이다. 모델이 쓴 코드는 신뢰할 수 없으므로(프롬프트 탈취 → `this.env`의 시크릿 유출) 우리 워커가 아니라 Worker Loaders로 띄운 **격리 워커**(env 없음, `globalOutbound: null`로 외부 fetch 차단)에서 실행하고, 브라우저 조작 함수만 RPC로 넘긴다. 제약: 브라우저 조작 전체가 툴 하나라서 **결과는 항상 모델 컨텍스트로** 돌아간다(6,000토큰에서 잘림).

### 3. createBrowserTools 한 줄 (7.3 Browser Tools)
`createBrowserTools({ browser: env.BROWSER, loader: env.LOADER })`(`agents/browser/ai`)가 툴 두 개를 준다 — `browser_search`(CDP 스펙 검색), `browser_execute`(`cdp.send`로 브라우저 조작). `streamText({ tools: { ...browserTools }, stopWhen: isLoopFinished() })`에 스프레드하면 끝. 내부 실행기가 `@cloudflare/codemode`라 함께 설치한다. 툴 호출마다 새 브라우저 세션을 열고 자동으로 닫는다(호출 사이에 페이지 상태가 안 이어짐).

### 4. Puppeteer로 직접 다루기 (7.4 Puppeteer Tools)
`@cloudflare/puppeteer`(포크 — `launch(바인딩)`만 Cloudflare 전용, 나머지는 원본 Puppeteer API). `getPage()`가 `launch → newPage → setViewport(1280×720)`을 한 번만 하고 필드(`browser`, `page`)에 재사용. `tool()`로 `navigate`(goto → `{ ok, title }`)와 `closeBrowser`를 정의 — 구조는 Section 4.4의 getWeather와 같다. 통제권과 "결과를 모델에 안 보내는 자유"(7.5 스크린샷 → R2의 전제)를 얻는 대신, 할 수 있는 동작을 전부 미리 코드로 써야 한다. 브라우저는 **열린 시간**으로 과금(유휴 60초 후 자동 종료, `keep_alive` 최대 10분)이라 닫는 툴이 필요하다.

## 명령어

| 명령어 | 역할 |
|---|---|
| `npm create cloudflare@latest browser-agents` | Framework Starter → React → TypeScript로 생성 |
| `npm install agents @cloudflare/ai-chat ai zod workers-ai-provider` | Section 4와 같은 기본 패키지 |
| `npm install @cloudflare/codemode` | 7.3 — createBrowserTools의 동적 워커 실행기 |
| `npm install @cloudflare/puppeteer` | 7.4 — Puppeteer의 Cloudflare 포크 |
| `npm run cf-typegen` | 바인딩(BROWSER, LOADER) 변경 후 `Env` 타입 재생성 |
| `npm run dev` | 로컬 개발 서버 (AI·브라우저 호출은 원격 — 브라우저 시간이 소모된다) |
| `npx tsc -b` / `npx vite build` | 타입 체크 / 번들 검증 (`npm run build`가 둘 다 실행) |
| `npm run deploy` | 빌드 + 배포 |

## 실습 코드 흐름 (7.4 기준)

```
브라우저(App.tsx)                    워커 / BrowserAgent (DO)                       Cloudflare Browser Rendering
sendMessage("go to nomadcoders.co/reviews")
   ───────────────────────────▶ onChatMessage → streamText
                                 모델: navigate({ url }) 호출
                                 execute → getPage()
                                    ├ 없으면 puppeteer.launch(env.BROWSER) ────────▶ Chrome 세션 생성
                                    └ newPage / setViewport
                                 page.goto(url) ────────────────────────────────▶ 페이지 로드
                                 return { ok, title } → 모델 → 최종 답변
   ◀── tool 파트(navigate) + text 파트 스트림
sendMessage("close the browser")
   ───────────────────────────▶ 모델: closeBrowser() → browser.close() ─────────▶ 세션 종료 (과금 정지)

(7.3 방식: 모델 → browser_execute(code) → codemode가 env.LOADER로 격리 워커 생성
           → 워커의 코드가 cdp.send → 우리 워커가 env.BROWSER WebSocket으로 전송 → 결과(≤6,000토큰) → 모델)
```

## 커밋 로드맵

- [x] 7.0 Introduction — 프로젝트 생성, Section 4 UI 복원, 빈 `BrowserAgent extends AIChatAgent<Env>`, `browser` + `worker_loaders` 바인딩, cf-typegen
- [x] 7.3 Browser Tools — `@cloudflare/codemode` 설치, `createBrowserTools({ browser, loader })` → `streamText({ tools: { ...browserTools } })`
- [x] 7.4 Puppeteer Tools — `@cloudflare/puppeteer` 설치, `getPage`/`closeBrowser` 헬퍼, `navigate`·`closeBrowser` 툴로 교체
- [ ] 7.5 File Uploads — `page.screenshot()` → R2 업로드, URL만 모델에 반환
- [ ] 7.6 Public Files — R2 파일을 공개 URL로 서빙
- [ ] 7.9 Live View — 세션 ID 저장 + 프론트가 같은 브라우저 세션에 접속
- 건너뛴 Section 5(Email)·6(Voice)는 챌린지 뒤에 채운다

강사 코드와 다른 점: `routeAgentRequest`에 `await`(Section 3·4와 같은 이유), 7.3의 `this.env.BROWSER as unknown as Fetcher`(wrangler 4.128의 `BrowserRun` 타입 vs agents 0.12.4의 `Fetcher` 요구), 7.4의 `browser?`/`page?` 필드를 `null` 대신 `undefined`로 비우고 `?.`로 접근(strict 모드), `@cloudflare/ai-chat`을 `0.7.1`로 고정(0.7.2가 agents 0.12.4에 없는 export를 요구해 `vite build`가 깨진다).
