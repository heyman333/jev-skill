<img src="docs/hero.png" alt="" width="100%">

<h1 align="center">jev</h1>
<p align="center"><b>예/아니오 판단에 LLM 토큰을 태우지 않는다.</b></p>
<p align="center">
  <a href="README.md">English</a> ·
  <a href="#설치">설치</a> ·
  <a href="#사용법">사용법</a> ·
  <a href="#문제-해결">문제 해결</a>
</p>

에이전트는 작업 내내 좁은 판단을 계속 내린다 — *이 파일이 관련 있나? 이 테스트 실패가
진짜인가? 이건 어느 카테고리인가?* 그 하나하나가 LLM 호출이고, 토큰이고, 몇 초다.

[jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)는 텍스트를 만들지 않는다.
**타입이 고정된 값과 캘리브레이션된 확신도**를 건당 약 **$0.00004, 300~500ms** 에 돌려준다.

<img src="docs/demo.svg" alt="질문 세 개를 한 번에 답하는 jev" width="100%">

질문 셋을 물었지만 **호출은 한 번, 비용도 한 번**이다.

## LLM에게 시키면 안 되나

| | LLM에게 시킬 때 | jev |
|---|---|---|
| 응답 | 문장 — *"아마 관련 있어 보입니다"* | 타입이 고정된 값 + 확률 |
| 확신도 | 없음. 항상 단언한다 | 캘리브레이션된 `confidence` |
| 속도 | 2~10초 | 300~500ms |
| 비용 | 판단이 작업보다 비쌀 수 있다 | $0.042 / 1M 입력 토큰, 출력 무료 |
| 형식 | 파싱해야 한다. 가끔 깨진다 | 항상 같은 모양 |

파일 184개 중 인증 관련된 것만 찾아야 할 때:

```bash
git ls-files | jev --batch --bool relevant "이 파일이 인증 로직과 관련 있는가?"
```

```json
{"input":"src/auth/session.ts","relevant":true}
{"input":"README.md","relevant":false}
```

에이전트는 184개가 아니라 12개만 읽는다. 짐작할 필요도 없다.

## 실측

추정치가 아니다. 두 경로 모두 같은 게이트웨이를 거치므로 과금액이 응답에 그대로 실려 온다.
스크립트와 입력은 [`bench/`](bench/) 에 있다 — 직접 다시 돌릴 수 있다.

**한국어 고객 문의 20건 → 어느 팀인지, 급한지.**

| | 호출 | 입력 토큰 | 출력 토큰 | 비용 | 일치 |
|---|---:|---:|---:|---:|---:|
| **jev** | 20 | 7,961 | 1,100 | **$0.000334** | — |
| `openai/gpt-5.2`, 20건을 한 프롬프트에 | 1 | 457 | 166 | $0.003124 | 18/20 |

**9.3배 저렴하다.** 그것도 LLM 에 *가장 유리한* 조건에서다 — 한 번에 묶어 보내 건별 오버헤드가 없는 경우.
판단 하나당 jev 는 **$0.0000167**, **약 500ms** 였다.

jev 는 토큰을 **17배 더 쓰고도** 10분의 1 값이다. 입력 토큰 단가가 약 **160배 싸고** 출력은 무료다.
질문 명세를 매번 통째로 실어 건별로 보내는 게 여기서는 싼 선택이다.

### 이 숫자가 말하지 않는 것

- **묶음 LLM 이 벽시계 시간으로는 더 빠르다.** 한 번의 호출로 20건을 약 2.1초에 끝냈다.
  항목이 한 프롬프트에 다 들어가고 결과 파싱이 귀찮지 않다면, jev 를 쓸 이유는 속도가 아니다 —
  비용과 고정된 출력 형식, 그리고 캘리브레이션된 확신도다.
