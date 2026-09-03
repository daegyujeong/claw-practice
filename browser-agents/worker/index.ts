/**
 * ============================================================
 * Section 7 — Browser Agents (7.0 Introduction ~ 7.4 Puppeteer Tools)
 * ============================================================
 *
 * 이 챕터의 핵심 개념:
 * - 에이전트에게 "브라우저"를 준다. Cloudflare가 자기 서버에서 진짜 Chrome을
 *   띄워 주고(Browser Rendering), 우리 워커는 바인딩(env.BROWSER)으로 그 브라우저에
 *   접속한다. 브라우저 자체가 워커 안에서 도는 게 아니다 — "연결"을 받는 것이다.
 * - 7.0(Introduction): Section 4의 채팅 UI를 복원하고, wrangler.jsonc에 바인딩 두 개
 *   (browser, worker_loaders)를 추가한 뒤 `npm run cf-typegen`.
 * - 7.1~7.2(Worker Loaders 설명): 브라우저 툴은 "모델이 스스로 조작 코드를 써서
 *   실행"하는 방식이다. 모델이 쓴 코드는 신뢰할 수 없으므로(프롬프트 탈취 시
 *   this.env의 시크릿을 빼낼 수도 있다) 우리 워커가 아니라 **동적 워커**(env도
 *   fetch도 없는 격리 워커)에서 실행하고, 그 워커에 CDP 객체만 쥐여 준다.
 * - 7.3(Browser Tools): createBrowserTools({ browser, loader })가 그 전부를 툴 두 개
 *   (browser_search / browser_execute)로 포장해 준다. 편하지만 통제권이 적고, 툴 출력이
 *   통째로 모델 컨텍스트로 돌아온다(6,000토큰에서 잘림) — 이미지 같은 큰 데이터는 못 뺀다.
 * - 7.4(Puppeteer Tools): 그래서 브라우저를 **직접** 다룬다. @cloudflare/puppeteer로
 *   같은 바인딩에 접속해 navigate / closeBrowser 툴을 손수 만든다. 뭘 할 수 있는지를
 *   전부 미리 설계해서 코드로 써야 하지만, 결과를 모델에 안 보내고 우리가 직접 다룰 수
 *   있다(7.5에서 스크린샷을 R2에 올리는 이유). 브라우저는 열려 있는 시간만큼 과금되므로
 *   닫는 툴이 꼭 필요하다.
 *
 * 이 챕터의 로드맵 (강사 저장소 커밋 기준):
 *   7.0 Introduction → 7.3 Browser Tools(Cloudflare가 주는 자동 툴)
 *   → 7.4 Puppeteer Tools(직접 만드는 툴) → 7.5 File Uploads(스크린샷 → R2)
 *   → 7.6 Public Files → 7.9 Live View(사람과 에이전트가 브라우저를 공유)
 *
 * 7.3의 createBrowserTools 버전은 7.3 커밋에 남아 있다. 7.4에서 강사도 그 코드를 지우고
 * (import 포함) 직접 만든 툴로 교체했다 — 두 방식을 섞어 쓸 수도 있지만 강의는 대비를
 * 위해 완전히 갈아 끼웠다.
 */

// AIChatAgent: Section 4와 같다 — 메시지 저장·브로드캐스트·스트리밍이 내장된
//   채팅 에이전트. 우리는 onChatMessage만 구현하면 된다.
import { AIChatAgent } from "@cloudflare/ai-chat";
// routeAgentRequest: /agents/:클래스/:인스턴스 URL을 해당 Agent(DO)로 넘기는 라우터.
import { routeAgentRequest } from "agents";
// AI SDK — 7.4에서 tool()이 다시 필요하다(Section 4.4처럼 우리가 툴을 정의하므로).
import { convertToModelMessages, isLoopFinished, streamText, tool } from "ai";
// workers-ai-provider: AI SDK가 Cloudflare 모델을 쓰게 해 주는 어댑터.
import { createWorkersAI } from "workers-ai-provider";
// 7.4 — Puppeteer의 Cloudflare 포크. 원본 puppeteer는 로컬 Chrome을 띄우지만 이 포크는
//   `puppeteer.launch(바인딩)`으로 Cloudflare 서버의 Chrome에 붙는다. 그 뒤의 API
//   (newPage, goto, title, screenshot …)는 원본 Puppeteer와 같다 — 즉 launch 한 줄만
//   Cloudflare 전용이고 나머지는 Puppeteer 문법이다.
//   강의에서 자동완성이 안 돼 손으로 import 했다. Browser/Page는 타입만 쓰므로 `type`.
import puppeteer, { type Browser, type Page } from "@cloudflare/puppeteer";
// zod — 툴 입력 스키마. Section 4.4와 같다.
import z from "zod";

