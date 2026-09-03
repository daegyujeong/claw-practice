/**
 * ============================================================
 * Section 7 — Browser Agents (7.0 Introduction ~ 7.3 Browser Tools)
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
 * - 7.3(Browser Tools): createBrowserTools({ browser, loader })가 그 전부를 툴 두 개로
 *   포장해 준다. streamText의 tools에 스프레드하면 끝. 대신 툴 출력이 통째로
 *   모델 컨텍스트로 돌아온다는 제약(6,000토큰에서 잘림)이 있다.
 *
 * 이 챕터의 로드맵 (강사 저장소 커밋 기준):
 *   7.0 Introduction → 7.3 Browser Tools(Cloudflare가 주는 자동 툴)
 *   → 7.4 Puppeteer Tools(직접 만드는 툴) → 7.5 File Uploads(스크린샷 → R2)
 *   → 7.6 Public Files → 7.9 Live View(사람과 에이전트가 브라우저를 공유)
 */

// AIChatAgent: Section 4와 같다 — 메시지 저장·브로드캐스트·스트리밍이 내장된
//   채팅 에이전트. 우리는 onChatMessage만 구현하면 된다.
import { AIChatAgent } from "@cloudflare/ai-chat";
// routeAgentRequest: /agents/:클래스/:인스턴스 URL을 해당 Agent(DO)로 넘기는 라우터.
import { routeAgentRequest } from "agents";
// 7.3 — createBrowserTools: `agents` 패키지의 서브 경로 `agents/browser/ai`.
//   "브라우저 툴 세트"를 AI SDK의 ToolSet 형태로 돌려준다. 내부에서
//   @cloudflare/codemode(동적 워커 실행기)를 쓰기 때문에 codemode도 설치해야 한다 —
//   강의에서 첫 실행 때 "code mode를 찾을 수 없다"는 에러가 난 이유.
import { createBrowserTools } from "agents/browser/ai";
// AI SDK — Section 4.3/4.4에서 쓴 것과 같다.
import { convertToModelMessages, isLoopFinished, streamText } from "ai";
// workers-ai-provider: AI SDK가 Cloudflare 모델을 쓰게 해 주는 어댑터.
import { createWorkersAI } from "workers-ai-provider";

/**
 * 브라우저 에이전트. 클래스 이름 = wrangler.jsonc의 DO 바인딩 이름
 * = 프론트 useAgent({ agent: "BrowserAgent" })의 이름. 셋이 같아야 한다.
 */
export class BrowserAgent extends AIChatAgent<Env> {
  /**
   * 7.3 — Section 4.4의 onChatMessage와 구조가 같다. 다른 것은 tools에
   * 우리가 정의한 툴 대신 createBrowserTools가 만들어 준 툴을 넣는다는 점뿐이다.
   */
  async onChatMessage() {
    // Section 4.2와 같다 — env.AI 바인딩으로 Workers AI 공급자를 만든다.
    const workersAi = createWorkersAI({ binding: this.env.AI });

    // 7.3 — 브라우저 툴 세트. 바인딩 두 개를 넘긴다:
    //   browser: env.BROWSER — 툴이 실행될 때마다 이 바인딩으로 Chrome 세션을
    //            하나 얻어(CDP WebSocket) 명령을 보내고, 끝나면 세션을 닫는다.
    //   loader:  env.LOADER — 모델이 써 낸 JS를 실행할 동적 워커를 만드는 바인딩.
    //            codemode가 매 호출마다 `codemode-<uuid>` 이름의 워커를 띄우고
    //            globalOutbound: null(외부 fetch 차단)로 격리해 실행한다.
    //   console.log(browserTools) 해 보면 키가 두 개다 —
    //     browser_search : CDP 스펙(도메인·명령 목록)을 JS로 검색하는 툴
    //     browser_execute: `cdp.send(method, params, { sessionId })` 헬퍼가 주어진
    //                      async 화살표 함수를 써서 브라우저를 조작하는 툴
    //   즉 우리는 "navigate", "click" 같은 툴을 하나도 안 만든다. 모델이 CDP 스펙을
    //   찾아보고 조작 코드를 직접 써서 browser_execute로 실행한다.
    //   (설치된 agents 0.12.4 기준. 옵션은 timeout(기본 30초), cdpUrl(로컬 Chrome
    //    --remote-debugging-port 접속용) 정도가 더 있다.)
    //   타입 주의: 우리 wrangler(4.128)가 만든 Env는 BROWSER를 `BrowserRun`으로
    //   선언하는데, agents 0.12.4의 옵션 타입은 예전 이름 `Fetcher`를 요구해서
    //   `Property 'connect' is missing` 에러가 난다(강사 환경의 wrangler 4.91은
    //   `Fetcher`로 생성해서 에러가 없다). 런타임에는 둘 다 fetch()만 쓰므로 안전한
    //   단언이다. agents를 올리면(0.22+) 타입이 맞춰져 있지만 API 모양(ctx 옵션,
    //   툴 5개)이 강의와 달라져서 강의 버전을 유지했다.
    const browserTools = createBrowserTools({
      browser: this.env.BROWSER as unknown as Fetcher,
      loader: this.env.LOADER,
    });

    const result = streamText({
      // Section 4와 같은 무료 모델. 강의 데모에서 "명령이 안 먹는다"를 몇 번 반복한
      //   건 이 모델의 한계 — 코드 작성 능력이 좋은 모델일수록 브라우저 툴을 잘 쓴다.
      model: workersAi("@cf/zai-org/glm-4.7-flash"),
      // 시스템 프롬프트로 "브라우저를 쓸 수 있다"는 사실만 알려 준다. 어떻게 쓰는지는
      //   툴 description(SEARCH/EXECUTE_DESCRIPTION)에 예제 코드까지 들어 있다.
      system: "You can browse the web and inspect pages.",
      messages: await convertToModelMessages(this.messages),
      // 스프레드로 툴 세트를 풀어 넣는다. 우리 툴(getWeather 등)을 같이 넣어도 된다.
      tools: {
        ...browserTools,
      },
      // 브라우저 작업은 "스펙 검색 → 코드 실행 → 결과 보고 다시 실행 …"으로 여러
      //   스텝이 걸린다. 기본값 stepCountIs(1)이면 첫 툴 호출에서 멈추므로
      //   모델이 스스로 끝낼 때까지 돌린다(Section 4.4의 stopWhen 설명 참고).
      //   실서비스라면 [isLoopFinished(), stepCountIs(20)]처럼 상한을 두는 편이 안전하다.
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
