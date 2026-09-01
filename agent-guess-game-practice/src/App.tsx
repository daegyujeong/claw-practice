/**
 * Who Am I? — 스무고개 프론트엔드
 *
 * 훅이 두 개다. 역할이 다르다.
 *   useAgent     : 에이전트와의 연결 그 자체. 상태 브로드캐스트(onStateUpdate)와
 *                  @callable 메서드 호출(agent.stub.*)을 담당한다.
 *   useAgentChat : 그 연결 위에서 "채팅"만 얹어 준다. 메시지 목록·전송·스트리밍 처리.
 */
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent } from "agents/react";
import { useState } from "react";
// 값(함수)까지 가져온다: 후보 목록 자체는 비밀이 아니다.
// 비밀은 "그중 어느 것이 뽑혔는지"이고, 그건 서버 상태에만 있다.
import { COUNTRIES, getCountry } from "../worker/countries";
import type { GuessGameAgent, GuessGameState } from "../worker";
import "./App.css";

function App() {
  const [game, setGame] = useState<GuessGameState | null>(null);

  const agent = useAgent<GuessGameAgent, GuessGameState>({
    agent: "GuessGameAgent",
    name: "guess-room",
    // 서버가 setState 할 때마다 여기로 밀려온다 → 질문 수·정답 여부가 실시간 갱신
    onStateUpdate(state: GuessGameState) {
      setGame(state);
    },
  });

  const { messages, sendMessage, clearHistory } = useAgentChat({ agent });

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const text = (formData.get("input") as string).trim();
    if (!text) return;
    sendMessage({ text });
    e.currentTarget.reset();
  };

  // New game: 서버 상태를 새 라운드로 되돌리고(=@callable), 화면의 대화도 비운다.
  const handleNewGame = async () => {
    await agent.stub.newGame();
    clearHistory();
  };

  const solved = game?.solved ?? false;
  const answer = game && solved ? getCountry(game.secret) : null;

  return (
    <main className="app">
      <header className="header">
        <h1>Who Am I?</h1>
        <p className="subtitle">
          나는 나라 {COUNTRIES.length}개 중 하나입니다. 질문을 던져 정체를
          맞혀보세요.
        </p>
        <div className="scoreboard">
          <span className="badge">질문 {game?.questionCount ?? 0}개</span>
          <span className={solved ? "badge badge-solved" : "badge"}>
            {solved ? "정답!" : "진행 중"}
          </span>
          <button type="button" className="ghost" onClick={handleNewGame}>
            New game
          </button>
        </div>
      </header>

      {answer && (
        <div className="reveal">
          정답은 <strong>{answer.ko}</strong> ({answer.en}) 였습니다 🎉
        </div>
      )}

      <ul className="messages">
        {messages.length === 0 && (
          <li className="hint">
            예: "살아 있나요?" / "유럽에 있나요?" / "바다에 접해 있나요?"
          </li>
        )}
        {messages.map((message) => (
          <li key={message.id} className={`msg msg-${message.role}`}>
            <span className="who">
              {message.role === "user" ? "나" : "정체불명"}
            </span>
            <div className="bubble">
              {/* text 파트만 그린다. reasoning은 서버에서 아예 안 보내지만(sendReasoning: false),
                  여기서도 한 번 더 막아 둔다 — 이중 잠금. */}
              {message.parts.map((part, index) =>
                part.type === "text" ? <span key={index}>{part.text}</span> : null,
              )}
            </div>
          </li>
        ))}
      </ul>

      <form className="composer" onSubmit={handleSubmit}>
        <input
          name="input"
          autoComplete="off"
          placeholder={
            solved ? "New game을 눌러 새 라운드를 시작하세요" : "질문을 입력하세요..."
          }
        />
        <button type="submit">보내기</button>
      </form>
    </main>
  );
}

export default App;
