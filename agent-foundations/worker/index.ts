/**
 * ============================================================
 * Section 3 — Agent 클래스 (3.1 AgentState ~ 3.7 Schedule Tasks)
 * ============================================================
 *
 * 이 챕터의 핵심 개념:
 * - Agent 클래스는 Durable Object 위에 얹힌 고수준 추상화다.
 *   Durable Object가 주는 것(고유 인스턴스, SQLite 저장소, WebSocket)을
 *   전부 갖고 있지만 API가 훨씬 편하다. (`agents` npm 패키지)
 * - Agent는 `state`라는 일반 JS 객체를 갖고, `this.setState()`로 바꾸면
 *   ① 내장 SQLite DB에 자동 저장되고 ② 전 클라이언트에 자동 브로드캐스트된다.
 * - 3.3(Messages): 핑퐁 카운터를 채팅방으로 리팩터링 (핑퐁은 3.2 커밋에).
 * - 3.4(Storage and Broadcast): 메시지는 state가 아니라 내장 SQL(this.sql)에
 *   저장하고 this.broadcast로 전송 — state는 바뀔 때마다 "전체"가
 *   모든 클라이언트에 재전송되므로 쌓이는 데이터는 SQL에 둔다.
 * - 3.5(Authentication): 닉네임을 접속 URL 쿼리로 받아 connection.setState
 *   (연결별 상태)에 저장하고, loadHistory @callable로 과거 메시지를 내려준다.
 * - 3.6(Read Only Connections): 닉네임에 "read"가 들어간 연결은 읽기 전용 —
 *   프론트 setState는 물론 상태를 바꾸는 @callable 호출도 차단된다.
 * - 3.7(Schedule Tasks): schedule/scheduleEvery로 에이전트가 스스로
 *   정해진 시간에 자기 메서드를 실행한다 (DO 단일 알람의 한계를 감싼 API).
 */

