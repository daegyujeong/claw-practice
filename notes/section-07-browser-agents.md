# Section 7 — Browser Agents (7.0 ~ 7.4)

> Nomad Coders 「Cloudflare Agents」 강의 Section 7의 학습 노트다. 7.0(셋업)부터 7.4 Puppeteer Tools까지 — 에이전트에게 브라우저를 주는 두 가지 방식(Cloudflare가 주는 자동 툴 vs 직접 만드는 Puppeteer 툴)과 그 사이에 있는 동적 워커(Worker Loaders)의 보안 원리 — 를 정리했다.
> 챌린지 일정상 Section 5(Email)·6(Voice)는 건너뛰고 7로 넘어왔다. 5·6은 나중에 채운다.
> 📘 표시가 붙은 부분은 **Cloudflare 공식 문서(developers.cloudflare.com)와 설치된 SDK(`agents` 0.12.4, `@cloudflare/codemode` 0.3.8, `@cloudflare/puppeteer` 1.4.0)의 소스·타입 정의**를 참조해 강의에 없던 사실을 보강한 것이다.

---

## 0. 강의 흐름 한눈에 보기

```
7.0 Introduction:   browser-agents 프로젝트 + Section 4의 채팅 UI 복원
                    + BrowserAgent extends AIChatAgent (빈 클래스)
                    + wrangler.jsonc에 바인딩 2개 — browser(BROWSER), worker_loaders(LOADER)
                    + npm run cf-typegen
7.1~7.2 Worker Loaders: (코드 없음) 동적 워커란 무엇이고 왜 필요한가
                    — 모델이 브라우저 조작 코드를 "직접 쓴다" → 신뢰할 수 없는 코드
                    → 우리 워커(this.env)가 아니라 격리된 동적 워커에서 실행
                    + 제약: 브라우저에서 나온 결과 = 툴 출력 = 전부 모델 컨텍스트로
7.3 Browser Tools:  createBrowserTools({ browser, loader }) → tools에 스프레드
                    + @cloudflare/codemode 설치 + 툴 2개(browser_search / browser_execute)
                    + 데모: "nomadcoders.co 가서 리뷰 눌러 첫 리뷰 알려 줘"
7.4 Puppeteer Tools: 자동 툴 제거 → @cloudflare/puppeteer 로 브라우저 직접 조작
                    + getPage()(launch → newPage → setViewport) + navigate / closeBrowser 툴
                    + 출력 6,000토큰 잘림 제약 + 브라우저는 열린 시간만큼 과금
─── 이어서: 7.5 File Uploads(스크린샷 → R2) → 7.6 Public Files → 7.9 Live View
```

핵심 줄거리: **"브라우저는 Cloudflare 서버에 있고 우리는 연결만 받는다. 그 연결을 모델에게 어떻게 쥐여 줄지가 이 섹션의 전부다."** 7.3은 모델이 스스로 조작 코드를 쓰게 하는 방식(편하지만 통제권이 적고 결과가 모델 컨텍스트로 흘러간다), 7.4는 우리가 할 일을 툴로 하나하나 정의하는 방식(코드가 늘지만 결과를 우리가 다룬다)이다. 7.1~7.2의 동적 워커는 7.3 방식이 안전하게 돌아가는 이유이고, 7.4의 "결과가 모델로 안 간다"는 7.5(스크린샷 파일 업로드)로 이어진다.

---

## 1. 7.0 Introduction — 프로젝트 셋업

Section 4와 같은 방식(`npm create cloudflare` → React 프레임워크 스타터)으로 `browser-agents`를 만들고, 같은 패키지 다섯 개(`agents`, `@cloudflare/ai-chat`, `ai`, `workers-ai-provider`, `zod`)를 설치한다. `src/App.tsx`는 Section 4의 4.6 시점 UI(툴 파트·승인 UI·Stop·status)를 그대로 붙여 넣는다 — 이 챕터에서 프론트는 손대지 않는다.

서버는 빈 클래스 하나다:

```ts
export class BrowserAgent extends AIChatAgent<Env> {}
```

wrangler.jsonc에는 Section 4의 AI·DO 바인딩에 더해 **새 바인딩 두 개**를 넣고 `npm run cf-typegen`을 돌린다.

