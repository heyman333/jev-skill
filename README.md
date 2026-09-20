# 🎯 jev

**Stop burning LLM tokens on yes/no calls.**

에이전트는 작업 중에 좁은 판단을 계속 내린다 — "이 파일이 관련 있나?",
"이 테스트 실패가 진짜인가?", "이건 어느 카테고리인가?".
그 하나하나가 LLM 호출이고, 토큰이고, 몇 초다.

[jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)는 텍스트를 만들지 않고
**타입이 고정된 값 + 캘리브레이션된 확신도**만 돌려준다. 건당 약 **$0.00004, 300~500ms**.

```bash
$ jev "결제가 3일째 실패하고 있어요. 급합니다." \
    --bool  urgent   "시간에 쫓기는 요청인가?" \
    --pick  team     "어느 팀이 맡나?" billing=결제·환불 technical=버그·장애 sales=가격 \
    --score severity "얼마나 심각한가?" 사소함 불편함 업무정지

urgent         예  (92%)
team           technical  (85% · billing 8%, sales 7%)
severity       1.60/2  업무정지
               412ms · 입력 312 토큰
```

질문 3개를 물었지만 **호출은 한 번, 비용도 한 번**이다.

## What it includes

| | |
|---|---|
| `skills/jev/SKILL.md` | 언제 넘기고 언제 넘기지 않는지. 스킬의 본체 |
| `skills/jev/jev.mjs` | CLI 겸 라이브러리. **파일 하나, 의존성 0개** |

스킬 디렉터리를 통째로 복사하면 그대로 돈다. 빌드도, `npm install` 도 없다.
Node 20+ 의 내장 `fetch` 만 쓴다.

### 왜 LLM 대신 jev인가

| | LLM에게 시킬 때 | jev |
|---|---|---|
| 응답 | 문장 ("아마 관련 있어 보입니다") | 타입이 고정된 값 + 확률 |
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

에이전트는 12개만 읽으면 된다. 184개를 읽지도, 184번 LLM에게 묻지도 않는다.

## Install

