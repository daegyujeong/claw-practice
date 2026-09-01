/**
 * Section 4 — AIChatAgent 프론트엔드 (4.1 ~ 4.3)
 *
 * Section 3에서는 useAgent 하나로 상태를 구독하고, 메시지 송수신·히스토리 로딩을
 * 직접 짰다(agent.send / onMessage / loadHistory RPC). 이번에는 useAgentChat 훅이
 * 그 전부를 대신한다: messages 배열, sendMessage, clearHistory, 스트리밍 반영까지.
 * 서버 쪽 onChatMessage와 짝을 이루는 "채팅 UI 표준 배선"이다.
 */

// useAgentChat: agents/ai-react는 @cloudflare/ai-chat/react를 재export하는 경로다.
//   강사 저장소도 이후 템플릿에서 import를 "@cloudflare/ai-chat/react"로 옮겼다 —
//   둘 다 동작하므로 강의 시점 코드(agents/ai-react)를 그대로 둔다.
import { useAgentChat } from "agents/ai-react";
// useAgent: Section 3과 같은 훅. WebSocket 연결 객체(agent)를 만든다.
import { useAgent } from "agents/react";

function App() {
  // 1) 먼저 에이전트 연결을 만든다. 이름은 워커의 클래스 이름과 같아야 한다.
  //    Section 3처럼 agent.state / agent.stub / agent.send 도 여전히 쓸 수 있다.
  const agent = useAgent({ agent: "PotatoChatAgent" });

  // 2) 그 연결을 useAgentChat에 넘기면 채팅에 필요한 것이 한 번에 나온다.
  //    messages: 이 대화의 전체 UIMessage 배열 (새로고침해도 서버 저장분이 복원됨
  //              — Section 3의 loadHistory를 직접 짤 필요가 없다)
  //    sendMessage: 사용자 메시지를 보낸다 → 서버 onChatMessage 실행
  //    clearHistory: 서버 저장 메시지 전체 삭제 (4.2). Section 3이었으면
  //                  @callable + DELETE FROM 을 직접 짰을 일이다.
  //    이 밖에 status("submitted" | "streaming" | "ready" | "error"), stop,
  //    regenerate, isStreaming 등도 나온다 — 과제(타이핑 인디케이터)에서 쓴 것들.
  const { messages, sendMessage, clearHistory } = useAgentChat({ agent });

  /**
   * 폼 제출 → sendMessage. 비제어(uncontrolled) 폼이라 useState가 없다:
   * FormData로 input 값을 꺼내고 reset()으로 비운다. (React 문법이 아니라
   * 브라우저 표준 Web API — FormData, HTMLFormElement.reset)
   */
  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const message = formData.get("input") as string;
    // { text } 형태로 보내면 훅이 { role: "user", parts: [{ type: "text", text }] }
    // UIMessage로 감싸 서버에 보낸다. 서버는 이걸 먼저 저장한 뒤 onChatMessage를 부른다.
    sendMessage({ text: message });
    e.currentTarget.reset();
  };

  return (
    <div>
      <ul>
        {messages.map((message) => (
          // id는 서버(AIChatAgent)가 붙여 준다 — key로 바로 쓸 수 있다.
          <li key={message.id}>
            {/* role은 "user" | "assistant" | "system" — 모델 API의 표준 역할 이름 */}
            <strong>{message.role}:</strong>
            {/*
              message.text 같은 게 없고 parts 배열을 도는 이유:
              모델 메시지는 텍스트·이미지·파일·툴 호출·reasoning 등 여러 조각으로
              이뤄질 수 있다는 것이 AI SDK(그리고 모델 API들)의 표준 구조라서다.
              4.3의 스트리밍도 "이 parts가 조각조각 채워지는 것"이다.
            */}
            {message.parts.map((part, index) =>
              part.type === "text" ? (
                <span key={index}>{part.text}</span>
              ) : part.type === "reasoning" ? (
                // 4.3 — glm-4.7-flash 같은 모델은 답하기 전 "생각 과정"을
                //   reasoning 파트로 보낸다. 표시하지 않으면 답이 나오기 전까지
                //   화면이 멈춘 듯 보이므로 <em>으로 구분해 보여 준다.
                //   (스무고개 과제에서는 이 파트로 정답이 새는 것이 문제였다.)
                <em key={index}>{part.text}</em>
              ) : (
                // 그 밖의 파트(tool-*, file, source-url …)는 아직 안 그린다 —
                //   4.4 Tools부터 필요해진다.
                null
              ),
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={handleSubmit}>
        <input name="input" placeholder="Type a message..." />
        <button type="submit">Send</button>
      </form>
      {/* 4.2 — 서버 저장소의 대화를 지운다. 브로드캐스트되므로 다른 탭도 함께 비워진다. */}
      <button onClick={clearHistory}>clear convo</button>
    </div>
  );
}

export default App;