| 바인딩 | 설정 | Env 타입 | 역할 |
|---|---|---|---|
| Browser Rendering | `"browser": { "binding": "BROWSER" }` | `BROWSER: BrowserRun` | Cloudflare 서버의 Chrome에 접속하는 통로. 7.3의 `createBrowserTools`와 7.4의 `puppeteer.launch` 둘 다 이걸 받는다 |
| Worker Loaders | `"worker_loaders": [{ "binding": "LOADER" }]` | `LOADER: WorkerLoader` | 런타임에 격리 워커(동적 워커)를 띄우는 통로. 7.3에서 모델이 쓴 코드를 실행하는 데 쓴다 |

`worker_loaders`만 **배열**인 것에 주의 — 이름이 다른 로더를 여러 개 둘 수 있는 구조라서다.

> 📘 공식 문서 보강 — `wrangler types`(4.128 기준)가 만든 `Env`에서 BROWSER의 타입 이름이 `BrowserRun`이다. Cloudflare가 "Browser Rendering"을 **Browser Run**으로 이름을 바꾸는 중이라(문서 주소도 `/browser-run/`), 강사 환경(wrangler 4.91)의 `Fetcher`와 이름이 다르다. 이 차이가 7.3에서 타입 에러로 나타난다(§3 참고). 또 `BrowserRun` 클래스에는 `fetch` 외에 `screenshot`·`markdown`·`links` 같은 **퀵 액션 메서드**가 바인딩에 직접 달려 있다 — Puppeteer 없이 `env.BROWSER.screenshot({ url })` 한 줄로 스크린샷을 받는 REST API 스타일 기능이 바인딩으로도 들어온 것이다. 강의는 다루지 않지만 "URL 하나 캡처" 같은 단순 작업엔 이쪽이 훨씬 짧다.

---

## 2. 7.1~7.2 Worker Loaders — 왜 동적 워커가 필요한가

이 회차는 코드 없이 그림으로만 설명한다. 요지는 세 단계다.

### 동적 워커란

지금까지 만든 워커는 "코드를 쓰고 → 배포한다"였다. **동적 워커**는 반대로 **실행 중에** 임의의 코드로 새 워커를 띄운다. 대표 용도가 "사용자가 보낸 코드 실행하기" — 사용자 입력은 믿을 수 없으니 내 서버에서 직접 돌리면 안 되고, 어딘가 격리된 곳이 필요하다. Worker Loaders 바인딩이 그 "어딘가"를 만들어 준다.

### 브라우저 툴은 모델이 코드를 쓴다

에이전트에게 "nomadcoders 가서 리뷰 버튼 눌러"라고 하면, 7.3의 브라우저 툴 방식에서는 **모델이 그 동작을 하는 JS 코드를 써 낸다** (`Page.navigate`, 클릭… 을 CDP 명령으로). 즉 우리는 `navigate`, `click` 같은 툴을 하나도 안 만든다 — 모델이 CDP 스펙을 보고 자기 툴을 즉석에서 만드는 셈이다.

> 📘 **CDP(Chrome DevTools Protocol)** — Chrome이 외부 프로그램에 열어 둔 조작 규격. `Page.navigate`, `Runtime.evaluate`, `DOM.querySelector` 같은 명령을 WebSocket으로 보내면 브라우저가 실행한다. Puppeteer도 결국 이 명령들을 감싼 라이브러리이고, 개발자도구 자체도 이 규격으로 브라우저와 대화한다.

### 그래서 격리가 필요하다

모델이 쓴 코드는 **신뢰할 수 없는 코드**다. 프롬프트가 탈취되면 "리뷰 버튼을 눌러"가 "this.env의 토큰을 밖으로 보내"로 바뀔 수 있다. 우리 워커에서 실행하면 `this.env`(시크릿, 바인딩)가 다 노출된다. 그래서 흐름이 이렇게 된다:

```
사용자: "nomadcoders 가서 리뷰 눌러"
  → 에이전트(우리 워커, this.env 있음): 모델이 조작 코드를 써 낸다
  → 코드를 **동적 워커**로 보낸다  ← env 없음, 외부 fetch 없음, 완전 격리
  → 동적 워커에는 CDP 객체만 쥐여 준다 → 브라우저 조작
  → 결과가 툴 출력으로 모델에게 돌아온다
```

