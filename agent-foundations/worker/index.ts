/**
 * ============================================================
 * Section 3 — Agent 클래스 (3.1 AgentState, 3.2 Callables, 3.3 Messages)
 * ============================================================
 *
 * 이 챕터의 핵심 개념:
 * - Agent 클래스는 Durable Object 위에 얹힌 고수준 추상화다.
 *   Durable Object가 주는 것(고유 인스턴스, SQLite 저장소, WebSocket)을
 *   전부 갖고 있지만 API가 훨씬 편하다. (`agents` npm 패키지)
 * - Agent는 `state`라는 일반 JS 객체를 갖고, `this.setState()`로 바꾸면
 *   ① 내장 SQLite DB에 자동 저장되고(테이블 만들 필요 없음)
 *   ② WebSocket으로 연결된 모든 프론트엔드에 자동 브로드캐스트된다.
 * - 3.3(Messages)에서 핑퐁 카운터를 채팅방으로 리팩터링했다:
 *   상태는 접속자 수(currentlyOnline)가 되고, onConnect/onClose/onMessage로
 *   WebSocket 연결 생명주기를 직접 다룬다. 핑퐁 버전은 3.2 커밋에 남아 있다.
 */

// Connection: WebSocket 연결 하나를 대표하는 객체 (그 연결로 직접 send 가능)
// WSMessage: onMessage로 들어오는 메시지 타입 (문자열 또는 바이너리)
// 강사 코드는 callable도 import를 유지하지만, 3.3에서 @callable 메서드가
// 사라져 안 쓰는 import는 이 프로젝트의 타입 체크에서 에러라 뺐다 (뒤 챕터에서 복귀).
import { Agent, routeAgentRequest, type Connection, type WSMessage } from "agents";

/**
 * 프론트엔드와 공유하는 상태 타입 (3.3에서 PingPongState를 대체).
 * export 하는 이유: src/App.tsx의 useAgent 제네릭에 넘겨서
 * `agent.state.currentlyOnline` 자동완성/타입 체크를 받기 위해서다.
 */
export type ChattingRoomState = {
  currentlyOnline: number;
};

/**
 * 채팅방 에이전트 — 아직 AI는 없다. 이 챕터는 Agent 클래스의
 * 원시 기능(상태, RPC, WebSocket 이벤트)을 익히는 단계다.
 */
export class ChattingRoomAgent extends Agent<Env, ChattingRoomState> {
  /**
   * 초기 상태는 "Durable Object가 처음 만들어질 때 딱 한 번"만 적용된다.
   * 이후 요청은 하이버네이션에서 깨어날 뿐 다시 생성되지 않으므로,
   * initialState가 기존 상태를 덮어쓰는 일은 없다. (함정 주의!)
   */
  initialState: ChattingRoomState = {
    currentlyOnline: 0,
  };

  /**
   * 3.2 — 상태가 바뀔 때마다 "누가 바꿨는지"를 알려주는 콜백.
   * - @callable 메서드가 서버 안에서 setState 하면 source는 "server"
   * - 프론트가 agent.setState로 직접 덮어쓰면(override) source는 그 Connection
   * 브로드캐스트가 끝난 뒤에 불리므로 감시용이다 — 잘못된 변경을 "막는" 건
   * validateStateChange(저장 전에 실행, throw하면 거부)의 몫이다.
   */
  onStateChanged(state: ChattingRoomState, source: Connection | "server"): void {
    console.log("new state", state);
    console.log("who did it", source);
  }

  /**
   * 3.3 — 새 클라이언트가 WebSocket으로 연결될 때마다 호출된다.
   * setState가 브로드캐스트까지 해주므로, 접속자 수가 모든 클라이언트에
   * 실시간으로 반영된다. (원형은 onConnect(connection, ctx) — ctx.request로
   * 헤더·쿠키를 보고 인증한 뒤 connection.close()로 거절하는 자리다)
   */
  onConnect() {
    this.setState({
      currentlyOnline: this.state.currentlyOnline + 1,
    });
  }

  /** 3.3 — 연결이 끊길 때 호출. 접속자 수를 줄인다. */
  onClose() {
    this.setState({
      currentlyOnline: this.state.currentlyOnline - 1,
    });
  }

  /**
   * 3.3 — 이 연결로부터 메시지를 받았을 때 호출된다.
   * connection.send는 "보낸 사람에게만" 회신한다 — 전원에게 보내려면
   * setState(상태 브로드캐스트)나 this.broadcast를 쓴다(다음 챕터 3.4 예고).
   */
  onMessage(connection: Connection, message: WSMessage) {
    console.log(message);
    connection.send("love you back");
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
