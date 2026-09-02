/**
 * ============================================================
 * Section 4 — 툴(도구) 정의 (4.4 Tools)
 * ============================================================
 *
 * "툴"은 모델이 필요할 때 호출할 수 있는 함수다. 모델은 우리 코드를 직접
 * 실행하지 못한다 — 대신 ① 툴의 이름·설명·입력 형식을 보고 ② "이 툴을 이 인자로
 * 불러 달라"는 요청(tool call)을 응답에 섞어 보내고 ③ 우리가 실행한 결과를
 * 다시 받아 최종 답을 만든다. 툴이 생기는 순간 "챗봇"이 "에이전트"가 된다.
 *
 * 강사는 index.ts 안에 인라인으로 만들어도 된다고 보여 준 뒤 별도 파일로 뺐다.
 * 툴이 늘어날수록 onChatMessage가 지저분해지므로 처음부터 분리한다.
 */

// tool(): AI SDK의 툴 정의 헬퍼. 객체 리터럴을 그냥 넘겨도 되지만 tool()로 감싸면
//   inputSchema로부터 execute 인자의 타입이 자동 추론된다 (아래 ({ city }) 참고).
import { tool } from "ai";
// zod: 4.0에서 설치만 해 뒀던 스키마 검증 라이브러리. 여기서 세 가지 일을 한다.
//   ① 모델에게 보낼 "입력 형식 설명"(JSON Schema로 변환돼 전달됨)
//   ② 모델이 보낸 인자가 형식에 맞는지 런타임 검증 (틀리면 툴이 실행되지 않음)
//   ③ execute 매개변수의 TypeScript 타입 추론
import z from "zod";

/**
 * 도시의 날씨를 알려 주는 툴 — 강의의 첫 예제. 진짜 API 대신 하드코딩된 문자열을
 * 돌려주지만, 모델 입장에서는 "외부 세계에서 온 정보"와 다를 게 없다.
 */
export const getWeather = tool({
  // title: 사람이 읽는 표시용 이름. 모델이 실제로 쓰는 이름은 아래 index.ts의
  //   tools: { getWeather } 객체 키다 (없어도 동작한다).
  title: "GetWeather",
  // description: 모델이 "언제 이 툴을 쓸지" 판단하는 근거. 명확하게 쓸수록
  //   엉뚱한 상황에서 호출되는 일이 줄어든다.
  description: "Get the weather of a city",
  // inputSchema: "이 툴을 부를 때 넘겨야 하는 데이터의 모양". 필드마다 .meta()로
  //   설명과 예시를 붙이면 모델이 인자를 더 정확히 채운다.
  //   (.meta()는 zod 4 문법. zod 3에서는 .describe("...")만 가능했다.)
  inputSchema: z.object({
    city: z.string().meta({
      description:
        "The name of the city you want to get the weather from (ie: Malaga)",
    }),
  }),
  // execute: 모델이 이 툴을 호출하기로 결정하면 **서버(DO 안)** 에서 실행된다.
  //   인자는 inputSchema를 통과한 값 — city가 string임이 보장된다.
  //   반환값은 그대로 모델에게 "툴 결과"로 전달된다.
  execute: ({ city }) => {
    return `The weather in the ${city} is sunny.`;
  },
});

/**
 * 4.5 — 브라우저에서 실행되는 툴. **execute가 없다**는 것이 전부다.
 *
 * execute가 없으면 모델(정확히는 AI SDK)은 "이 툴은 서버가 실행 못 하니 클라이언트에
 * 넘긴다"고 판단해 tool call만 스트림으로 내려보내고 결과를 기다린다. 프론트의
 * useAgentChat({ onToolCall })이 그 요청을 받아 실행하고 addToolOutput으로 결과를
 * 돌려주면 서버가 대화를 자동으로 이어 간다. 위치·카메라·클립보드처럼 브라우저에만
 * 있는 API를 모델이 쓰게 하는 방법이다.
 *
 * ⚠️ 4.6 강의 중 강사가 buyPlaneTicket의 return을 빼먹었을 때 모델이 이 툴을
 *    "브라우저 툴"로 오해했다 — execute의 유무가 곧 실행 위치 결정이라는 뜻.
 */
export const getLocation = tool({
  title: "getLocation",
  description: "Use this to get the user location",
  // 입력이 없어도 스키마는 빈 객체로 줘야 한다 (모델에게 "인자 없음"을 알리는 것).
  inputSchema: z.object({}),
});