> 📘 공식 문서 보강 — 실제 구현(`@cloudflare/codemode`의 `DynamicWorkerExecutor`)을 보면 매 호출마다 `env.LOADER.get("codemode-<uuid>", () => ({ compatibilityDate, mainModule: "executor.js", modules, globalOutbound: null }))`로 워커를 하나 띄운다. **`globalOutbound: null`** 이 "외부 fetch 차단"의 정체다 — 런타임이 강제하므로 코드가 아무리 `fetch("https://evil")`을 해도 나갈 수 없다. `env`는 아예 안 넘기고, 브라우저 조작 함수(`cdp.send` 등)만 Workers RPC로 넘겨 준다. 문서는 이 패턴을 "컨테이너보다 가벼운 코드 샌드박스"라 부르고, 에이전트가 코드를 써서 실행하는 "code mode"의 기반이라고 설명한다.

### 제약: 결과는 전부 모델에게 간다

브라우저 조작 전체가 **모델의 툴 하나**다. 툴 출력은 모델 컨텍스트로 돌아간다(Section 4.4의 getWeather와 같다). 그러니 "리뷰 전부 긁어 와"나 "이미지 다 받아 와"는 그 결과가 통째로 모델 입력이 되어 토큰을 태우거나 컨텍스트에 안 들어간다. 7.4에서 이 제약의 정확한 숫자(6,000토큰)와 우회 방법(직접 조작)이 나온다.

---

## 3. 7.3 Browser Tools — createBrowserTools 한 줄

```ts
import { createBrowserTools } from "agents/browser/ai";

const browserTools = createBrowserTools({
  browser: this.env.BROWSER,
  loader: this.env.LOADER,
});

const result = streamText({
  model: workersAi("@cf/zai-org/glm-4.7-flash"),
  system: "You can browse the web and inspect pages.",
  messages: await convertToModelMessages(this.messages),
  tools: { ...browserTools },
  stopWhen: isLoopFinished(),
});
```

Section 4.4의 `onChatMessage`와 골격이 같고, `tools`에 우리 툴 대신 **만들어진 툴 세트를 스프레드**하는 것만 다르다. 첫 실행에서 `@cloudflare/codemode`를 찾을 수 없다는 에러가 나면 설치한다 — `agents/browser/ai`가 내부에서 쓰는 동적 워커 실행기다.

`console.log(browserTools)`로 보면 툴이 **두 개**다:

| 툴 이름 | 하는 일 | 모델이 넘기는 것 |
|---|---|---|
| `browser_search` | CDP 스펙(도메인·명령·이벤트 목록)을 JS로 검색한다 — "내가 뭘 할 수 있지?" | `spec.get()`을 쓰는 async 화살표 함수 코드 |
| `browser_execute` | 실제 브라우저 세션에 CDP 명령을 보낸다 | `cdp.send(method, params, { sessionId })`를 쓰는 async 화살표 함수 코드 |

데모에서 모델이 한 일을 따라가면 툴 설명서(`EXECUTE_DESCRIPTION`)에 적힌 순서 그대로다: `Target.createTarget` → `attachToTarget`으로 sessionId → `Page.enable` → `Page.navigate` → 로드 대기 → `Runtime.evaluate`로 DOM 읽기 → "Reviews" 링크 찾아 클릭 → 텍스트 반환. 무료 모델이라 "명령이 안 먹는다"를 몇 번 반복했지만 결국 첫 리뷰와 작성자까지 맞혔다.

