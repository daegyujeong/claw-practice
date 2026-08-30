/**
 * 3.1~3.2 — Agent 상태 실시간 구독 + 프론트엔드에서 메서드 호출
 *
 * 핵심: useAgent 훅 하나로 WebSocket 연결 + 상태 동기화가 끝난다.
 * API를 만들 필요도, fetch를 할 필요도 없다.
 * - 훅이 마운트되면 `/agents/chatting-room-agent/<이름>` 으로
 *   WebSocket 업그레이드 요청을 자동으로 보낸다.
 * - 워커의 routeAgentRequest()가 이 요청을 받아 에이전트에 연결해 준다.
 * - 3.2: @callable 메서드는 `agent.stub.메서드()`로 호출한다.
 */
import { useState } from "react";
// useAgent는 React 전용 서브패키지에서 온다 (agents/react — 프레임워크 문법)
import { useAgent } from "agents/react";
// 백엔드(worker/index.ts)에서 export한 타입을 그대로 가져온다.
// 백엔드와 프론트엔드가 같은 타입을 쓰므로 상태 구조가 어긋날 수 없다.
import type { ChattingRoomAgent, PingPongState } from "../worker";

function App() {
  // 서버 상태의 로컬 복사본. onStateUpdate로 받은 값을 여기 담아 렌더링한다.
  // 3.2에서 강사가 "onStateUpdate 없이 agent.state를 JSX에서 직접 읽어도
  // 된다"고 한 게 이 부분이다 — 직접 읽기로 바꿔도 되고, 상태 변경 순간마다
  // 다른 로직(로그, 알림 등)을 끼우고 싶으면 지금처럼 콜백을 유지한다.
  const [pingPongs, setPingPongs] = useState(0);

  // WebSocket 연결이 열렸는지 여부. 열리기 전에는 state가 없으므로
  // "연결 중" 화면을 먼저 보여준다.
  const [isConnected, setIsConnected] = useState(false);

  const agent = useAgent<ChattingRoomAgent, PingPongState>({
    // 클래스 이름 ChattingRoomAgent가 kebab-case로 변환된 이름.
    // 워커 쪽 바인딩 이름과 일치해야 한다 (3.1에서 강사가 겪은 에러 지점!).
    agent: "chatting-room-agent",

    // 연결이 열리는 순간 호출된다.
    onOpen() {
      setIsConnected(true);
    },

    // 백엔드 에이전트가 setState를 할 때마다 새 상태가 여기로 밀려온다.
    // 폴링도, 수동 fetch도 없다 — 이게 Agent 플랫폼의 핵심 매력.
    onStateUpdate(state) {
      setPingPongs(state.pingPongCount);
    },
  });
  // (3.1의 `void agent;` 임시 참조는 3.2에서 agent를 실제로 쓰게 되면서 제거)

  if (!isConnected) {
    return <h1>Connecting...</h1>;
  }

  return (
    <div>
      <h1>Ping Pong Agent</h1>
      {/* 이 숫자는 에이전트의 SQLite에 저장된 상태에서 실시간으로 온 값이다 */}
      <h3>Ping pong count: {pingPongs}</h3>
      <hr />
      {/* 3.2 — @callable 메서드 호출. agent.stub이 원격 메서드의 대리 객체다.
          실제 setState는 서버 안에서 실행된다 (source: "server"). */}
      <button onClick={() => agent.stub.decrement()}>decrement</button>
      <button onClick={() => agent.stub.increment()}>increment</button>
      {/* 3.2 — override: 서버 메서드를 거치지 않고 프론트가 상태를 직접
          덮어쓴다 (source: WebSocket 연결). 지금은 아무 클라이언트나 이걸 할 수
          있는 보안 구멍이라 데모용 — 실전에서는 @callable 메서드 안에서 검증하고,
          뒤 강의의 read-only connections로 막는다. */}
      <button onClick={() => agent.setState({ pingPongCount: 10000 })}>override</button>
    </div>
  );
}

export default App;
