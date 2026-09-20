// 같은 분류 작업을 jev 와 LLM 에 각각 돌려 토큰·시간·비용을 잰다.
//
// README 에 쓸 숫자는 추정이 아니라 실측이어야 한다. 두 경로 모두 Vercel AI Gateway 를
// 거치므로 응답에 실제 과금액이 들어 있다 — 가격표를 손으로 관리할 필요가 없다.
//
//   AI_GATEWAY_API_KEY=... node bench/run.mjs [모델] [반복]
//
// 실패를 삼키지 않는다. 한 건이라도 실패하면 그 수를 출력에 남긴다 —
// 실패한 실행의 숫자는 비교에 쓸 수 없다.

import { readFileSync, writeFileSync } from 'node:fs';
import { ask } from '../skills/jev/jev.mjs';

const KEY = process.env.AI_GATEWAY_API_KEY;
const LLM = process.argv[2] ?? 'openai/gpt-5.2';
const ROUNDS = Number(process.argv[3] ?? 3);
// 순차가 기본이다. 동시 실행은 요금제 한도를 비교에 섞는다.
const CONC = Number(process.env.BENCH_CONCURRENCY ?? 1);
const ITEMS = readFileSync(new URL('./tickets.txt', import.meta.url), 'utf8')
  .split('\n').map((s) => s.trim()).filter(Boolean);

const TEAMS = { billing: '결제·환불·인보이스·청구', technical: '버그·장애·연동·오류', sales: '가격·견적·계약·영업' };
const QUESTIONS = {
  team: { type: 'choice', instructions: '이 문의를 어느 팀이 맡아야 하는가?', criteria: TEAMS },
  urgent: { type: 'noul', instructions: '즉시 대응이 필요할 만큼 급한가?' },
};

async function retry(fn, n = 5) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= n - 1) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
}

/** 동시 실행 상한을 두고 돌린다. 실패는 null 로 남기고 센다. */
async function pool(items, conc, fn) {
  const out = new Array(items.length);
  let next = 0, failed = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = await retry(() => fn(items[i], i)); }
      catch { out[i] = null; failed++; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, worker));
  return { out, failed };
}

const sum = (rs, k) => rs.reduce((n, r) => n + (r?.[k] ?? 0), 0);

// --- jev: 항목마다 한 번, 질문 두 개를 묶어서 ---------------------------
async function runJev() {
  const t0 = Date.now();
  const { out, failed } = await pool(ITEMS, CONC, async (text) => {
    const r = await ask(text, QUESTIONS);
    return { in: r.usage.inputTokens, out: r.usage.outputTokens,
             cost: Number(r._raw?.providerMetadata?.gateway?.marketCost ?? 0),
             team: r.answers.team.value, urgent: r.answers.urgent.yes };
  });
  return { label: 'jev', ms: Date.now() - t0, calls: ITEMS.length, failed,
           inTok: sum(out, 'in'), outTok: sum(out, 'out'), cost: sum(out, 'cost'),
           teams: out.map((r) => r?.team ?? null) };
}

async function chat(messages) {
  const r = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: LLM, messages }),
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
  const j = await r.json();
  const content = j.choices?.[0]?.message?.content ?? '';
  return { content, in: j.usage?.prompt_tokens ?? 0, out: j.usage?.completion_tokens ?? 0,
           cost: Number(j.usage?.cost ?? 0) };
}

const parse = (s) => { try { return JSON.parse(s.replace(/^```(json)?|```$/gm, '').trim()); } catch { return null; } };
const RULES = `팀: ${Object.entries(TEAMS).map(([k, v]) => `${k}(${v})`).join(', ')}`;

// --- LLM: 20건을 한 프롬프트에 묶어서 (LLM 에 가장 유리한 조건) ---------
async function runLlmBatched() {
  const t0 = Date.now();
  const sys = `고객 문의를 분류한다. ${RULES}
JSON 배열만 출력하라. 형식: [{"team":"billing","urgent":true}, ...]
입력 순서와 개수를 그대로 유지하고 설명을 덧붙이지 마라.`;
  try {
    const r = await retry(() => chat([{ role: 'system', content: sys },
      { role: 'user', content: ITEMS.map((t, i) => `${i + 1}. ${t}`).join('\n') }]));
    const arr = parse(r.content);
    const okLen = Array.isArray(arr) && arr.length === ITEMS.length;
    return { label: `${LLM} 묶음`, ms: Date.now() - t0, calls: 1, failed: okLen ? 0 : 1,
             inTok: r.in, outTok: r.out, cost: r.cost,
             teams: okLen ? arr.map((a) => a?.team ?? null) : ITEMS.map(() => null) };
  } catch (e) {
    return { label: `${LLM} 묶음`, error: e.message, failed: 1 };
  }
}