> 📘 공식 문서 보강 — `browser_execute`는 **호출마다** `env.BROWSER`로 새 브라우저 세션을 얻고(`/v1/devtools/browser` WebSocket), 끝나면 `finally`에서 세션을 DELETE 한다. 즉 7.3 방식에서는 툴 호출 하나 = 브라우저 하나이고, 우리가 닫을 필요가 없는 대신 **호출 사이에 페이지 상태가 이어지지 않는다**(모델이 매번 `createTarget`부터 다시 하는 이유). 옵션은 `timeout`(기본 30,000ms), `cdpUrl`(로컬 Chrome `--remote-debugging-port=9222`에 붙일 때), `cdpHeaders` 정도. 콘솔에 `[agents/browser] Browser tools are experimental` 경고가 한 번 찍힌다 — API가 바뀔 수 있다는 뜻이고, 실제로 최신 `agents`(0.22)에서는 `ctx` 옵션·`CodemodeRuntime` DO export·툴 5개(`browser_markdown`, `browser_extract`, `browser_links`, `browser_scrape` 추가)·세션 모드(one-shot / reuse / dynamic)로 크게 바뀌었다. 강의 버전(0.12.4)을 유지했다.

> 📘 타입 에러 하나 — 우리 환경에서는 `browser: this.env.BROWSER`에서 `Property 'connect' is missing in type 'BrowserRun'` 에러가 난다. `agents` 0.12.4가 옵션 타입을 예전 이름 `Fetcher`로 선언했고, 새 wrangler가 만든 `BrowserRun`에는 `connect`가 없어서다. 런타임은 둘 다 `fetch()`만 쓰므로 `this.env.BROWSER as unknown as Fetcher`로 단언했다(§8 "강사 코드와 다른 점").

---

## 4. 7.4 Puppeteer Tools — 브라우저를 직접 다루기

### 왜 다른 방식이 또 필요한가

7.3은 편하지만 두 가지가 아쉽다. ① 통제권 — 모델이 무슨 코드를 쓸지 우리가 정하지 못한다. ② **출력 크기** — 브라우저에서 나온 것은 툴 출력이라 모델을 거쳐야 우리에게 오고, 그마저 **6,000토큰에서 잘린다**. 이미지 한 장도 못 뺀다. 데이터를 많이 빼거나 파일을 만들려면 브라우저를 **우리가 직접** 다뤄야 한다. 그 도구가 Puppeteer(Playwright, Stagehand도 된다).

> 📘 공식 문서 보강 — 잘림의 정확한 구현은 `agents/dist/browser/truncate`에 있다: `MAX_TOKENS = 6,000`, 토큰당 4자로 추정해 **24,000자**를 넘으면 앞부분만 남기고 `--- TRUNCATED --- Response was ~N tokens (limit: 6,000). Use more specific queries` 문구를 붙인다. `browser_search`의 결과도 같은 규칙이다. "잘린다"는 것이지 에러가 나는 건 아니라서, 모델이 잘린 걸 보고 더 좁은 질의를 다시 하는 식으로 대응한다.

### 설치와 import

```bash
npm install @cloudflare/puppeteer
```
```ts
import puppeteer, { type Browser, type Page } from "@cloudflare/puppeteer";
```

원본 `puppeteer`가 아니라 **Cloudflare 포크**다. 차이는 딱 하나 — `puppeteer.launch(바인딩)`이 로컬 Chrome을 띄우는 대신 Cloudflare 서버의 Chrome 세션을 얻어 연결한다. 그 뒤의 `newPage`, `goto`, `title`, `screenshot` … 은 원본 Puppeteer와 같아서 Puppeteer 문서(pptr.dev)를 그대로 보면 된다. 강의에서 자동완성이 안 돼 import를 손으로 썼다.

### getPage — 브라우저 띄우고 페이지 하나 돌려주기

```ts
browser?: Browser;
page?: Page;

async getPage() {
  if (this.page && this.browser?.connected) return this.page;
  this.browser = await puppeteer.launch(this.env.BROWSER);
  this.page = await this.browser.newPage();
  await this.page.setViewport({ width: 1280, height: 720 });
  return this.page;
}
```

- **인스턴스 필드에 잡아 두는 이유**: 툴이 불릴 때마다 `launch` 하면 브라우저가 계속 늘고(= 돈), 페이지 상태도 잃는다. 한 번 띄운 것을 재사용한다.
- **`connected` 검사**: 객체는 있어도 세션이 죽었을 수 있다(유휴 타임아웃, 명시적 close). `isConnected()`는 deprecated 라 `connected` 프로퍼티를 쓴다.
- **`setViewport(1280×720)`**: 기본 해상도가 작아 스크린샷(7.5)이 볼품없다.