// Connection: WebSocket 연결 하나를 대표하는 객체 (그 연결로 직접 send 가능)
// ConnectionContext: 연결 순간의 원본 HTTP 요청(ctx.request) 접근용
// WSMessage: onMessage로 들어오는 메시지 타입 (문자열 또는 바이너리)
// callable: 3.2에서 뺐던 import가 loadHistory와 함께 복귀했다.
// getCurrentAgent: connection 인자가 없는 메서드 안에서 호출자 정보를 얻는 도구.
import {
  Agent,
  callable,
  getCurrentAgent,
  routeAgentRequest,
  type Connection,
  type ConnectionContext,
  type WSMessage,
} from "agents";

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
 * 원시 기능(상태, RPC, WebSocket 이벤트, 저장소)을 익히는 단계다.
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
   * 3.4 — 에이전트가 (재)기동할 때 호출된다. 메시지를 저장할 테이블 생성.
   * Agent(=DO)는 인스턴스마다 전용 SQLite DB를 갖고 this.sql로 접근한다.
   * Section 1의 KV(전 세계 공유·최종 일관성·같은 키 쓰기 초당 1회)와
   * 정반대로, 이 DB는 인스턴스 전용·강한 일관성·지연 없음이다.
   * 하이버네이션에서 깨어날 때도 다시 불릴 수 있으므로 CREATE TABLE에는
   * IF NOT EXISTS가 필수다. (앞의 void는 반환값을 일부러 안 쓴다는 표시)
   */
  onStart() {
    void this.sql`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nickname TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `;
  }

  // 3.5 — 학습용 로그가 시끄러워 강사와 동일하게 주석 처리 (내용은 3.4 커밋에).
  // 역할: 상태 변경 "사후 감시" — source("server" | Connection)로 누가 바꿨는지 확인.
  // onStateChanged(state: ChattingRoomState, source: Connection | "server"): void {
  //   console.log("new state", state);
  //   console.log("who did it", source);
  // }

  // 3.6 — read-only 데모를 위해 강사와 동일하게 잠시 꺼둠 (3.4~3.5 커밋에 살아 있음).
  // 역할: 저장 전에 실행되어 throw하면 클라이언트발 setState(override)를 거부하는 훅.
  // 함정: @callable 경유 변경은 서버 실행이라 source가 "server" — 직접 override만 막는다.
  // validateStateChange(_nextState: ChattingRoomState, source: Connection | "server"): void {
  //   if (source !== "server") throw new Error("cant do this.");
  // }

  /**
   * 3.6 — 접속 순간 read-only 여부를 판정하는 훅. true를 반환한 연결은
   * 프론트 setState는 물론, 상태를 바꾸는 @callable 호출까지 차단된다
   * (상태를 안 건드리는 loadHistory 같은 RPC는 허용).
   * 데모: 닉네임에 "read"가 들어가면 read-only.
   * 함정: 우리 onConnect가 setState(접속자 수 +1)를 하므로 read-only
   * 연결은 접속 즉시 "Connection is read-only" 에러를 만난다 —
   * onConnect/onClose가 상태를 바꾸는 구조와는 충돌 주의.
   */
  shouldConnectionBeReadonly(_connection: Connection, ctx: ConnectionContext) {
    const url = new URL(ctx.request.url);
    const nickname = url.searchParams.get("nickname") ?? "anon";
    return nickname.includes("read");
  }

  /**
   * 3.5 — 3.3에서 예고했던 원형 onConnect(connection, ctx)를 드디어 쓴다.
   * useAgent의 query 옵션이 실어 보낸 닉네임을 접속 URL에서 꺼내
   * "그 연결 전용 상태"(connection.setState)에 저장한다 — 에이전트 전체
   * state와는 별개이고, 하이버네이션에도 살아남는다.
   * (실전이라면 ctx.request의 헤더·쿠키로 진짜 인증을 하는 자리다)
   */
  onConnect(connection: Connection, ctx: ConnectionContext) {
    const url = new URL(ctx.request.url);
    const nickname = url.searchParams.get("nickname") ?? "anon";

    connection.setState({ nickname });

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
   * 3.5 — 보낸 사람의 닉네임을 connection.state에서 읽는다.
   * Connection<{ nickname: string }> 제네릭이 connection.state의 타입이다.
   * (타입상 state는 setState 전까지 null일 수 있어 ?. + 기본값을 붙였다 —
   *  강사 코드는 connection.state.nickname 바로 접근, 이 프로젝트는 strict라 에러)
   * broadcast는 3.4의 [connection.id](본인 제외)를 버리고 전원 전송으로
   * 바꿨다 — 내 메시지도 다른 사람 메시지와 똑같이 onMessage 한 곳으로
   * 받아서, 화면 표시 로직을 하나로 통일하기 위해서다.
   */
  onMessage(connection: Connection<{ nickname: string }>, message: WSMessage) {
    const messageObj = {
      nickname: connection.state?.nickname ?? "anon",
      message: message.toString(),
      created_at: Date.now(),
    };
    // 3.7 — 메시지에 "delete"가 들어 있으면 30초마다 deleteMessages 실행 예약.
    // 두 번째 인자는 "이 클래스의 메서드 이름 문자열"이고, 그 이름의 메서드가
    // 실제로 있는지 TypeScript가 검사해준다 (deleteMessages 정의 전엔 타입 에러).
    if (message.toString().includes("delete")) {
      this.scheduleEvery(30, "deleteMessages");
    }
    void this.sql`
      INSERT INTO messages (nickname, message, created_at) VALUES (${messageObj.nickname}, ${messageObj.message}, ${messageObj.created_at})
    `;
    // this.broadcast(JSON.stringify(messageObj), [connection.id]);  // 3.4 버전(본인 제외)
    this.broadcast(JSON.stringify(messageObj));
  }

  /**
   * 3.7 — 스케줄이 부르는 콜백. DO의 원래 알람은 한 번에 하나뿐이라
   * 여러 예약을 쓰려면 알람 테이블을 SQL로 직접 관리해야 했는데,
   * Agent의 schedule API가 그걸 감싸준다:
   *   schedule(초 | Date | cron 문자열, "메서드명", payload?)
   *   scheduleEvery(초, "메서드명") / listSchedules() / cancelSchedule(id)
   * 스케줄은 에이전트의 SQLite에 저장되므로 재시작·하이버네이션에도 살아남는다.
   */
  deleteMessages() {
    void this.sql`DELETE FROM messages`;
  }

  /**
   * 3.5 — 접속 직후 프론트가 과거 메시지를 불러가는 RPC
   * (프론트: await agent.stub.loadHistory()).
   * getCurrentAgent(): onMessage처럼 connection 인자가 없는 메서드 안에서도
   * "지금 이 호출을 일으킨 커넥션"을 꺼내오는 도구 — 누가 불렀는지 알 수 있다.
   * (강사는 connection.state로 바로 접근하지만, 타입상 connection이
   *  undefined일 수 있어 ?. 를 붙였다)
   * LIMIT 100: 전체 메시지를 통째로 내려보내지 않기 위한 최소한의 안전장치.
   */
  @callable()
  loadHistory() {
    const { connection } = getCurrentAgent<ChattingRoomAgent>();
    // this.setConnectionReadonly(connection, true);  // 3.6 — 접속 이후 아무 때나 동적 전환하는 다른 방법
    console.log(connection?.state, "loaded history");
    return this.sql`SELECT * FROM messages ORDER BY created_at ASC LIMIT 100`;
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