/**
 * 브라우저 에이전트. 클래스 이름 = wrangler.jsonc의 DO 바인딩 이름
 * = 프론트 useAgent({ agent: "BrowserAgent" })의 이름. 셋이 같아야 한다.
 */
export class BrowserAgent extends AIChatAgent<Env> {
  // 7.4 — 브라우저와 페이지를 인스턴스 필드에 잡아 둔다. 툴이 호출될 때마다 새 브라우저를
  //   띄우면 그만큼 돈이 들고(동시 브라우저 수·분당 생성 수 제한도 있다) 페이지 상태도
  //   잃어버리므로, 한 번 띄운 것을 재사용한다.
  //   ⚠️ 이건 "메모리"다 — DO가 잠들거나(hibernation) 재시작되면 사라진다. 그때는
  //   getPage()가 다시 launch 하고, 이전 브라우저 세션은 남아서 60초 유휴 후 스스로
  //   닫힌다(기본 keep_alive). 7.9 Live View에서 세션 ID를 저장해 다시 붙는 방법이 나온다.
  //   강사 코드는 `browser?: Browser` 뒤에 `this.browser = null`을 대입하는데, strict
  //   모드에서는 optional(undefined)에 null을 넣을 수 없어 우리 코드는 undefined로 비운다.
  browser?: Browser;
  page?: Page;

  /**
   * 7.4 — 툴들이 공유하는 헬퍼. "브라우저를 띄우고 페이지 하나를 돌려준다".
   *
   * 순서: (이미 페이지가 있고 브라우저가 살아 있으면 그대로 반환)
   *   → puppeteer.launch(env.BROWSER): Cloudflare가 서버에서 Chrome을 하나 띄우고
   *     그 세션에 Puppeteer를 연결한다. 여기가 유일한 Cloudflare 전용 부분.
   *   → newPage(): 탭 하나 → setViewport(1280×720): 기본 해상도가 작아서 스크린샷이
   *     볼품없다(7.5 대비) → 페이지 반환.
   *
   * `this.browser.connected`: 브라우저 객체가 있어도 세션이 이미 죽었을 수 있다
   * (유휴 타임아웃, 명시적 close). 강의에서 isConnected()를 쓰려다 deprecated 경고를
   * 보고 `connected` 프로퍼티로 바꿨다. optional 필드라 `?.`로 접근한다.
   */
  async getPage() {
    if (this.page && this.browser?.connected) return this.page;
    // launch 옵션 예: { keep_alive: 600000 } — 유휴 상태로 살려 둘 시간(ms). 기본 60초,
    //   최대 10분. 살려 두는 동안은 계속 과금된다.
    this.browser = await puppeteer.launch(this.env.BROWSER);
    this.page = await this.browser.newPage();
    await this.page.setViewport({
      width: 1280,
      height: 720,
    });
    return this.page;
  }

  /**
   * 7.4 — 브라우저 세션 종료. Browser Rendering은 브라우저가 **열려 있는 시간**으로
   * 과금된다(토큰이 아니다). 안 닫으면 유휴 타임아웃(기본 60초)까지는 계속 비용이고,
   * keep_alive를 늘려 뒀다면 그만큼 더 간다. 그래서 툴로도 노출해 모델이 작업을
   * 마치면 닫게 한다.
   * close()는 세션을 실제로 끝낸다(다시 connect 불가). 나중에 이어 쓰고 싶으면
   * disconnect()로 연결만 끊고 세션은 살려 두는 방법이 있다(7.9).
   */
  async closeBrowser() {
    await this.browser?.close();
    this.browser = undefined;
    this.page = undefined;
  }