> 📘 공식 문서 보강 — 브라우저 세션은 **DevTools 명령이 60초 동안 없으면 자동 종료**된다. `puppeteer.launch(env.BROWSER, { keep_alive: 600000 })`처럼 ms 단위로 늘릴 수 있고 최대 10분이다(살려 두는 동안 계속 과금). 계정 단위 한도는 **동시 브라우저 3개(무료) / 10개(유료, 월 평균)**, **분당 새 브라우저 2개**, 무료 플랜은 **하루 10분**, 유료는 월 10시간 포함 후 브라우저-시간당 $0.09 + 동시 브라우저 1개당 $2. `puppeteer.sessions(env.BROWSER)`로 살아 있는 세션 목록을, `puppeteer.connect(env.BROWSER, sessionId)`로 기존 세션에 다시 붙을 수 있고, `puppeteer.limits(env.BROWSER)`는 지금 몇 개를 더 띄울 수 있는지 알려 준다 — 7.9 Live View에서 "세션 ID를 저장해 두고 다시 붙는" 패턴으로 나온다. `getPage`의 필드는 메모리라 DO가 잠들면(hibernation) 사라진다는 점도 같은 맥락 — 그때 이전 세션은 60초 뒤 스스로 닫히고 새 `launch`가 일어난다.

### navigate / closeBrowser 툴

```ts
navigate: tool({
  description: "Navigate to a website",
  inputSchema: z.object({
    url: z.url().meta({ description: "The url of the page that you want to go to with https://" }),
  }),
  execute: async ({ url }) => {
    const page = await this.getPage();
    await page.goto(url);
    return { ok: true, title: await page.title() };
  },
}),
closeBrowser: tool({
  description: "Close the browser session",
  inputSchema: z.object({}),
  execute: async () => {
    await this.closeBrowser();
    return { ok: true };
  },
}),
```

- 구조는 Section 4.4의 `getWeather`와 **완전히 같다**. 모델은 이름·설명·스키마만 보고 부르고, 브라우저 조작은 `execute` 안의 Puppeteer 코드가 한다. 모델이 CDP 코드를 쓰던 7.3과 대비된다.
- **반환값이 곧 모델이 보는 것**: `{ ok, title }`만 돌려준다. 7.3처럼 HTML 전체가 모델로 흘러가지 않는다. 그래서 7.5에서 스크린샷을 찍어 **R2에 올리고 URL만** 돌려주는 설계가 가능하다.
- `z.url()`은 zod 4의 URL 검증, `.meta({ description })`은 Section 4.4의 `.describe()`와 같은 "모델에게 보여 줄 인자 설명"이다. "https:// 포함"을 못 박은 것은 스킴 없는 주소로 `goto`가 실패하기 때문.
- `closeBrowser`도 처음엔 `return`이 없었다가 추가했다 — Section 4.6에서 본 대로 `execute`가 아무것도 안 돌려주면 모델이 브라우저(클라이언트) 툴로 오해할 수 있다.
- `inputSchema: z.object({})` — 인자가 없어도 툴 호출 형식은 항상 객체라 빈 스키마가 필요하다.
- 이제 **하고 싶은 동작을 전부 미리 설계**해야 한다. 클릭, 클릭 대상 찾기, 텍스트 추출 … 강의는 navigate 하나만 만들고 나머지는 "같은 패턴"이라고 넘겼다.

### 두 방식 비교

| | 7.3 createBrowserTools (자동) | 7.4 Puppeteer (수동) |
|---|---|---|
| 툴 정의 | 없음 — 모델이 CDP 코드를 쓴다 | 동작마다 `tool()` 하나씩 우리가 쓴다 |
| 실행 위치 | 동적 워커(격리) | 우리 워커의 `execute` 안 |
| 브라우저 세션 | 호출마다 새 세션, 자동 종료 | `getPage`로 재사용, **우리가 닫아야 함** |
| 결과의 행선지 | 항상 모델 컨텍스트(6,000토큰 잘림) | 우리가 결정 — 모델엔 요약만, 파일은 R2로 |
| 통제권 / 코드량 | 적음 / 적음 | 많음 / 많음 |
| 어울리는 일 | 탐색·질의응답, 한 번에 끝나는 조작 | 스크린샷·데이터 추출·정해진 워크플로 |

