/**
 * Section 4 — AIChatAgent 프론트엔드 (4.1 ~ 4.4)
 *
 * Section 3에서는 useAgent 하나로 상태를 구독하고, 메시지 송수신·히스토리 로딩을
 * 직접 짰다(agent.send / onMessage / loadHistory RPC). 이번에는 useAgentChat 훅이
 * 그 전부를 대신한다: messages 배열, sendMessage, clearHistory, 스트리밍 반영까지.
 * 서버 쪽 onChatMessage와 짝을 이루는 "채팅 UI 표준 배선"이다.
 *
 * 4.4에서 바뀐 것: ① Tailwind로 UI 정리(강사가 "링크의 코드를 복사하라"고 한 부분)
 * ② parts를 그리는 로직을 renderMessage 함수로 분리 ③ 툴 호출 파트(tool-*) 렌더
 * ④ status 표시. 데이터 흐름(useAgent → useAgentChat → parts.map)은 그대로다.
 */

// useAgentChat: agents/ai-react는 @cloudflare/ai-chat/react를 재export하는 경로다.
//   강사 저장소도 이후 템플릿에서 import를 "@cloudflare/ai-chat/react"로 옮겼다 —
//   둘 다 동작하므로 강의 시점 코드(agents/ai-react)를 그대로 둔다.
import { useAgentChat } from "agents/ai-react";
// useAgent: Section 3과 같은 훅. WebSocket 연결 객체(agent)를 만든다.
import { useAgent } from "agents/react";
// 4.4 — 툴 파트를 그리기 위한 AI SDK 헬퍼(프론트에서도 `ai` 패키지를 쓴다).
//   isToolUIPart: part.type이 "tool-<이름>" 또는 "dynamic-tool"인지 판별
//   getToolName: "tool-getWeather" → "getWeather" 처럼 툴 이름만 꺼낸다
//   UIMessage: 저장·화면용 메시지 타입 (id, role, parts[])
import { getToolName, isToolUIPart, type UIMessage } from "ai";