  /**
   * 7.4 — 7.3과 같은 골격이지만 tools가 createBrowserTools 대신 우리가 만든 툴이다.
   * 이제 모델은 CDP 코드를 쓰지 않는다. "navigate", "closeBrowser"라는 이름·설명·
   * 스키마만 보고 호출하고, 실제 브라우저 조작은 execute 안의 Puppeteer 코드가 한다
   * (= Section 4.4의 getWeather와 완전히 같은 구조).
   */
  async onChatMessage() {
    const workersAi = createWorkersAI({ binding: this.env.AI });

    const result = streamText({
      model: workersAi("@cf/zai-org/glm-4.7-flash"),
      system: "You can browse the web and inspect pages.",
      messages: await convertToModelMessages(this.messages),
      tools: {
        // 7.4 — 직접 만든 툴은 하고 싶은 동작을 **전부 미리 설계**해야 한다. 강의는
        //   navigate 하나만 만들었고, 클릭·텍스트 추출·스크린샷(7.5)은 같은 패턴으로
        //   추가한다. 통제권을 얻는 대신 코드가 늘어나는 것이 7.3과의 트레이드오프.
        navigate: tool({
          description: "Navigate to a website",
          inputSchema: z.object({
            // z.url(): zod 4의 URL 검증 스키마(문자열 + URL 형식 검사).
            //   .meta({ description }) 는 모델에게 보여 줄 인자 설명 — Section 4.4의
            //   .describe()와 같은 역할이다. "https://를 포함해서"라고 못 박은 것은
            //   모델이 "nomadcoders.co"처럼 스킴 없는 주소를 넘기면 goto가 실패하기 때문.
            url: z.url().meta({
              description:
                "The url of the page that you want to go to with https://",
            }),
          }),
          execute: async ({ url }) => {
            const page = await this.getPage();
            // page.goto: Puppeteer 명령. 페이지 로드가 끝날 때까지 기다린다.
            await page.goto(url);
            // 반환값이 곧 모델이 보는 툴 출력이다. "성공했고 어떤 페이지에 있는지"만
            //   작게 돌려준다 — 7.3과 달리 페이지 HTML 전체가 모델로 흘러가지 않는다.
            return { ok: true, title: await page.title() };
          },
        }),
        closeBrowser: tool({
          description: "Close the browser session",
          // 입력이 없어도 빈 객체 스키마는 필요하다 — 툴 호출 인자 형식이 항상 객체라서.
          inputSchema: z.object({}),
          execute: async () => {
            await this.closeBrowser();
            // 강의에서 처음엔 return을 빼먹었다가 추가했다 — Section 4.6에서 본 대로
            //   execute가 아무것도 반환하지 않으면 모델이 브라우저(클라이언트) 툴로
            //   오해할 수 있으니 반드시 무언가 돌려준다.
            return { ok: true };
          },
        }),
      },
      // navigate → (다음 툴) → 최종 답변까지 여러 스텝. Section 4.4의 stopWhen 참고.
      stopWhen: isLoopFinished(),
    });

    return result.toUIMessageStreamResponse();
  }
}

export default {
  // routeAgentRequest는 Promise<Response | null>을 반환하므로 반드시 await 한 뒤
  //   ?? 로 404 처리한다. Section 4와 같은 이유 — await 없이 `?? 404`라고 쓰면
  //   Promise는 절대 null이 아니라서 404 분기가 죽은 코드가 되고, strict 타입에서는
  //   `Promise<Response | null>`이 핸들러 반환 타입에 안 맞아 tsc가 실패한다.
  async fetch(request, env) {
    return (
      (await routeAgentRequest(request, env)) ??
      new Response(null, { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
