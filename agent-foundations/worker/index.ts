/**
 * ============================================================
 * Section 3 — Agent 클래스 (3.0 셋업, 3.1 상태 동기화, 3.2 callable 호출)
 * ============================================================
 *
 * 이 챕터의 핵심 개념:
 * - Agent 클래스는 Durable Object 위에 얹힌 고수준 추상화다.
 *   Durable Object가 주는 것(고유 인스턴스, SQLite 저장소, WebSocket)을
 *   전부 갖고 있지만 API가 훨씬 편하다. (`agents` npm 패키지)
 * - Agent는 `state`라는 일반 JS 객체를 갖고, `this.setState()`로 바꾸면
 *   ① 내장 SQLite DB에 자동 저장되고(테이블 만들 필요 없음)
 *   ② WebSocket으로 연결된 모든 프론트엔드에 자동 브로드캐스트된다.
 * - 지난 섹션(Durable Objects)에서 직접 하던 WebSocket 업그레이드/브로드캐스트를
 *   여기서는 `routeAgentRequest()` + `useAgent` 훅이 대신 해준다.
 * - 3.2: `@callable()`을 붙인 메서드는 프론트엔드가 직접 호출할 수 있다 (RPC).
 */

// Agent 클래스와 라우팅 헬퍼는 강의에서 설치한 `agents` 패키지에서 온다.
// callable은 3.2에서 추가 — 메서드를 프론트엔드에 노출하는 데코레이터.
// (Cloudflare 전용 프레임워크 문법 — JS 표준이 아니다)
import { Agent, callable, routeAgentRequest } from "agents";

/**
 * 프론트엔드와 공유하는 상태 타입.
 * export 하는 이유: src/App.tsx의 useAgent 제네릭에 넘겨서
 * `agent.state.pingPongCount` 자동완성/타입 체크를 받기 위해서다.
 * (백엔드-프론트엔드가 한 저장소에 있어서 가능한 풀스택 타입 안전성)
 */
export type PingPongState = {
  pingPongCount: number;
};

/**
 * 채팅방 에이전트 — 지금은 핑퐁 카운터 데모만 들어 있다.
 *
 * 제네릭 <Env, PingPongState>:
 * - Env: wrangler.jsonc의 바인딩들(KV 등 나중에 쓸 것)을 타입으로 알려준다.
 * - PingPongState: this.state / setState의 타입을 고정한다.
 */
export class ChattingRoomAgent extends Agent<Env, PingPongState> {
  /**
   * 초기 상태는 "Durable Object가 처음 만들어질 때 딱 한 번"만 적용된다.
   * 이후 요청은 하이버네이션에서 깨어날 뿐 다시 생성되지 않으므로,
   * initialState가 기존 상태를 덮어쓰는 일은 없다. (함정 주의!)
   */
  initialState: PingPongState = {
    pingPongCount: 0,
  };

  /**
   * 3.2 — @callable(): 이 메서드를 프론트엔드에서 호출할 수 있게 만든다.
   * 프론트에서는 `agent.stub.increment()`처럼 부른다 (stub = 원격 객체의
   * 대리 객체라는 RPC 용어. 녹취에는 "stop"으로 들리지만 stub이 맞다).
   *
   * - 데코레이터 문법이라 Vite가 그냥은 못 읽는다 → vite.config.ts에
   *   agents/vite 플러그인을 추가해야 한다 (3.2에서 함께 수정).
   * - 상태 변경 자체는 서버(에이전트) 안에서 일어나므로, 상태 변경 콜백의
   *   source에 "server"로 찍힌다. 프론트가 setState를 직접 부르는 override와
   *   구분되는 지점 (App.tsx의 override 버튼 주석 참고).
   * - setState가 SQLite 저장 + 연결된 클라이언트 전원 브로드캐스트까지 해주므로
   *   여기서 따로 응답을 보낼 필요가 없다.
   */
  @callable()
  increment() {
    this.setState({ pingPongCount: this.state.pingPongCount + 1 });
  }
  @callable()
  decrement() {
    this.setState({ pingPongCount: this.state.pingPongCount - 1 });
  }
}

export default {
  /**
   * 워커 진입점. useAgent 훅이 보내는 WebSocket 업그레이드 요청은
   * `/agents/chatting-room-agent/<세션이름>` 같은 URL로 들어온다
   * (클래스 이름이 kebab-case로 변환된 것).
   *
   * routeAgentRequest()가 그 URL을 파싱해서
   * 알맞은 Agent 인스턴스를 찾고(없으면 생성/깨움),
   * WebSocket 업그레이드까지 전부 처리한 Response를 돌려준다.
   * 지난 섹션에서 손으로 하던 idFromName → get → fetch 과정의 자동화판.
   */
  async fetch(request, env) {
    const agentResponse = await routeAgentRequest(request, env);

    // 에이전트로 가는 요청이면 그 응답을 그대로 전달하고,
    // 아니면(엉뚱한 URL) 404를 돌려준다.
    if (agentResponse) {
      return agentResponse;
    }
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