function App() {
  // 1) 먼저 에이전트 연결을 만든다. 이름은 워커의 클래스 이름과 같아야 한다.
  //    Section 3처럼 agent.state / agent.stub / agent.send 도 여전히 쓸 수 있다.
  const agent = useAgent({ agent: "PotatoChatAgent" });

  // 2) 그 연결을 useAgentChat에 넘기면 채팅에 필요한 것이 한 번에 나온다.
  //    messages: 이 대화의 전체 UIMessage 배열 (새로고침해도 서버 저장분이 복원됨)
  //    sendMessage: 사용자 메시지를 보낸다 → 서버 onChatMessage 실행
  //    clearHistory: 서버 저장 메시지 전체 삭제 (4.2)
  //    status (4.4): "submitted" | "streaming" | "ready" | "error" — 모델이 지금
  //      뭘 하는지. 화면에 그대로 찍어 보고, 나중에 로딩 UI의 재료로 쓴다.
  //      (스무고개 과제의 타이핑 인디케이터가 바로 이 값으로 만든 것.)
  const { messages, sendMessage, clearHistory, status } = useAgentChat({
    agent,
  });

  /**
   * 폼 제출 → sendMessage. 비제어(uncontrolled) 폼이라 useState가 없다:
   * FormData로 input 값을 꺼내고 reset()으로 비운다. (React 문법이 아니라
   * 브라우저 표준 Web API — FormData, HTMLFormElement.reset)
   */
  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const message = formData.get("input") as string;
    // 4.4 — 빈 문자열/공백만 보내는 것을 막는다 (빈 메시지도 모델 호출 = 비용).
    if (!message?.trim()) return;
    // { text } 형태로 보내면 훅이 { role: "user", parts: [{ type: "text", text }] }
    // UIMessage로 감싸 서버에 보낸다. 서버는 이걸 먼저 저장한 뒤 onChatMessage를 부른다.
    sendMessage({ text: message });
    e.currentTarget.reset();
  };

  /**
   * 메시지 하나의 parts 배열을 화면 조각으로 바꾼다 (4.4에서 함수로 분리).
   * message.text 같은 게 없고 parts를 도는 이유: 모델 메시지는 텍스트·reasoning·
   * 툴 호출 등 여러 조각으로 이뤄진다는 것이 AI SDK의 표준 구조라서다.
   * 스트리밍이란 "이 parts가 조각조각 채워지는 것"이다.
   */
  function renderMessage(msg: UIMessage) {
    return msg.parts.map((part, i) => {
      if (part.type === "text")
        return (
          <p key={i} className="whitespace-pre-wrap leading-relaxed">
            {part.text}
          </p>
        );
      if (part.type === "reasoning")
        // 4.3 — glm-4.7-flash 같은 모델은 답하기 전 "생각 과정"을 reasoning
        //   파트로 보낸다. 표시하지 않으면 답이 나오기 전까지 화면이 멈춘 듯 보인다.
        return (
          <p key={i} className="text-xs italic text-zinc-500">
            {part.text}
          </p>
        );
      // 4.4 — 툴 호출 파트. part.type은 "tool-getWeather"처럼 툴마다 다르므로
      //   문자열 비교 대신 isToolUIPart로 판별한다. 한 파트가 스트리밍 중에
      //   state를 바꿔 가며 갱신된다:
      //   input-streaming(인자 생성 중) → input-available(인자 확정, 실행 중)
      //   → output-available(결과 도착) / output-error(실행 실패)
      //   툴 이름·입력·출력을 그대로 보여 주는 "디버그 카드"다.
      if (isToolUIPart(part)) {
        return (
          <div
            key={i}
            className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs"
          >
            <div className="flex items-center gap-2">
              <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-white">
                {getToolName(part)}
              </span>
              <span className="text-zinc-500">{part.state}</span>
            </div>
            {/* input은 input-streaming 상태에서는 아직 없을 수 있어 존재 확인 */}
            {"input" in part && part.input != null && (
              <pre className="mt-1 overflow-x-auto text-zinc-600">
                {JSON.stringify(part.input, null, 2)}
              </pre>
            )}
            {/* output은 state가 output-available일 때만 타입상 존재한다 */}
            {part.state === "output-available" && (
              <pre className="mt-1 overflow-x-auto text-zinc-600">
                {JSON.stringify(part.output, null, 2)}
              </pre>
            )}
          </div>
        );
      }
      // 그 밖의 파트(file, source-url, step-start …)는 그리지 않는다.
      return null;
    });
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 text-zinc-900">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <h1 className="shrink-0 text-sm font-semibold tracking-tight">
            🥔 Potato Chat
          </h1>

          <form onSubmit={handleSubmit} className="flex flex-1 gap-2">
            <input
              name="input"
              placeholder="Type a message..."
              autoComplete="off"
              className="flex-1 rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
            />
            <button
              type="submit"
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
            >
              Send
            </button>
          </form>
          {/* 4.2 — 서버 저장소의 대화를 지운다. 브로드캐스트되므로 다른 탭도 함께 비워진다. */}
          <button
            onClick={clearHistory}
            className="shrink-0 rounded-md px-2 py-1 text-xs text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          >
            Clear
          </button>
          {/* 4.4 — 모델 상태를 날것으로 표시 (submitted → streaming → ready) */}
          {status}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-6 pb-24">
        <div className="flex-1 space-y-4">
          {messages.length === 0 && (
            <div className="flex h-full min-h-[40vh] items-center justify-center text-sm text-zinc-400">
              Say something to get started.
            </div>
          )}
          {messages.map((message) => {
            // role은 "user" | "assistant" | "system" — 모델 API의 표준 역할 이름.
            const isUser = message.role === "user";
            return (
              // id는 서버(AIChatAgent)가 붙여 준다 — key로 바로 쓸 수 있다.
              <div
                key={message.id}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${isUser
                      ? "bg-zinc-900 text-white"
                      : "border border-zinc-200 bg-white text-zinc-900"
                    }`}
                >
                  {renderMessage(message)}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

export default App;
