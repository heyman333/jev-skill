#!/usr/bin/env node
// jev — LLM 대신 좁은 판단을 시킨다. 건당 약 $0.00004, 300~500ms.
// 의존성 0개. 이 파일 하나가 전부라서 스킬 폴더째 복사하면 그대로 동작한다.
//
//   jev.mjs "<판단 대상>" --bool urgent "급한가?"
//   cat items.txt | jev.mjs --batch --pick team "어느 팀?" billing technical
//
// https://docs.typesafe.ai/api

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENDPOINT = process.env.JEV_ENDPOINT ?? 'https://api.typesafe.ai/v1/systemone';
const MODEL = process.env.JEV_MODEL ?? 'jev-latest';

export class JevError extends Error {
  constructor(message, { status, hint } = {}) {
    super(message);
    this.name = 'JevError';
    this.status = status;
    this.hint = hint;
  }
}

export function apiKey() {
  const key = process.env.TYPESAFE_API_KEY?.trim();
  if (!key) {
    throw new JevError('TYPESAFE_API_KEY 가 설정되지 않았습니다.', {
      hint: 'https://console.typesafe.ai/keys 에서 키를 발급한 뒤 `export TYPESAFE_API_KEY=...` 하세요.',
    });
  }
  return key;
}

/**
 * 판단 하나를 요청한다. 질문 여러 개를 한 번에 보낼 수 있고, 그게 요점이다 —
 * 질문 6개를 묶어도 호출은 한 번, 비용도 한 번이다.
 */