jev는 이식 가능한 [Agent Plugin](https://agent-plugins.org) 으로 배포된다 —
`plugin.json` 하나, `skills/` 하나. Codex와 Claude Code가 같은 파일을 설치한다.

### 키 설정

**키가 먼저 필요하다.** 둘 중 **아무거나 하나**면 된다.

| | 발급처 | |
|---|---|---|
| `TYPESAFE_API_KEY` | [console.typesafe.ai/keys](https://console.typesafe.ai/keys) | TypeSafe 직접 호출 |
| `AI_GATEWAY_API_KEY` | [vercel.com/ai-gateway](https://vercel.com/ai-gateway) | Vercel AI Gateway 경유. `vck_` 로 시작 |

둘 다 있으면 TypeSafe 직접 호출을 쓴다. **어느 쪽이든 npm 의존성은 없다** —
엔드포인트와 응답 모양만 다르고, 그 차이는 스킬이 흡수한다.

> 이미 Vercel 계정이 있다면 후자가 빠르다. AI Gateway는 무료 티어에서도 jev를 쓸 수 있다.

#### 잠깐 써보기

터미널에 그대로 치면 된다. **단 그 창에서만, 창을 닫을 때까지만** 유효하다.

```bash
export AI_GATEWAY_API_KEY="vck_..."   # 또는 TYPESAFE_API_KEY
```

#### 계속 쓰기

셸 설정 파일에 넣어야 창을 닫아도 남는다. macOS 기본은 zsh 라 `~/.zshrc`,
bash 를 쓰면 `~/.bashrc` 다. `echo $SHELL` 로 확인할 수 있다.

```bash
echo 'export AI_GATEWAY_API_KEY="vck_..."' >> ~/.zshrc && source ~/.zshrc
```

키가 셸 히스토리에 남는 게 싫으면 에디터로 직접 연다.

```bash
open -e ~/.zshrc      # macOS
```

#### 에이전트를 재시작한다

**이게 제일 자주 걸리는 지점이다.** 이미 실행 중인 Claude Code / Codex 는
나중에 바뀐 환경변수를 보지 못한다. 키를 넣었으면 에이전트를 껐다 켜야 한다.

확인:

```bash
echo $AI_GATEWAY_API_KEY          # 값이 찍히는지
node ~/.claude/skills/jev/jev.mjs "결제가 3일째 안 돼요. 급해요." \
  --bool urgent "시간에 쫓기는 요청인가?"
```

```text
urgent         예  (96%)
               412ms · 입력 118 토큰
```

터미널에서는 보이는데 에이전트에서만 `API 키가 없습니다` 가 나오면,
그 에이전트가 로그인 셸을 거치지 않은 것이다. `~/.zprofile` 에도 같은 줄을 넣어본다 —
로그인 셸은 그쪽을 먼저 읽는다.

> 키를 저장소에 커밋하지 마라. `.env` 는 이미 `.gitignore` 에 들어 있지만,
> 셸 설정 파일에 두는 쪽이 더 안전하다.

### Codex

플러그인으로 설치:

```bash
codex plugin marketplace add heyman333/jev-skill
```

그다음 플러그인 브라우저에서 `jev` 를 고른다:

```text
/plugins
```

손으로 넣어도 된다 — 디렉터리 하나라 빌드할 게 없다:

```bash
# 이 저장소만
mkdir -p .agents/skills && cp -r skills/jev .agents/skills/

# 모든 프로젝트
mkdir -p ~/.agents/skills && cp -r skills/jev ~/.agents/skills/
```

다음 세션부터 잡힌다. 분류나 필터링을 부탁하면 알아서 쓰고, 강제하려면 `$jev` 를 친다.

### Claude Code

```text
/plugin marketplace add heyman333/jev-skill
/plugin install jev@jev-skill
```

#### 설치 범위 고르기

기본은 **user** 범위다 — *내* 모든 프로젝트에 적용되고 저장소는 건드리지 않아서 팀원에게 영향이 없다.

좁히거나 넓히려면 CLI에서 `--scope` 를 준다:

```bash
# 나만, 이 프로젝트만 (.claude/settings.local.json — 자동으로 gitignore 된다)
claude plugin marketplace add heyman333/jev-skill --scope local
claude plugin install jev@jev-skill --scope local

# 이 프로젝트의 팀 전체 (.claude/settings.json — 커밋한다)
claude plugin marketplace add heyman333/jev-skill --scope project
claude plugin install jev@jev-skill --scope project
```

`project` 범위면 팀원이 pull 한 뒤 다음 세션에서 설치 안내를 받는다.
`local` 범위면 설치한 것이 git에 전혀 나타나지 않는다.

#### 업데이트

새 버전은 이 마켓플레이스 저장소로 나간다. 마켓플레이스를 먼저 갱신한 뒤 플러그인을 올린다:

```text
/plugin marketplace update jev-skill
/plugin update jev@jev-skill
```

CLI에서는 설치한 범위를 함께 준다:

```bash
claude plugin marketplace update jev-skill
claude plugin update jev@jev-skill --scope user   # 또는 local / project
```

적용하려면 Claude Code를 다시 시작한다. 여러 범위에 설치했다면 각각 갱신해야 하고,
프로젝트 안에서는 더 좁은 범위가 이긴다. `claude plugin list` 로 현재 상태를 본다.

손으로 복사해도 된다:

```bash
# 이 프로젝트만
cp -r skills/jev <your-project>/.claude/skills/

# 모든 프로젝트
cp -r skills/jev ~/.claude/skills/
```

### Cursor, Gemini CLI, 그 외

스킬은 마크다운 하나와 Node 스크립트 하나다. 에이전트 전용 의존성이 없다.
지시문 파일을 읽을 수 있는 에이전트라면 무엇이든 쓸 수 있다 — `AGENTS.md` 나
`.cursor/rules` 에 `skills/jev/SKILL.md` 를 가리키기만 하면 된다.

## Usage

설치했다면 에이전트가 알아서 쓴다.

```text
> 이 레포에서 인증 관련 파일만 골라줘
> 실패한 테스트 중에 진짜 버그만 추려줘
> 이 이슈들을 카테고리별로 분류해줘
```

직접 부를 수도 있다:

```
jev "<판단 대상>" --bool  <id> "<질문>"
jev "<대상>"     --pick  <id> "<질문>" <보기>[=설명] <보기>[=설명] ...
jev "<대상>"     --score <id> "<질문>" <낮은단계> ... <높은단계>
cat items.txt | jev --batch --bool <id> "<질문>"
```

| 옵션 | |
|---|---|
| `--batch` | stdin을 한 줄에 하나씩 읽어 같은 질문을 던진다. JSONL 출력, **입력 순서 유지** |
| `--file <path>` | 판단 대상을 파일에서 읽는다 |
| `--json` | 확률 분포까지 전부 JSON으로 |
| `--quiet` | 값만 출력. 셸에 끼울 때 |
| `--concurrency N` | 배치 동시 실행 수 (기본 8) |

배치에서 한 건이 실패해도 나머지는 살아남고, 그 줄만 `{"error":...}` 로 나온다.

셸 게이트로 쓰기:

```bash
if [ "$(jev "$(git log -1 --format=%B)" --quiet \
        --bool ok "커밋 메시지가 무엇을 왜 바꿨는지 설명하는가?")" = "false" ]; then
  echo "커밋 메시지를 다시 쓰세요"; exit 1
fi
```

## 질문 쓰는 법이 정확도를 결정한다

**jev는 틀리지 않는다.** 모호한 질문에는 모호한 답이 아니라 **확신에 찬 엉뚱한 답**이 돌아온다.

이 프로젝트를 만들며 실제로 당한 것 — "리뷰 10만 건을 분류" 작업의 난이도를 물었더니
jev가 **1.55/2** 를 매겼다. 리뷰 한 건을 분류하는 건 사소한 일인데,
**처리 건수를 난이도로 읽은 것**이다. 질문에 "**한 건** 기준으로, 전체 건수는 무시하라"를
명시하자 **0.21** 로 교정됐다.

- 나쁨: `"이 작업은 어려운가?"`
- 좋음: `"이 항목 하나를 처리하는 게 어려운가? 전체 건수는 무시하라."`

보기에는 설명을 붙여라. `billing=결제·환불·인보이스` 가 `billing` 보다 정확하다.

## 확신도가 낮으면 멈춘다

`--pick` 과 `--score` 는 `confidence` 를 함께 준다. 60% 미만이면 경고가 찍힌다.

```
team           billing  (71% · technical 14%, sales 14%)
               ⚠ team 확신도가 낮습니다. 사람이 보는 게 낫습니다.
```

스킬은 이때 조용히 1순위로 진행하지 않는다. 사용자에게 후보를 보여주거나 그 항목만 직접 읽는다.
**LLM은 확신이 없을 때도 단언한다.** jev는 그걸 숫자로 말해준다.

## 한계

- **만들지 못한다.** 코드를 고치거나 글을 쓰는 일은 여전히 LLM의 몫이다. jev는 판단만 한다.
- **설명하지 못한다.** "왜 그렇게 판단했나"에 답하지 못한다. 확률만 준다.
- **텍스트 밖은 못 본다.** 파일을 읽거나 명령을 실행해야 아는 것은 먼저 읽어서 넘겨야 한다.
- **한 건짜리는 손해다.** 호출 왕복이 아깝다. 반복될수록 이득이 커진다.

## Repo layout

```text
plugin.json                  # 이식 가능한 매니페스트 (Agent Plugins 1.0) — 기준
.codex-plugin/               # Codex 호환 매니페스트
.claude-plugin/              # Claude Code 매니페스트 + 마켓플레이스 카탈로그
.agents/plugins/             # Codex 마켓플레이스 카탈로그
.agents/skills/jev -> ../../skills/jev    # 복사본이 아니라 심볼릭 링크
skills/jev/                  # 스킬 본체 — SKILL.md, jev.mjs
scripts/check-manifests.mjs  # 매니페스트 6개의 이름·버전이 같은지 검사
```

두 런타임이 같은 `skills/` 를 읽는다. 에이전트별로 스킬을 포크하지 않는다 —
`.agents/skills/jev` 가 심볼릭 링크인 것은 의도다.

## 개발

```bash
npm test      # 목 서버로 실제 HTTP 를 태운다. 의존성 없음
npm run check # 매니페스트 6개의 이름·버전 일치
```

버전을 올릴 때는 여섯 파일을 모두 고쳐야 한다 — `package.json`, `plugin.json`,
`.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`,
`.claude-plugin/marketplace.json`. `npm run check` 가 갈라짐을 잡는다.

## 관련 프로젝트

[jev-model-classifier](https://github.com/heyman333/jev-model-classifier) —
같은 아이디어를 모델 선택에 적용한 웹 버전.

## License

MIT