---

## 5. 실습 코드 뜯어보기 (`browser-agents/`, 7.4 기준)

### worker/index.ts — 골격

```
import AIChatAgent, routeAgentRequest, (convertToModelMessages, isLoopFinished, streamText, tool), createWorkersAI
import puppeteer + type Browser/Page, z

class BrowserAgent extends AIChatAgent<Env>
  browser?: Browser / page?: Page          ← 재사용용 메모리 (DO가 잠들면 사라짐)
  getPage()                                 ← 있으면 재사용, 없으면 launch → newPage → viewport
  closeBrowser()                            ← close + 필드 비우기
  onChatMessage()
    workersAi = createWorkersAI(env.AI)
    streamText({ model, system, messages, tools: { navigate, closeBrowser }, stopWhen })
    return result.toUIMessageStreamResponse()

export default { async fetch: (await routeAgentRequest) ?? 404 }
```

7.3 시점의 `createBrowserTools` 버전은 7.3 커밋에 남아 있다. 7.4에서 강사도 import까지 지우고 갈아 끼웠다 — 두 방식을 한 `tools` 객체에 섞을 수도 있지만(`{ ...browserTools, navigate }`), 강의는 대비를 위해 완전히 교체했다.

### 데이터 흐름 (7.4)

```
브라우저(App.tsx)                        워커 / BrowserAgent (DO)                    Cloudflare Browser Rendering
sendMessage("go to nomadcoders.co/reviews")
   ──────────────────────────────▶ onChatMessage → streamText
                                    모델: navigate({ url }) 호출 결정
                                    execute → getPage()
                                       ├ this.browser 없음 → puppeteer.launch(env.BROWSER) ──▶ Chrome 세션 생성
                                       └ newPage / setViewport
                                    page.goto(url) ─────────────────────────────────▶ 페이지 로드
                                    return { ok, title } → 모델 → 최종 답변
   ◀── tool 파트(navigate · output-available) + text 파트 스트림
sendMessage("close the browser")
   ──────────────────────────────▶ 모델: closeBrowser() → browser.close() ────────▶ 세션 종료 (과금 정지)
```

### 강사 코드와 다른 점 (우리 프로젝트의 선택)

- `routeAgentRequest`에 `await` — Section 3·4와 같은 이유(강사 코드는 await 없이 `?? 404`라서 404 분기가 죽은 코드이고, strict 타입에서 tsc가 실패한다).
- `this.env.BROWSER as unknown as Fetcher` — wrangler 4.128의 `BrowserRun` 타입과 agents 0.12.4의 `Fetcher` 요구가 어긋나서(7.3 커밋만 해당).
- `browser?: Browser` 필드를 비울 때 `null` 대신 `undefined` — 강사의 `this.browser = null`은 optional 필드에 strict 모드로는 대입할 수 없다. `this.browser?.connected`, `this.browser?.close()`도 같은 이유로 `?.`.
- `@cloudflare/ai-chat`을 **`0.7.1`로 고정** — `^0.7.0`이 받아 오는 0.7.2가 `agents/chat`에서 `createChatFiberSnapshot` 등 0.12.4에 없는 export를 import 해서 `vite build`가 `MISSING_EXPORT`로 깨진다(peerDependencies는 `agents >=0.12.4`라고 돼 있지만 실제로는 더 새 버전이 필요하다). Section 4 프로젝트의 lock이 0.7.1이었고 그 조합은 문제없다.

### 왜 이 코드가 학습용 예제인가 (한계)

- `navigate` 하나로는 "가서 제목 읽기"밖에 못 한다. 클릭·입력·텍스트 추출 툴은 같은 패턴으로 늘려야 한다.
- `getPage`가 탭을 하나만 관리한다. 모델이 여러 페이지를 동시에 열고 싶어도 방법이 없다.
- 브라우저를 닫는 책임이 모델에게 있다. 모델이 `closeBrowser`를 안 부르면 60초 유휴 타임아웃까지 과금된다. 실서비스라면 대화 종료·에러 시 코드에서 닫거나, `keep_alive`와 알람(Section 2.7)을 조합해 관리해야 한다.
- 에러 처리가 없다. `page.goto`가 실패하면(잘못된 URL, 타임아웃) 툴 에러가 스트림에 실려 모델에게 가지만, 브라우저 정리 코드는 실행되지 않는다.
- `stopWhen: isLoopFinished()`에 상한이 없다. 브라우저 작업은 스텝이 많아 `[isLoopFinished(), stepCountIs(N)]`가 더 안전하다.

