/**
 * Section 4 — AIChatAgent 프론트엔드 (4.1)
 *
 * Section 3에서는 useAgent 하나로 상태를 구독하고, 메시지 송수신·히스토리 로딩을
 * 직접 짰다(agent.send / onMessage / loadHistory RPC). 이번에는 useAgentChat 훅이
 * 그 전부를 대신한다. 이번 강의는 특이하게 프론트(폼)를 먼저 만들고 백엔드를 붙였다.
 */

// useAgentChat: agents/ai-react는 @cloudflare/ai-chat/react를 재export하는 경로다.
import { useAgentChat } from "agents/ai-react";
// useAgent: Section 3과 같은 훅. WebSocket 연결 객체(agent)를 만든다.
import { useAgent } from "agents/react";

function App() {
  // 1) 먼저 에이전트 연결을 만든다. 이름은 워커의 클래스 이름과 같아야 한다.
  const agent = useAgent({ agent: "PotatoChatAgent" });

  // 2) 그 연결을 useAgentChat에 넘기면 채팅에 필요한 것이 한 번에 나온다.
  //    messages: 이 대화의 전체 UIMessage 배열 (새로고침해도 서버 저장분이 복원됨)
  //    sendMessage: 사용자 메시지를 보낸다 → 서버 onChatMessage 실행
  //    (status 등 다른 값들은 뒤에서)
  const { messages, sendMessage } = useAgentChat({ agent });

  /**
   * 폼 제출 → sendMessage. 비제어 폼이라 useState가 없다:
   * FormData로 input 값을 꺼내고 reset()으로 비운다 (브라우저 표준 Web API).
   */
  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const message = formData.get("input") as string;
    // { text } 로 보내면 훅이 { role: "user", parts: [{ type: "text", text }] }로 감싼다.
    sendMessage({ text: message });
    e.currentTarget.reset();
  };

  return (
    <div>
      <ul>
        {messages.map((message) => (
          // id는 서버(AIChatAgent)가 붙여 준다 — key로 바로 쓸 수 있다.
          <li key={message.id}>
            {/* role은 "user" | "assistant" — 모델 API의 표준 역할 이름 */}
            <strong>{message.role}:</strong>
            {/* 메시지는 parts 배열 — 지금은 text 파트만 그린다 */}
            {message.parts.map((part, index) =>
              part.type === "text" ? (
                <span key={index}>{part.text}</span>
              ) : null,
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={handleSubmit}>
        <input name="input" placeholder="Type a message..." />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}

export default App;