- **무료 티어 한도는 양쪽 다 걸린다.** 동시 호출을 계속 때리면 jev 도 채팅 모델도 429 를 낸다.
  그래서 벤치마크는 순차로 돈다 — 요금제 한도가 비교에 섞이지 않게.
- **어느 쪽도 정답이 아니다.** 18/20 일치는 두 건에서 갈렸다는 뜻이지, 어느 쪽이 맞았다는 뜻이 아니다.

```bash
AI_GATEWAY_API_KEY=... node bench/run.mjs openai/gpt-5.2 2
```

## 무엇이 들어 있나

| | |
|---|---|
| `skills/jev/SKILL.md` | 언제 넘기고 언제 넘기지 않나. 이게 스킬의 본체 |
| `skills/jev/jev.mjs` | CLI 겸 라이브러리. **파일 하나, 의존성 0개** |

스킬 디렉터리를 통째로 복사하면 그대로 돈다. 빌드도 `npm install` 도 없다.
Node 20+ 의 내장 `fetch` 만 쓴다.

## 설치

jev 는 이식 가능한 [Agent Plugin](https://agent-plugins.org) 으로 배포된다 —
`plugin.json` 하나, `skills/` 하나. Codex 와 Claude Code 가 같은 파일을 설치한다.

### 키 발급

둘 중 아무거나 하나면 된다. 둘 다 평범한 HTTPS 호출이라 의존성이 늘지 않는다.

| | 발급처 |
|---|---|
| `TYPESAFE_API_KEY` | [console.typesafe.ai/keys](https://console.typesafe.ai/keys) |
| `AI_GATEWAY_API_KEY` | [vercel.com/ai-gateway](https://vercel.com/ai-gateway) — `vck_` 로 시작 |

이미 Vercel 계정이 있다면 후자가 빠르다. AI Gateway 는 무료 티어에서도 jev 를 제공한다.
둘 다 있으면 TypeSafe 직접 호출을 쓴다.

#### `~/.zshrc` 가 아니라 `~/.zshenv` 다

여기서 대부분 막힌다.

```bash
echo 'export AI_GATEWAY_API_KEY="vck_..."' >> ~/.zshenv
```

zsh 는 파일마다 읽는 조건이 다르다.

| 파일 | 언제 읽히나 |
|---|---|
| `~/.zshrc` | **대화형 셸만** — 사람이 직접 치는 터미널 |
| `~/.zprofile` | 로그인 셸만 |
| **`~/.zshenv`** | **모든 zsh** — 에이전트가 명령을 돌리는 비대화형 셸 포함 |

에이전트는 명령을 **비대화형** 셸로 돌린다. `~/.zshrc` 에 넣으면 터미널에서는
`echo $AI_GATEWAY_API_KEY` 가 값을 찍는데 에이전트는 계속 *"API 키가 없습니다"* 를 본다.

bash 라면 `~/.bashrc` 에 넣되, 같은 증상이 나오면 `~/.profile` 에도 넣는다.

#### 에이전트를 재시작한다

실행 중인 프로세스는 나중에 바뀐 환경변수를 절대 보지 못한다.
macOS 데스크톱 앱은 창을 닫아도 꺼지지 않는다 — **⌘Q** 로 완전히 종료한 뒤 다시 연다.

#### 확인

```bash
jev --doctor
```

```text
키          ✓ AI_GATEWAY_API_KEY (60자)
백엔드      Vercel AI Gateway 경유
연결        ✓ 588ms
```

### Codex

```bash
codex plugin marketplace add heyman333/jev-skill
```

그다음 `/plugins` 에서 `jev` 를 고른다. 손으로 넣어도 된다:

```bash
mkdir -p ~/.agents/skills && cp -r skills/jev ~/.agents/skills/     # 모든 프로젝트
mkdir -p .agents/skills && cp -r skills/jev .agents/skills/         # 이 저장소만
```

다음 세션부터 잡힌다. 분류나 필터링을 부탁하면 알아서 쓰고, 강제하려면 `$jev` 를 친다.

### Claude Code

```text
/plugin marketplace add heyman333/jev-skill
/plugin install jev@jev-skill
```

기본은 **user** 범위다 — *내* 모든 프로젝트에 적용되고 저장소는 건드리지 않는다.
`--scope` 로 좁히거나 넓힌다:

```bash
# 나만, 이 프로젝트만 (.claude/settings.local.json — 자동으로 gitignore 된다)
claude plugin install jev@jev-skill --scope local

# 이 프로젝트의 팀 전체 (.claude/settings.json — 커밋한다)
claude plugin install jev@jev-skill --scope project
```

업데이트는 마켓플레이스를 먼저 갱신하고, 플러그인을 올린 뒤, 재시작한다:

```text
/plugin marketplace update jev-skill
/plugin update jev@jev-skill
```

`~/.claude/skills/` 나 `<project>/.claude/skills/` 로 손수 복사해도 된다.

### Cursor, Gemini CLI, 그 외

스킬은 마크다운 하나와 Node 스크립트 하나다. 에이전트 전용 의존성이 없다.
`AGENTS.md` 나 `.cursor/rules` 가 `skills/jev/SKILL.md` 를 가리키게만 하면 된다.

## 사용법

설치하면 에이전트가 알아서 쓴다.

```text
> 이 레포에서 인증 관련 파일만 골라줘
> 실패한 테스트 중에 진짜 버그만 추려줘
> 이 이슈들 카테고리별로 분류해줘
```

직접 부를 수도 있다:

```
jev "<판단 대상>" --bool  <id> "<질문>"
jev "<판단 대상>" --pick  <id> "<질문>" <보기>[=설명] ...
jev "<판단 대상>" --score <id> "<질문>" <낮은단계> ... <높은단계>
cat items.txt | jev --batch --bool <id> "<질문>"
```

| 옵션 | |
|---|---|
| `--batch` | stdin 한 줄에 하나씩 같은 질문을. JSONL 출력, **입력 순서 유지** |
| `--file <path>` | 판단 대상을 파일에서 읽는다 |
| `--json` | 확률 분포까지 전부 JSON 으로 |
| `--quiet` | 값만 출력. 셸 파이프라인용 |
| `--concurrency N` | 배치 동시 실행 수 (기본 8) |
| `--doctor` | 키가 왜 안 잡히는지 진단. **키 값은 절대 출력하지 않는다** |

배치에서 한 건이 실패해도 나머지는 살아남고, 그 줄만 `{"error":...}` 로 나온다.

셸 게이트로:

```bash
if [ "$(jev "$(git log -1 --format=%B)" --quiet \
        --bool ok "커밋 메시지가 무엇을 왜 바꿨는지 설명하는가?")" = "false" ]; then
  echo "커밋 메시지를 다시 쓰세요"; exit 1
fi
```

## 질문 쓰는 법이 정확도를 결정한다

**jev 는 틀리지 않는다.** 모호한 질문에는 모호한 답이 아니라 **확신에 찬 엉뚱한 답**이 돌아온다.

이걸 만들며 실제로 당한 것. *"리뷰 10만 건을 분류"* 작업의 난이도를 물었더니 jev 가
**1.55/2** 를 매겼다. 리뷰 한 건을 분류하는 건 사소한 일인데 **처리 건수를 난이도로 읽은 것**이다.
*"한 건 기준으로 판단하고 전체 건수는 무시하라"* 를 넣자 **0.21** 로 교정됐다.

- 나쁨: `"이 작업은 어려운가?"`
- 좋음: `"이 항목 하나를 처리하는 게 어려운가? 전체 건수는 무시하라."`

보기에는 설명을 붙여라. `billing=결제·환불·인보이스` 가 `billing` 보다 정확하다.

## 확신도가 낮으면 멈춘다

`--pick` 과 `--score` 는 `confidence` 를 함께 준다. 60% 미만이면 CLI 가 알려준다.

```text
team           billing  (71% · technical 14%, sales 14%)
               ⚠ team 확신도가 낮습니다. 사람이 보는 게 낫습니다.
```

스킬은 이때 조용히 1순위로 진행하지 않도록 지시받는다 — 후보를 보여주거나 그 항목만
직접 읽는다. **LLM 은 확신이 없을 때도 단언한다.** jev 는 그걸 숫자로 말해준다.

## 문제 해결

### 키가 안 잡힌다

```bash
jev --doctor
```

어느 설정 파일에 키가 있는지 찾아 원인과 해결 명령까지 알려준다.
**키 값은 절대 출력하지 않는다** — 길이와 유무만 본다.

> **`echo $AI_GATEWAY_API_KEY` 로 확인하지 마라.** 값이 터미널과 로그에 그대로 남는다.
> `${VAR:-없음}` 도 마스킹이 아니다 — 값이 있으면 그 값을 찍는다.

### 터미널에서는 되는데 에이전트만 안 된다

키가 `~/.zshrc` 에 있는 것이다. 에이전트는 비대화형 셸이라 그 파일을 읽지 않는다.
`~/.zshenv` 로 옮긴다. `NVM_DIR` 처럼 다른 `~/.zshrc` 변수도 함께 안 보이면 확진이다.

### 플러그인을 업데이트했는데 옛 동작 그대로다

플러그인 캐시는 자동으로 갱신되지 않는다. 마켓플레이스를 먼저 새로 고치고,
플러그인을 올린 뒤, 에이전트를 재시작한다.

```bash
grep -c zshenv ~/.claude/plugins/cache/jev-skill/jev/*/skills/jev/jev.mjs
```

### 확신도 경고가 계속 뜬다

질문이 모호한 것이다. 보기에 설명을 붙이고(`billing=결제·환불·인보이스`),
여러 건을 처리할 때는 *"한 건 기준으로"* 를 명시한다.
위 [질문 쓰는 법](#질문-쓰는-법이-정확도를-결정한다) 참고.

## 한계

- **만들지 못한다.** 코드를 고치거나 글을 쓰는 일은 여전히 LLM 의 몫이다. jev 는 판단만 한다.
- **설명하지 못한다.** *"왜 그렇게 판단했나"* 에 답하지 못한다. 확률만 준다.
- **넘겨준 텍스트 밖은 못 본다.** 파일을 먼저 읽어서 내용을 넘겨야 한다.
- **한 건짜리는 손해다.** 호출 왕복이 판단으로 아끼는 것보다 비싸다.

## 저장소 구조

```text
plugin.json                  # 이식 가능한 매니페스트 (Agent Plugins 1.0) — 기준
.codex-plugin/               # Codex 매니페스트
.claude-plugin/              # Claude Code 매니페스트 + 마켓플레이스 카탈로그
.agents/plugins/             # Codex 마켓플레이스 카탈로그
.agents/skills/jev -> ../../skills/jev    # 복사본이 아니라 심볼릭 링크
skills/jev/                  # 스킬 본체 — SKILL.md, jev.mjs
scripts/check-manifests.mjs  # 매니페스트 6개의 이름·버전 일치 검사
scripts/build-demo-svg.mjs   # docs/demo.svg 는 실제 CLI 출력으로 만든다
bench/                       # 실측 절의 근거가 되는 대조 벤치마크
```

두 런타임이 같은 `skills/` 를 읽는다. 에이전트별로 스킬을 포크하지 않는다.

## 개발

```bash
npm test      # 목 서버를 띄워 CLI 를 실제 HTTP 에 태운다. 의존성 없음
npm run check # 매니페스트 이름·버전 일치
```

버전을 올리려면 다섯 파일을 고쳐야 한다. `npm run check` 가 갈라짐을 잡는다.

## 라이선스

MIT