---

## 6. 핵심 요약

1. 브라우저는 **Cloudflare 서버**에 있고 워커는 `env.BROWSER` 바인딩으로 **연결**만 받는다. 워커 안에서 Chrome이 도는 게 아니다.
2. 7.3 `createBrowserTools({ browser, loader })`는 툴 두 개(`browser_search`, `browser_execute`)를 준다. 모델이 **CDP 조작 코드를 직접 써서** 실행하므로 우리가 툴을 정의하지 않는다.
3. 모델이 쓴 코드는 신뢰할 수 없다 → **Worker Loaders**로 띄운 동적 워커(env 없음, `globalOutbound: null`로 외부 fetch 차단)에서 실행하고 CDP 객체만 넘긴다. 📘 `@cloudflare/codemode`가 이 격리 실행기다.
4. 브라우저 조작 전체가 툴 하나라서 **결과는 항상 모델 컨텍스트로** 간다. 📘 6,000토큰(약 24,000자)에서 잘리고, `browser_execute`는 호출마다 새 세션을 열고 닫는다.
5. 7.4 `@cloudflare/puppeteer`는 `launch(바인딩)`만 Cloudflare 전용이고 나머지는 원본 Puppeteer 문법. `getPage`로 브라우저·페이지를 재사용하고, `tool()`로 동작을 하나씩 정의한다(구조는 Section 4.4의 getWeather와 같다).
6. 직접 다루면 **결과의 행선지를 우리가 정한다** — 모델에겐 `{ ok, title }`만, 큰 데이터는 파일로(7.5 R2). 대신 할 수 있는 일을 전부 미리 코드로 써야 한다.
7. 브라우저는 **열려 있는 시간**으로 과금된다(토큰이 아니다). 📘 유휴 60초 후 자동 종료, `keep_alive` 최대 10분, 무료 하루 10분·동시 3개·분당 신규 2개. `closeBrowser` 툴은 그래서 있다.

---

## 7. 다음 섹션 미리보기

- **7.5 File Uploads** — 7.4에서 "결과를 모델에 안 보낼 수 있다"고 한 것의 첫 활용. `page.screenshot()`으로 이미지를 받아 **R2**(Cloudflare 파일 저장소)에 올리고, 모델에는 URL만 돌려준다. 새 바인딩(R2)이 하나 더 생긴다.
- **7.6 Public Files** — R2에 올린 파일을 브라우저에서 볼 수 있게 공개 URL로 서빙한다.
- **7.9 Live View** — 세션 ID를 저장해 두고 프론트가 같은 브라우저 세션에 붙어 **사람과 에이전트가 브라우저를 공유**한다. `puppeteer.sessions`/`connect`, DO가 잠들어도 세션을 이어 가는 패턴이 여기서 나온다.
- 건너뛴 **Section 5(Email)·6(Voice)** 는 챌린지가 끝난 뒤 채운다 — 5.x는 에이전트를 이메일·웹훅으로 깨우는 방법, 6.x는 음성 입출력.

---

## 부록 — 헷갈렸던 것 Q&A

