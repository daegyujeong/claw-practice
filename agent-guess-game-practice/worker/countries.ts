/**
 * 스무고개 후보 목록 — 카테고리: 나라 (20개, 과제 요구는 15개 이상)
 *
 * 정답(secret)을 고르는 것도, 정답인지 판정하는 것도 전부 "내 코드"의 일이다.
 * 모델에게는 절대 맡기지 않는다 (과제 요구사항 4번).
 * 그래서 이 파일은 워커 쪽에만 두고, 프론트로는 타입만 넘어가게 한다.
 */

export type Country = {
  id: string; // 상태에 저장할 값 = secret
  ko: string; // 화면·프롬프트에 쓸 한국어 이름
  en: string; // 영어 이름
  aliases: string[]; // 사용자가 쓸 법한 다른 표기
};

export const COUNTRIES: Country[] = [
  { id: "korea", ko: "대한민국", en: "South Korea", aliases: ["한국", "korea"] },
  { id: "japan", ko: "일본", en: "Japan", aliases: [] },
  { id: "china", ko: "중국", en: "China", aliases: [] },
  { id: "india", ko: "인도", en: "India", aliases: [] },
  { id: "thailand", ko: "태국", en: "Thailand", aliases: [] },
  { id: "vietnam", ko: "베트남", en: "Vietnam", aliases: [] },
  { id: "france", ko: "프랑스", en: "France", aliases: [] },
  { id: "germany", ko: "독일", en: "Germany", aliases: [] },
  { id: "italy", ko: "이탈리아", en: "Italy", aliases: [] },
  { id: "spain", ko: "스페인", en: "Spain", aliases: [] },
  { id: "uk", ko: "영국", en: "United Kingdom", aliases: ["uk", "britain", "england"] },
  { id: "russia", ko: "러시아", en: "Russia", aliases: [] },
  { id: "egypt", ko: "이집트", en: "Egypt", aliases: [] },
  { id: "kenya", ko: "케냐", en: "Kenya", aliases: [] },
  { id: "brazil", ko: "브라질", en: "Brazil", aliases: [] },
  { id: "mexico", ko: "멕시코", en: "Mexico", aliases: [] },
  { id: "canada", ko: "캐나다", en: "Canada", aliases: [] },
  { id: "australia", ko: "호주", en: "Australia", aliases: ["오스트레일리아"] },
  { id: "peru", ko: "페루", en: "Peru", aliases: [] },
  { id: "norway", ko: "노르웨이", en: "Norway", aliases: [] },
];

/**
 * 후보는 아니지만 후보 이름을 "부분 문자열로 품고 있는" 단어들.
 *
 * 왜 필요한가: 정답 판정을 단순 includes로 하면
 *   "인도네시아인가요?" 안에 "인도"가 들어 있어서 인도를 맞힌 것으로 오판한다.
 *   "한국어로 답해줘" 안에도 "한국"이 들어 있다.
 * 그래서 아래 이름들을 후보와 같은 후보군에 넣고 "가장 긴 이름이 이긴다" 규칙을
 * 적용한다. 이 목록에 걸리면 어느 나라도 추측하지 않은 것으로 본다.
 */
const DECOYS = [
  "인도네시아",
  "indonesia",
  "한국어",
  "korean",
  "뉴질랜드",
  "new zealand",
  "오스트리아",
  "austria",
  "북한",
  "north korea",
];

/** 비교 전에 공백·문장부호를 지우고 소문자로 — 대소문자 구분 없이 대조 (과제 요구사항) */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s.,!?"'`~·\-_()[\]]/g, "");
}

/** 이름 → 나라 (DECOY는 null) 로 펼친 뒤, 긴 이름부터 검사하도록 정렬해 둔다 */
const SEARCH_TABLE: { name: string; country: Country | null }[] = [
  ...COUNTRIES.flatMap((country) =>
    [country.ko, country.en, ...country.aliases].map((name) => ({
      name: normalize(name),
      country,
    })),
  ),
  ...DECOYS.map((name) => ({ name: normalize(name), country: null })),
].sort((a, b) => b.name.length - a.name.length); // 긴 이름 우선

/**
 * 사용자 메시지에서 "어느 나라를 찍었는지"를 찾는다.
 * 못 찾았거나 DECOY에 먼저 걸리면 null.
 */
export function findGuessedCountry(text: string): Country | null {
  const haystack = normalize(text);
  const hit = SEARCH_TABLE.find((entry) => haystack.includes(entry.name));
  return hit?.country ?? null;
}

/** 목록에서 무작위로 하나 — 새 라운드의 정답 */
export function pickRandomCountry(): Country {
  return COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
}

/** state에 저장된 secret(id)으로 나라 정보를 되찾는다 */
export function getCountry(id: string): Country {
  return COUNTRIES.find((country) => country.id === id) ?? COUNTRIES[0];
}
