/**
 * 3.1~3.5 — Agent 상태 실시간 구독 + 채팅방 프론트엔드
 *
 * 핵심: useAgent 훅 하나로 WebSocket 연결 + 상태 동기화가 끝난다.
 * - 3.5(Authentication): 닉네임을 확정해야(enabled) 연결이 시작되고,
 *   닉네임은 query 옵션으로 접속 URL에 실려 서버 onConnect에 전달된다.
 *   접속하면 loadHistory RPC로 과거 메시지를 받고, 새 메시지는
 *   onMessage(WebSocket)로 이어붙인다 — 출처만 다를 뿐 같은 Message 모양이다.
 * - 핑퐁(@callable stub 호출, override) 버전은 3.2 커밋에 남아 있다.
 */
import { useState } from "react";
// useAgent는 React 전용 서브패키지에서 온다 (agents/react — 프레임워크 문법)
import { useAgent } from "agents/react";
// 백엔드(worker/index.ts)에서 export한 타입을 그대로 가져온다.
// 백엔드와 프론트엔드가 같은 타입을 쓰므로 상태 구조가 어긋날 수 없다.
import type { ChattingRoomAgent, ChattingRoomState } from "../worker";

/**
 * SQL messages 테이블의 한 줄과 같은 모양.
 * DB에서 온 과거 메시지든 방금 WebSocket으로 온 메시지든 이 타입으로 다룬다.
 * (함정: 브로드캐스트로 오는 실시간 메시지에는 id가 없다 — 서버가 INSERT
 *  결과의 id를 돌려주지 않기 때문. 그래서 목록 key로는 created_at을 쓴다)
 */
type Message = {
  id: number;
  nickname: string;
  message: string;
  created_at: number;
};

function App() {
  // WebSocket 연결이 열렸는지 여부. 열리기 전에는 닉네임 입력 화면을 보여준다.
  const [isConnected, setIsConnected] = useState(false);

  // 입력 중인 메시지 (평범한 React 폼 상태)
  const [message, setMessage] = useState("");

  // 화면에 뿌릴 메시지 목록 (히스토리 + 실시간 수신 누적)
  const [messages, setMessages] = useState<Message[]>([]);

  // 3.5 — 닉네임 입력값과, 연결 시작 스위치
  const [nickname, setNickname] = useState("");
  const [ready, setReady] = useState(false);

  const agent = useAgent<ChattingRoomAgent, ChattingRoomState>({
    // 클래스 이름 ChattingRoomAgent가 kebab-case로 변환된 이름.
    // (강사는 'ChattingRoomAgent'를 그대로 넘긴다 — SDK가 알아서 변환하므로
    //  둘 다 같은 에이전트에 붙는다)
    agent: "chatting-room-agent",

    // 3.5 — 접속 URL 쿼리 파라미터로 서버에 전달된다 (onConnect에서 파싱).
    query: { nickname },

    // 3.5 — false면 훅이 마운트돼도 연결하지 않는다. 닉네임 확정으로
    // ready가 true가 되면 그때 연결 — "인증 뒤에만 연결" 패턴의 축소판.
    enabled: ready,

    // 연결이 열리면: 접속 화면 해제 + 과거 메시지 로드.
    // loadHistory는 WebSocket 메시지가 아니라 @callable RPC라 await가 된다.
    onOpen: async () => {
      setIsConnected(true);
      const history = (await agent.stub.loadHistory()) as Message[];
      setMessages(history);
    },

    // 브로드캐스트로 도착한 새 메시지. WebSocket은 문자열만 오가므로
    // JSON.parse로 객체로 복원해서 목록 뒤에 이어붙인다.
    onMessage: (event) => setMessages((prev) => [...prev, JSON.parse(event.data)]),

    // 3.2에서 배운 것: onStateUpdate 콜백은 필수가 아니다 —
    // agent.state를 JSX에서 직접 읽어도 상태가 바뀌면 갱신된다.
    // onStateUpdate: (state) => ...,
  });

  // 폼 제출 → WebSocket으로 에이전트의 onMessage에 도착한다.
  const sendMessage = () => {
    agent.send(message);
    setMessage("");
  };

  const onConfirm = () => {
    setReady(true);
  };

  // 3.5 — 연결 전에는 닉네임 입력 화면.
  // (enabled: ready 덕분에 confirm 전에는 연결 자체가 시작되지 않는다)
  if (!isConnected) {
    return (
      <div>
        <h1>who are you?</h1>
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="Type a nickname"
          autoFocus
        />
        <button onClick={onConfirm}>confirm</button>
      </div>
    );
  }

  return (
    <div>
      <h1>Chatting Room Agent</h1>
      {/* 접속자 수 — 에이전트의 onConnect/onClose가 setState한 값이
          모든 클라이언트에 실시간으로 브로드캐스트된 것이다 */}
      <h3>Online ppl: {agent?.state?.currentlyOnline}</h3>
      <hr />
      <ul>
        {/* key는 React 목록 렌더링의 필수 규칙 (강사 코드에는 없어서 추가).
            실시간 메시지에는 id가 없어 created_at을 쓴다 — 같은 밀리초에
            두 메시지가 오면 겹칠 수 있지만 학습용 예제라 감수한다. */}
        {messages.map((m) => (
          <li key={m.created_at}>
            <strong>{m.nickname}</strong>: {m.message}
          </li>
        ))}
      </ul>
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