**Q. browser 안 끄면 토큰 소모되나?** (7.4 녹화 메모)
A. **토큰은 아니고 브라우저 시간이 소모된다.** 두 가지를 분리해서 보면 된다.
- 토큰(모델 비용)은 모델을 부를 때만 든다. 브라우저가 열려 있는 것 자체는 모델과 무관하다.
- Browser Rendering 요금은 **브라우저 세션이 살아 있는 시간**(브라우저-시간)과 동시 브라우저 수로 계산한다. 그러니 안 닫으면 그 시간만큼 과금이다. 다만 📘 **DevTools 명령이 60초 동안 없으면 자동 종료**되므로, 안 닫아도 무한히 과금되진 않는다 — `keep_alive`를 늘려 뒀다면 그만큼(최대 10분) 더 간다. 무료 플랜은 하루 10분이 한도라 닫는 걸 잊으면 금방 소진된다.
- 7.3의 `createBrowserTools`는 툴 호출마다 세션을 열고 `finally`에서 닫으므로 우리가 신경 쓸 게 없다. 7.4의 Puppeteer 방식만 `getPage`가 세션을 잡고 있어서 `closeBrowser`가 필요하다.
- 확인 방법: 워커에서 `await puppeteer.sessions(this.env.BROWSER)`를 찍어 보면 지금 살아 있는 세션 목록(ID, 시작 시각)이 나온다. 또는 대시보드 Browser Rendering 페이지의 사용량.

**Q. 7.3에서 우리는 툴을 하나도 안 만들었는데, 모델은 뭘 보고 브라우저를 조작하나?**
A. 툴 두 개의 **description**이 사실상 설명서다. `browser_execute`의 설명에는 `cdp.send / attachToTarget` 헬퍼 시그니처와 "Target.createTarget → attachToTarget → Page.enable → Page.navigate → Runtime.evaluate" 예제 코드가 통째로 들어 있고, 모르면 `browser_search`로 CDP 스펙을 검색하라고 돼 있다. 데모에서 모델이 정확히 그 순서를 따른 이유다. Section 4.4의 "모델은 이름·설명·스키마만 본다"가 여기서도 똑같이 적용된다.

**Q. 동적 워커에 `env`가 없으면 브라우저는 어떻게 조작하나?**
A. 코드 실행은 동적 워커에서 하지만 **브라우저 연결은 우리 워커가 들고 있다**. 우리 워커가 `cdp.send` 같은 함수를 Workers RPC로 동적 워커에 넘겨 주고, 동적 워커의 코드가 그 함수를 부르면 실제 WebSocket 전송은 우리 워커 쪽에서 일어난다. 즉 동적 워커는 "브라우저 조작 함수"만 빌려 쓸 뿐 바인딩·시크릿에는 손댈 수 없다.

**Q. `puppeteer.launch`에 바인딩을 넘기는 건 Cloudflare 문법이고, `page.goto`는?**
A. `launch(env.BROWSER, options)`만 Cloudflare 포크 전용이다(원본은 `launch({ headless })`로 로컬 Chrome을 띄운다). `newPage`, `setViewport`, `goto`, `title`, `screenshot`, `click`, `$`, `evaluate` … 은 전부 원본 Puppeteer API라 pptr.dev 문서와 일반 Puppeteer 예제를 그대로 쓰면 된다. `Browser`/`Page` 타입도 원본과 같은 이름이다.

**Q. 이건 어디 문법?** (초보용 구분)

| 코드 | 어디 것 |
|---|---|
| `browser?: Browser`, `this.browser?.connected`, `this.browser = undefined` | TypeScript optional 필드 + JS optional chaining |
| `import puppeteer, { type Browser, type Page } from …` | ES 모듈 default + named import, TS type-only import |
| `as unknown as Fetcher` | TypeScript 이중 단언(서로 호환 안 되는 타입을 강제로 바꿀 때) |
| `z.object({})`, `z.url().meta({ description })` | zod 4 |
| `tool()`, `inputSchema`, `execute`, `stopWhen`, `isLoopFinished` | AI SDK(`ai`) |
| `createBrowserTools`, `agents/browser/ai` | Cloudflare `agents` SDK (experimental) |
| `puppeteer.launch(바인딩, { keep_alive })`, `puppeteer.sessions/connect/limits` | `@cloudflare/puppeteer` 포크 전용 |
| `newPage`, `setViewport`, `goto`, `title`, `screenshot` | 원본 Puppeteer API |
| `"browser": { "binding" }`, `"worker_loaders": [{ "binding" }]`, `env.BROWSER`, `env.LOADER` | Cloudflare Workers 바인딩 |
| `Target.createTarget`, `Page.navigate`, `Runtime.evaluate` | Chrome DevTools Protocol(브라우저 표준 규격, Cloudflare와 무관) |
