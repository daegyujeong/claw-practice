/**
 * ─────────────────────────────────────────────────────────────
 * 2.2 Using Durable Objects — 첫 Durable Object
 * ─────────────────────────────────────────────────────────────
 * 워커(Section 1)는 요청마다 생겼다 사라지는 "함수"라서 아무것도 기억하지 못한다.
 * 그래서 채팅방·멀티플레이어 게임·AI 에이전트처럼
 * "여러 사용자가 같은 서버에 붙어서 실시간으로 상태를 공유"하는 앱은 워커만으로 못 만든다.
 *
 * Durable Object(DO) = "이름당 전 세계에 딱 하나만 존재하는 작은 컴퓨터"
 *   - 어느 지역에서 요청해도 같은 이름이면 같은 객체로 연결된다 (유일하게 지목 가능)
 *   - 자기만의 SQLite 저장소가 붙어 있다 (2.4에서 사용)
 *   - 서버 관리·스케일링은 여전히 Cloudflare가 해준다 (서버리스의 장점 유지)
 *
 * 코드 관점에서 DO는 그냥 "클래스"다. 단, 세 가지 규칙:
 *   ① cloudflare:workers의 DurableObject를 extends 한다
 *   ② export default가 아니라 named export (Cloudflare가 클래스 "이름"으로 찾는다)
 *   ③ wrangler.jsonc의 durable_objects.bindings에 class_name으로 등록한다
 *
 * ★ 이 파일과 index.ts가 같은 프로젝트에 있어도 "같은 서버"에서 도는 게 아니다.
 *   워커는 도쿄에서, 이 DO는 파나마에서 실행될 수 있다.
 *   그래서 워커가 DO에게 말을 걸려면 바인딩(env.DP)이라는 통로가 필요하다.
 */
import { DurableObject } from 'cloudflare:workers';

// <Env>: 이 DO 안에서도 env(바인딩 모음)를 타입 안전하게 쓰기 위한 제네릭.
// Env 타입은 `npm run cf-typegen`이 worker-configuration.d.ts에 만들어 준다.
export class DurablePotato extends DurableObject<Env> {
	/**
	 * DO의 메서드 = 바깥(워커)에서 이 컴퓨터를 조작하는 "키보드".
	 * 워커에서는 `await stub.ping()`으로 부른다.
	 */
	ping() {
		return 'pong';
	}
}
