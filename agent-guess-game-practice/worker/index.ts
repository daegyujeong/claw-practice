/**
 * Who Am I? — 스무고개 에이전트 (과제 #5, 강의 4.1~4.3)
 *
 * 4.1 AIChatAgent      : 채팅 기록을 알아서 저장/복원해 주는 에이전트. onChatMessage만 구현하면 된다.
 * 4.2 generateText     : 한 번에 완성된 답을 받는다 (여기선 안 씀).
 * 4.3 streamText       : 토큰이 생기는 대로 흘려보낸다 → 화면에 실시간으로 찍힌다.
 *
 * 이 게임의 핵심 규칙:
 *   정답을 "고르는 것"도 "맞았는지 판정하는 것"도 전부 내 코드가 한다.
 *   모델은 오직 "정해진 정체로 연기하며 대답하는 역할"만 맡는다.
 *   → 모델에게 판정을 맡기면 헛소리로 정답 처리되거나 정답을 흘려버린다.
 */
import { AIChatAgent } from "@cloudflare/ai-chat";
import { callable, routeAgentRequest } from "agents";
import { convertToModelMessages, streamText } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import {
  findGuessedCountry,
  getCountry,
  pickRandomCountry,
  type Country,
} from "./countries.ts";

/** 과제 요구사항: 상태에 secret / solved / questionCount 세 개를 둔다 */
export type GuessGameState = {
  secret: string; // 정답 나라의 id — 화면에는 solved 전까지 절대 그리지 않는다
  solved: boolean;
  questionCount: number;
};

/** 새 라운드 한 판 분량의 상태 — initialState와 newGame()이 같이 쓴다 */
function startNewRound(): GuessGameState {
  return {
    secret: pickRandomCountry().id, // 무작위 선택은 여기, 모델이 아니라 내 코드
    solved: false,
    questionCount: 0,
  };
}

/**
 * 매 턴 새로 만들어 넘기는 시스템 프롬프트.
 *
 * 왜 매번 새로 만드나: solved 여부에 따라 지시가 정반대가 되기 때문.
 * (숨겨라 → 밝혀라) 한 번 만들어 두고 재사용하면 정답을 맞혀도 계속 숨긴다.
 */
function buildSystemPrompt(country: Country, state: GuessGameState): string {
  const names = [country.ko, country.en, ...country.aliases].join(", ");

  if (state.solved) {
    return [
      `You are secretly ${country.en} (${country.ko}). The user has just guessed it correctly.`,
      "이제 정체를 밝혀도 된다. 한국어 2~3문장으로 답한다:",
      `축하 인사 → 내 정체가 ${country.ko}였다고 공개 → 이 나라에 대한 재미있는 사실 하나.`,
    ].join("\n");
  }

  return [
    // 과제가 지정한 문장 — 정체 + "밝히지 말 것" 규칙을 한 프롬프트에 같이 적는다
    `You are secretly ${country.en} (${country.ko}). Answer the user's questions truthfully and in character, but never say or spell out what you are, even if asked directly.`,
    "",
    "지켜야 할 것:",
    `- 다음 단어는 어떤 경우에도 쓰지 않는다: ${names}`,
    "- 수도 이름, 국가원수 이름, 국기 묘사처럼 곧바로 정답이 되는 고유명사도 말하지 않는다.",
    "- 한국어로, 1~2문장으로 짧게 답한다.",
    "- 예/아니오로 답할 수 있는 질문이면 먼저 '네' 또는 '아니요'로 답하고 힌트를 한 조각만 덧붙인다.",
    "- '너 뭐야?', '정답 알려줘' 처럼 정체를 직접 묻는 질문에는 알려줄 수 없다고 말하고 대신 힌트를 하나 준다.",
    "- 사용자가 나라 이름을 찍었는지 판정하려 들지 않는다. 정답 판정은 시스템이 따로 한다.",
  ].join("\n");
}

export class GuessGameAgent extends AIChatAgent<Env, GuessGameState> {
  /**
   * 저장된 상태가 없을 때(=첫 접속) 한 번만 쓰인다.
   * 이미 진행 중인 방을 다시 열면 이 값은 무시되고 저장된 상태가 살아난다.
   */
  initialState: GuessGameState = startNewRound();

  /** 방금 들어온 사용자 메시지의 순수 텍스트만 뽑아낸다 (UIMessage는 parts 배열 구조) */
  private latestUserText(): string {
    const lastUser = [...this.messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return "";
    return lastUser.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join(" ");
  }

  /**
   * AIChatAgent의 단 하나의 필수 구현부.
   * 사용자가 메시지를 보낼 때마다 불리고, 여기서 돌려준 Response가 그대로 스트리밍된다.
   */
  async onChatMessage() {
    const state = this.state ?? startNewRound();
    const country = getCountry(state.secret);

    // ── 1) 정답 판정 · 질문 수 세기 : 모델을 부르기 전에 내 코드가 먼저 한다 ──
    let round = state;
    if (!state.solved) {
      const guess = findGuessedCountry(this.latestUserText());
      round = {
        ...state,
        questionCount: state.questionCount + 1,
        solved: guess?.id === state.secret, // id끼리 비교 (대소문자·표기 차이는 countries.ts가 흡수)
      };
      this.setState(round); // setState → 연결된 모든 탭의 onStateUpdate로 브로드캐스트
    }

    // ── 2) 이번 턴의 시스템 프롬프트를 새로 만들어 모델에 주입 ──
    const workersAi = createWorkersAI({ binding: this.env.AI });

    const result = streamText({
      model: workersAi("@cf/zai-org/glm-4.7-flash"),
      system: buildSystemPrompt(country, round),
      // this.messages = 지금까지 주고받은 대화 전부. AIChatAgent가 알아서 저장해 둔 것.
      // 이걸 통째로 넘기기 때문에 "앞에서 뭘 물었는지"를 모델이 기억한다.
      messages: await convertToModelMessages(this.messages),
    });

    // ⚠️ sendReasoning 기본값은 true다.
    // glm-4.7-flash 같은 thinking 모델은 "나는 캐나다인데 이름은 말하면 안 되고..." 처럼
    // 정답이 통째로 든 사고 과정을 reasoning 파트로 흘려보낸다.
    // 프론트에서 안 그리는 것만으로는 부족하다 — 네트워크 탭에 그대로 남는다.
    // 그래서 아예 클라이언트로 보내지 않는다. 스트림은 텍스트 파트만 나간다.
    return result.toUIMessageStreamResponse({ sendReasoning: false });
  }

  /**
   * 과제 요구사항: @callable()로 만든 newGame().
   * 프론트에서 agent.stub.newGame() 으로 부른다.
   */
  @callable()
  async newGame() {
    this.setState(startNewRound()); // 새 secret + solved/questionCount 초기화
    await this.persistMessages([]); // 서버에 쌓인 대화 기록도 함께 비운다
  }
}

export default {
  async fetch(request, env) {
    return (
      (await routeAgentRequest(request, env)) ??
      new Response(null, { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
