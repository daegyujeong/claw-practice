// 3.0 — 보일러플레이트 정리: 템플릿의 CSS/에셋은 모두 삭제했다.
// (스타일은 코스 후반에 AI가 작성할 예정이라 지금은 맨몸 HTML로 간다)
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