export async function ask(state, questions, { timeoutMs = 20000, signal } = {}) {
  const key = apiKey();
  if (!questions || !Object.keys(questions).length) throw new JevError('질문이 없습니다.');

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  signal?.addEventListener('abort', () => ac.abort(), { once: true });

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ state, model: MODEL, questions }),
      signal: ac.signal,
    });
  } catch (e) {
    if (ac.signal.aborted) throw new JevError(`jev 호출이 ${timeoutMs}ms 안에 끝나지 않았습니다.`);
    throw new JevError(`jev 에 연결하지 못했습니다: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) throw new JevError(errorMessage(res.status, text), { status: res.status, hint: errorHint(res.status) });

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new JevError(`jev 응답이 JSON 이 아닙니다: ${text.slice(0, 200)}`);
  }
  return simplify(body, questions);
}

/** 같은 질문을 여러 대상에 던진다. 한 건이 실패해도 전체를 죽이지 않는다. */
export async function askMany(states, questions, { concurrency = 8, onItem, ...opts } = {}) {
  const out = new Array(states.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= states.length) return;
      try {
        out[i] = await ask(states[i], questions, opts);
      } catch (e) {
        out[i] = { error: e.message, hint: e.hint };
      }
      onItem?.(i, out[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, states.length) }, worker));
  return out;
}

/** jev 응답을 쓰기 편한 모양으로 편다. 원본은 _raw 에 남긴다. */
export function simplify(body, questions = {}) {
  const answers = {};
  for (const [id, a] of Object.entries(body.answers ?? {})) {
    if (a.type === 'noul') {
      answers[id] = { type: 'noul', probability: num(a.noul), yes: num(a.noul) >= 0.5 };
    } else if (a.type === 'choice') {
      answers[id] = { type: 'choice', value: a.choice, probabilities: a.probabilities ?? {}, confidence: num(a.confidence) };
    } else if (a.type === 'score') {
      const levels = questions[id]?.criteria ?? [];
      const idx = Math.round(num(a.score));
      answers[id] = {
        type: 'score', value: num(a.score),
        level: a.legend?.[idx] ?? levels[idx] ?? null,
        max: Math.max(0, (Array.isArray(levels) ? levels.length : Object.keys(a.probabilities ?? {}).length) - 1),
        probabilities: a.probabilities ?? {}, confidence: num(a.confidence),
      };
    } else {
      answers[id] = a;
    }
  }
  const usage = body.usage ?? {};
  return {
    answers,
    usage: { inputTokens: num(usage.input_tokens), outputTokens: num(usage.output_tokens) },
    _raw: body,
  };
}

/**
 * CLI 인자를 jev 질문지로 옮긴다.
 *   --bool  urgent "급한가?"
 *   --pick  team "어느 팀?" billing=결제·환불 technical=버그
 *   --score risk "얼마나 위험한가?" 안전 주의 위험
 */
export function parseQuestions(argv) {
  const questions = {};
  const rest = [];

  for (let i = 0; i < argv.length; i++) {
    const kind = { '--bool': 'noul', '--pick': 'choice', '--score': 'score' }[argv[i]];
    if (!kind) { rest.push(argv[i]); continue; }

    const flag = argv[i];
    const id = need(argv[++i], `${flag} 다음에는 질문 id 가 와야 합니다`);
    const instructions = need(argv[++i], `${flag} ${id} 다음에는 질문 문장이 와야 합니다`);
    if (questions[id]) throw new Error(`질문 id 가 중복됩니다: ${id}`);

    const args = [];
    while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args.push(argv[++i]);

    if (kind === 'noul') {
      if (args.length) throw new Error(`--bool ${id} 에는 보기를 줄 수 없습니다: ${args.join(' ')}`);
      questions[id] = { type: 'noul', instructions };
    } else if (kind === 'choice') {
      if (args.length < 2) throw new Error(`--pick ${id} 에는 보기가 2개 이상 필요합니다`);
      const criteria = {};
      for (const a of args) {
        const eq = a.indexOf('=');
        const [k, desc] = eq < 0 ? [a, null] : [a.slice(0, eq), a.slice(eq + 1)];
        if (!k) throw new Error(`--pick ${id} 의 보기 이름이 비었습니다: ${a}`);
        criteria[k] = desc;
      }
      questions[id] = { type: 'choice', instructions, criteria };
    } else {
      if (args.length < 2) throw new Error(`--score ${id} 에는 단계가 2개 이상 필요합니다`);
      questions[id] = { type: 'score', instructions, criteria: args };
    }
  }

  return { questions, rest };
}

function need(v, msg) {
  if (v === undefined || v.startsWith('--')) throw new Error(msg);
  return v;
}

// ---------------------------------------------------------------- CLI

const HELP = `jev — LLM 대신 좁은 판단을 시킵니다. 건당 약 $0.00004, 300~500ms.

  jev "<판단 대상>" --bool <id> "<질문>"
  jev "<대상>" --pick <id> "<질문>" <보기>[=설명] <보기>[=설명] ...
  jev "<대상>" --score <id> "<질문>" <낮은단계> ... <높은단계>
  cat items.txt | jev --batch --bool <id> "<질문>"

질문은 여러 개를 한 번에 보낼 수 있고, 그래도 호출은 한 번입니다.

  jev "$(cat ticket.txt)" \\
    --bool urgent "시간에 쫓기는 요청인가?" \\
    --pick team "어느 팀이 맡나?" billing=결제·환불 technical=버그·장애 \\
    --score severity "얼마나 심각한가?" 사소함 불편함 업무정지

옵션
  --batch          stdin 을 한 줄에 하나씩 읽어 같은 질문을 던집니다 (JSONL 출력)
  --file <path>    판단 대상을 파일에서 읽습니다
  --json           전체 응답을 JSON 으로
  --quiet          값만 출력 (셸에서 쓰기 좋음)
  --concurrency N  --batch 동시 실행 수 (기본 8)
  -h, --help

환경변수
  TYPESAFE_API_KEY   필수. https://console.typesafe.ai/keys
`;

export async function cli(argv) {
  if (!argv.length || argv.includes('-h') || argv.includes('--help')) return out(HELP);

  const { questions, rest } = parseQuestions(argv);
  const opt = { batch: false, json: false, quiet: false, file: null, concurrency: 8 };
  const words = [];
  for (let i = 0; i < rest.length; i++) {
    const v = rest[i];
    if (v === '--batch') opt.batch = true;
    else if (v === '--json') opt.json = true;
    else if (v === '--quiet') opt.quiet = true;
    else if (v === '--file') opt.file = rest[++i];
    else if (v === '--concurrency') opt.concurrency = Math.max(1, Number(rest[++i]) || 8);
    else if (v.startsWith('--')) throw new Error(`모르는 옵션: ${v}`);
    else words.push(v);
  }

  if (!Object.keys(questions).length) {
    throw new Error('질문이 없습니다. --bool / --pick / --score 중 하나는 있어야 합니다.\n' + HELP);
  }
  if (opt.batch) return batch(questions, opt);

  let state = words.join(' ');
  if (opt.file) state = await (await import('node:fs/promises')).readFile(opt.file, 'utf8');
  if (!state) state = await stdin();
  if (!state.trim()) throw new Error('판단 대상이 비어 있습니다.');

  const started = Date.now();
  const r = await ask(state, questions);
  const ms = Date.now() - started;

  if (opt.quiet) return out(Object.values(r.answers).map(valueOf).join('\t'));
  if (opt.json) return out(JSON.stringify({ ...r, _raw: undefined, elapsedMs: ms }, null, 2));

  for (const [id, a] of Object.entries(r.answers)) out(`${id.padEnd(14)} ${describe(a)}`);
  for (const [id, a] of Object.entries(r.answers)) {
    if (a.confidence !== undefined && a.confidence < 0.6) {
      out(`${''.padEnd(14)} ⚠ ${id} 확신도가 낮습니다. 사람이 보는 게 낫습니다.`);
    }
  }
  out(`${''.padEnd(14)} ${ms}ms · 입력 ${r.usage.inputTokens} 토큰`);
}

async function batch(questions, opt) {
  const lines = (await stdin()).split('\n').map((s) => s.trim()).filter(Boolean);
  if (!lines.length) throw new Error('stdin 이 비어 있습니다.');

  const started = Date.now();
  let done = 0;
  const results = await askMany(lines, questions, {
    concurrency: opt.concurrency,
    onItem: () => { if (!opt.quiet && !opt.json) process.stderr.write(`\r판단 중 ${++done}/${lines.length}`); },
  });
  if (!opt.quiet && !opt.json) process.stderr.write('\r'.padEnd(30) + '\r');

  let tokens = 0, failed = 0;
  results.forEach((r, i) => {
    if (r.error) { failed++; out(JSON.stringify({ input: lines[i], error: r.error })); return; }
    tokens += r.usage.inputTokens;
    const flat = Object.fromEntries(Object.entries(r.answers).map(([id, a]) => [id, valueOf(a)]));
    out(JSON.stringify(opt.json ? { input: lines[i], ...flat, answers: r.answers } : { input: lines[i], ...flat }));
  });

  process.stderr.write(`${lines.length}건 · ${Date.now() - started}ms · 입력 ${tokens} 토큰${failed ? ` · 실패 ${failed}건` : ''}\n`);
  if (failed) process.exitCode = 1;
}

const valueOf = (a) => (a.type === 'noul' ? a.yes : a.value);

function describe(a) {
  const pct = (n) => `${Math.round(n * 100)}%`;
  if (a.type === 'noul') return `${a.yes ? '예' : '아니오'}  (${pct(a.probability)})`;
  if (a.type === 'choice') {
    const others = Object.entries(a.probabilities)
      .filter(([k]) => k !== a.value).sort((x, y) => y[1] - x[1]).slice(0, 2)
      .map(([k, p]) => `${k} ${pct(p)}`).join(', ');
    return `${a.value}  (${pct(a.probabilities[a.value] ?? 0)}${others ? ` · ${others}` : ''})`;
  }
  if (a.type === 'score') return `${a.value.toFixed(2)}/${a.max}  ${a.level ?? ''}`.trim();
  return JSON.stringify(a);
}

const out = (s) => process.stdout.write(s + '\n');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function errorMessage(status, text) {
  let detail = text.slice(0, 300);
  try {
    const j = JSON.parse(text);
    detail = j.detail?.message ?? j.error?.message ?? j.message ?? detail;
  } catch { /* 원문 그대로 둔다 */ }
  return `jev 가 ${status} 를 반환했습니다: ${detail}`;
}

function errorHint(status) {
  if (status === 401 || status === 403)
    return 'TYPESAFE_API_KEY 를 확인하세요. console.typesafe.ai/keys 에서 발급한 키여야 합니다 (Vercel AI Gateway 의 vck_ 키는 동작하지 않습니다).';
  if (status === 429) return '요청이 한도를 넘었습니다. 잠시 후 다시 시도하세요.';
  return undefined;
}

async function stdin() {
  if (process.stdin.isTTY) return '';
  let s = '';
  for await (const c of process.stdin) s += c;
  return s;
}

// 직접 실행됐을 때만 CLI 로 동작한다. import 하면 함수만 가져간다.
//
// 경로 문자열을 그냥 비교하면 안 된다. 플러그인은 심볼릭 링크로 설치되고,
// macOS 의 /tmp 는 /private/tmp 의 링크라서 import.meta.url 과 argv[1] 이 갈린다.
// 양쪽 다 realpath 로 풀어서 비교한다.
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  cli(process.argv.slice(2)).catch((e) => {
    if (e instanceof JevError) {
      process.stderr.write(`jev 오류: ${e.message}\n${e.hint ? '\n  ' + e.hint + '\n' : ''}`);
      process.exit(1);
    }
    process.stderr.write(`오류: ${e.message}\n`);
    process.exit(2);
  });
}
