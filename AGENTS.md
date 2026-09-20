# AGENTS.md

jev 는 좁은 판단을 LLM 대신 [jev](https://typesafe.ai) 에게 넘겨 토큰을 아끼는
에이전트 스킬이다. 이식 가능한 Agent Plugin(Codex, ChatGPT)과 Claude Code 플러그인으로
같은 파일에서 배포된다.

## Repo layout that matters

```text
plugin.json              # 이식 가능한 매니페스트 (Agent Plugins 1.0) — 기준
.codex-plugin/           # Codex 호환 매니페스트
.claude-plugin/          # Claude Code 매니페스트 + 마켓플레이스 카탈로그
.agents/plugins/         # Codex 마켓플레이스 카탈로그
.agents/skills/jev -> ../../skills/jev   # 복사본이 아니라 심볼릭 링크
skills/jev/SKILL.md      # 언제 넘기고 언제 넘기지 않나 — 스킬의 본체
skills/jev/jev.mjs       # CLI 겸 라이브러리. 파일 하나, 의존성 0개
```

두 런타임이 같은 `skills/` 를 읽는다. 에이전트별로 스킬을 포크하지 않는다.

## Rules

- **백엔드가 둘이다.** `TYPESAFE_API_KEY` 는 api.typesafe.ai 로, `AI_GATEWAY_API_KEY` 는
  Vercel AI Gateway 로 간다. 와이어 형식이 다르다 — 직접 호출은 `noul`, 게이트웨이는
  `boolean` 이고, confidence 는 답변에 붙거나 `providerMetadata` 로 분리돼 온다.
  `simplify()` 가 하나로 편다. 어느 쪽도 npm 의존성이 아니다.
  `test/mock.mjs` 가 `JEV_MOCK` 으로 두 형식을 다 흉내내고, 테스트가 양쪽을 다 돈다.
- **`skills/jev/jev.mjs` 는 자립형이어야 한다.** 스킬 디렉터리를 통째로 복사하면
  그대로 돌아야 한다. 외부 `import` 를 추가하지 말고, 의존성도 추가하지 않는다.
  `lib/` 를 다시 만들고 싶어지면, 그러면 복사 설치가 깨진다는 걸 먼저 떠올려라.
- **엔트리 가드는 realpath 로 비교한다.** 플러그인은 심볼릭 링크로 설치되고
  macOS 의 `/tmp` 는 `/private/tmp` 의 링크다. 경로 문자열을 그냥 비교하면
  링크로 실행했을 때 CLI 가 조용히 아무것도 하지 않는다. 실제로 그랬다.
  `test.mjs` 가 `.agents/skills/jev/jev.mjs` 로 실행해 이를 막는다.
- **매니페스트 여섯 개가 같은 이름과 버전을 말해야 한다.** 갈라지면 한쪽 런타임만
  옛 스킬을 설치한다. 눈으로 지킬 수 있는 불변식이 아니라서 `npm run check` 에 박아 뒀고
  `npm test` 도 이를 포함한다.
- **`SKILL.md` 의 frontmatter `name` 은 `jev` 여야 한다.** 매니페스트의 플러그인
  이름과 같아야 한다. 테스트가 검사한다.
- **질문 문구를 바꾸는 변경은 근거를 함께 적는다.** jev 는 모호한 질문에 모호한
  답이 아니라 확신에 찬 엉뚱한 답을 준다. 문구 하나가 결과를 뒤집는다
  (실제 사례: 난이도 1.55 → 0.21). 어떤 입력에서 무엇이 어떻게 달라졌는지 적어라.

## 버전 올리기

여섯 곳을 모두 고친다.

```text
package.json
plugin.json
.codex-plugin/plugin.json
.claude-plugin/plugin.json
.claude-plugin/marketplace.json
```

(`.agents/plugins/marketplace.json` 은 버전을 들지 않는다. 이름만 검사한다.)

```bash
npm run check   # 갈라졌는지 확인
npm test        # 전체
```

## 테스트

```bash
npm test
```

`test/mock.mjs` 가 jev 를 흉내 내는 목 서버다. 요청 형식(authorization, model,
state, questions)을 역으로 검증하고 질문 타입에 맞는 응답을 만든다.
CLI 를 자식 프로세스로 띄워 실제 HTTP 를 태우므로, 네트워크 없이도 전 경로가 돈다.

실제 jev 호출을 확인하려면 키가 필요하다.

```bash
TYPESAFE_API_KEY=... node skills/jev/jev.mjs "이 문장은 질문인가요?" --bool q "질문인가?"
```
