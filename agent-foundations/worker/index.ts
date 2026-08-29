/**
 * ============================================================
 * 3.0 — Agent Foundations 프로젝트 셋업
 * ============================================================
 *
 * Agent 클래스는 Durable Object 위에 얹힌 고수준 추상화다.
 * DO가 주는 것(고유 인스턴스, SQLite 저장소, WebSocket)을 전부 갖고 있지만
 * API가 훨씬 편하다. `npm install agents`로 설치했다.
 *
 * 이번 섹션 목표: 지난 섹션의 DO 채팅방을 Agent 클래스로 다시 만들기.
 * 이번에는 콘솔이 아니라 React 프론트엔드로 (아직 AI는 없음).
 */
import { Agent } from "agents";

/**
 * 채팅방 에이전트. 아직 비어 있다 — 3.1에서 state를 채운다.
 * Agent도 결국 Durable Object이므로 wrangler.jsonc에
 * DO 바인딩 + new_sqlite_classes 마이그레이션을 추가해야 한다.
 */
export class ChattingRoomAgent extends Agent<Env> {}

export default {
  // 3.0 시점에는 자리만 잡아 둔다. 프론트엔드를 에이전트에 연결하는
  // 라우팅(routeAgentRequest)은 3.1에서 추가한다.
  async fetch() {
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
