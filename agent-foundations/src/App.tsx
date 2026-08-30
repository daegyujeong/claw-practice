/**
 * 3.1~3.3 — Agent 상태 실시간 구독 + 채팅방 프론트엔드
 *
 * 핵심: useAgent 훅 하나로 WebSocket 연결 + 상태 동기화가 끝난다.
 * API를 만들 필요도, fetch를 할 필요도 없다.
 * - 훅이 마운트되면 `/agents/chatting-room-agent/<이름>` 으로
 *   WebSocket 업그레이드 요청을 자동으로 보낸다.
 * - 3.3(Messages): 핑퐁 버튼 대신 메시지 폼 — agent.send로 보내고,
 *   에이전트의 회신은 onMessage(event.data)로 받는다.
 *   핑퐁(@callable stub 호출, override) 버전은 3.2 커밋에 남아 있다.
 */
import { useState } from "react";
// useAgent는 React 전용 서브패키지에서 온다 (agents/react — 프레임워크 문법)
import { useAgent } from "agents/react";
// 백엔드(worker/index.ts)에서 export한 타입을 그대로 가져온다.
// 백엔드와 프론트엔드가 같은 타입을 쓰므로 상태 구조가 어긋날 수 없다.
import type { ChattingRoomAgent, ChattingRoomState } from "../worker";

function App() {
  // WebSocket 연결이 열렸는지 여부. 열리기 전에는 state가 없으므로
  // "연결 중" 화면을 먼저 보여준다.
  const [isConnected, setIsConnected] = useState(false);

  // 입력 중인 메시지 (평범한 React 폼 상태)
  const [message, setMessage] = useState("");

  const agent = useAgent<ChattingRoomAgent, ChattingRoomState>({
    // 클래스 이름 ChattingRoomAgent가 kebab-case로 변환된 이름.
    // (강사는 'ChattingRoomAgent'를 그대로 넘긴다 — SDK가 알아서 변환하므로
    //  둘 다 같은 에이전트에 붙는다)
    agent: "chatting-room-agent",

    // 연결이 열리는 순간 호출된다.
    onOpen() {
      setIsConnected(true);
    },

    // 3.3 — 에이전트가 connection.send로 보낸 메시지가 여기로 온다.
    // 실제 내용은 event.data에 있다 (콘솔에서 구조 확인용 로그).
    onMessage: (event) => console.log(event),

    // 3.2에서 배운 것: onStateUpdate 콜백은 필수가 아니다 —
    // 아래처럼 agent.state를 JSX에서 직접 읽어도 상태가 바뀌면 갱신된다.
    // 상태 변경 순간마다 다른 로직(로그, 알림)을 끼우고 싶을 때만 쓴다.
    // onStateUpdate: (state) => ...,
  });

  // 폼 제출 → WebSocket으로 에이전트의 onMessage에 도착한다.
  const sendMessage = () => {
    agent.send(message);
    setMessage("");
  };

  if (!isConnected) {
    return <h1>Connecting...</h1>;
  }

  return (
    <div>
      <h1>Chatting Room Agent</h1>
      {/* 접속자 수 — 에이전트의 onConnect/onClose가 setState한 값이
          모든 클라이언트에 실시간으로 브로드캐스트된 것이다 */}
      <h3>Online ppl: {agent?.state?.currentlyOnline}</h3>
      <hr />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage();
        }}
      >
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type a message..."
          autoFocus
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}

export default App;