// --- LLM: 한 건씩 (에이전트가 실제로 하는 방식) -------------------------
async function runLlmPerItem() {
  const t0 = Date.now();
  const sys = `고객 문의를 분류한다. ${RULES}
JSON 객체만 출력하라. 형식: {"team":"billing","urgent":true}`;
  const { out, failed } = await pool(ITEMS, CONC, async (text) => {
    const r = await chat([{ role: 'system', content: sys }, { role: 'user', content: text }]);
    const a = parse(r.content);
    if (!a?.team) throw new Error('파싱 실패');
    return { ...r, team: a.team };
  });
  return { label: `${LLM} 건별`, ms: Date.now() - t0, calls: ITEMS.length, failed,
           inTok: sum(out, 'in'), outTok: sum(out, 'out'), cost: sum(out, 'cost'),
           teams: out.map((r) => r?.team ?? null) };
}

// --- 실행 -------------------------------------------------------------
const rounds = [];
for (let i = 0; i < ROUNDS; i++) {
  process.stderr.write(`\r회차 ${i + 1}/${ROUNDS}`);
  rounds.push({ jev: await runJev(), batched: await runLlmBatched(), perItem: await runLlmPerItem() });
}
process.stderr.write('\r'.padEnd(20) + '\r');

const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
function fold(key) {
  const rs = rounds.map((r) => r[key]).filter((r) => !r.error);
  if (!rs.length) return { label: rounds[0][key].label, error: rounds[0][key].error };
  return {
    label: rs[0].label, calls: rs[0].calls,
    ms: median(rs.map((r) => r.ms)),
    inTok: median(rs.map((r) => r.inTok)), outTok: median(rs.map((r) => r.outTok)),
    cost: median(rs.map((r) => r.cost)),
    failed: rs.reduce((n, r) => n + r.failed, 0),
  };
}

const jev = fold('jev'), batched = fold('batched'), perItem = fold('perItem');
const last = rounds.at(-1);
const agree = (a, b) => a.filter((t, i) => t && t === b[i]).length;

const result = { items: ITEMS.length, model: LLM, rounds: ROUNDS,
  jev, llmBatched: batched, llmPerItem: perItem,
  agreeBatched: agree(last.jev.teams, last.batched.teams ?? []),
  agreePerItem: agree(last.jev.teams, last.perItem.teams ?? []),
  at: new Date().toISOString() };
writeFileSync(new URL('./result.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');

const f = (n) => n.toLocaleString('en-US');
console.log(`항목 ${ITEMS.length}개 · ${ROUNDS}회 중앙값 · ${LLM}\n`);
for (const r of [jev, batched, perItem]) {
  if (r.error) { console.log(`${r.label.padEnd(22)} 실패: ${r.error}`); continue; }
  console.log(`${r.label.padEnd(22)} ${String(f(r.ms)).padStart(7)}ms  입력 ${String(f(r.inTok)).padStart(6)} 출력 ${String(f(r.outTok)).padStart(5)} 토큰  $${r.cost.toFixed(6)}  호출 ${r.calls}회${r.failed ? `  ⚠ 실패 ${r.failed}건` : ''}`);
}
if (!perItem.error) console.log(`\n건별 대비  비용 ${(perItem.cost / jev.cost).toFixed(1)}배 저렴 · 시간 ${(perItem.ms / jev.ms).toFixed(1)}배 빠름`);
if (!batched.error) console.log(`묶음 대비  비용 ${(batched.cost / jev.cost).toFixed(1)}배 저렴`);
console.log(`\n팀 분류 일치  묶음 ${result.agreeBatched}/${ITEMS.length} · 건별 ${result.agreePerItem}/${ITEMS.length}`);
