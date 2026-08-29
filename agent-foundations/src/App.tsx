/**
 * 3.1 — 프론트엔드에서 Agent 상태 실시간 구독하기
 *
 * 핵심: useAgent 훅 하나로 WebSocket 연결 + 상태 동기화가 끝난다.
 * API를 만들 필요도, fetch를 할 필요도 없다.
 * - 훅이 마운트되면 `/agents/chatting-room-agent/<이름>` 으로
 *   WebSocket 업그레이드 요청을 자동으로 보낸다.
 * - 워커의 routeAgentRequest()가 이 요청을 받아 에이전트에 연결해 준다.
 */
import { useState } from "react";
// useAgent는 React 전용 서브패키지에서 온다 (agents/react — 프레임워크 문법)
import { useAgent } from "agents/react";
// 백엔드(worker/index.ts)에서 export한 타입을 그대로 가져온다.
// 백엔드와 프론트엔드가 같은 타입을 쓰므로 상태 구조가 어긋날 수 없다.
import type { ChattingRoomAgent, PingPongState } from "../worker";

function App() {
  // 서버 상태의 로컬 복사본. onStateUpdate로 받은 값을 여기 담아 렌더링한다.
  // (agent.state를 직접 읽는 것보다 React 상태에 담는 편이 안전하다 — 강의 방식)
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

  // 3.1 시점에는 agent 객체를 아직 직접 쓰지 않는다 (3.2에서 increment/decrement
  // 호출에 사용 예정). 이 프로젝트는 noUnusedLocals가 켜져 있어 안 쓰는 변수는
  // 컴파일 에러가 나므로, 임시로 참조만 해 둔다.
  void agent;

  if (!isConnected) {
    return <h1>Connecting...</h1>;
  }

  return (
    <div>
      <h1>Ping Pong Agent</h1>
      {/* 이 숫자는 에이전트의 SQLite에 저장된 상태에서 실시간으로 온 값이다 */}
      <h3>Ping pong count: {pingPongs}</h3>
      {/* agent 객체(increment/decrement 호출)는 다음 강의 3.2에서 사용한다 */}
    </div>
  );
}

export default App;
