import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { simplify, askMany, ask, parseQuestions, JevError } from './skills/jev/jev.mjs';
import { checkManifests } from './scripts/check-manifests.mjs';

const SKILL = 'skills/jev/jev.mjs';

// --- 매니페스트 --------------------------------------------------------
{
  const { problems } = checkManifests();
  assert.deepEqual(problems, [], '매니페스트 정합성:\n' + problems.join('\n'));
}

// SKILL.md 가 실제 파일 이름을 가리켜야 한다. 경로가 틀리면 설치해도 안 돈다.
{
  const md = readFileSync('skills/jev/SKILL.md', 'utf8');
  assert.match(md, /^---\nname: jev\n/, 'SKILL.md frontmatter 의 name 이 jev 여야 한다');
  assert.match(md, /description:/);
  assert.ok(md.includes('jev.mjs'), 'SKILL.md 가 jev.mjs 를 가리켜야 한다');
}

// --- 인자 -> 질문지 -----------------------------------------------------
{
  const { questions, rest } = parseQuestions([
    'ticket body', '--bool', 'urgent', '급한가?',
    '--pick', 'team', '어느 팀?', 'billing=결제', 'technical=버그', 'sales',
    '--score', 'sev', '심각도?', '사소', '불편', '정지',
    '--json',
  ]);
  assert.deepEqual(questions.urgent, { type: 'noul', instructions: '급한가?' });
  assert.deepEqual(questions.team.criteria, { billing: '결제', technical: '버그', sales: null });
  assert.deepEqual(questions.sev.criteria, ['사소', '불편', '정지']);
  assert.deepEqual(rest, ['ticket body', '--json']);
}

const bad = (argv, re) => assert.throws(() => parseQuestions(argv), re);
bad(['--pick', 't', '질문', 'one'], /2개 이상/);
bad(['--bool', 'a', '질문', 'x'], /보기를 줄 수 없습니다/);
bad(['--bool', 'a', 'q', '--bool', 'a', 'q2'], /중복/);
bad(['--score', 's', 'q', 'only'], /2개 이상/);
bad(['--bool'], /질문 id/);
bad(['--bool', 'a'], /질문 문장/);
bad(['--pick', 't', 'q', '=desc', 'ok'], /보기 이름이 비었습니다/);

// --- 응답 정리 ----------------------------------------------------------
{
  const r = simplify({
    answers: {
      urgent: { type: 'noul', noul: 0.92 },
      team: { type: 'choice', choice: 'technical', probabilities: { billing: 0.08, technical: 0.85, sales: 0.07 }, confidence: 0.82 },
      sev: { type: 'score', score: 1.6, legend: { 0: '사소', 1: '불편', 2: '정지' }, probabilities: { 0: 0.05, 1: 0.3, 2: 0.65 }, confidence: 0.78 },
    },
    usage: { input_tokens: 312, output_tokens: 48 },
  }, { sev: { criteria: ['사소', '불편', '정지'] } });

  assert.equal(r.answers.urgent.yes, true);
  assert.equal(r.answers.team.value, 'technical');
  assert.equal(r.answers.team.confidence, 0.82);
  assert.equal(r.answers.sev.level, '정지');
  assert.equal(r.answers.sev.max, 2);
  assert.equal(r.usage.inputTokens, 312);
}
{
  const r = simplify({ answers: { a: { type: 'noul', noul: 0.5 }, b: { type: 'noul' } } });
  assert.equal(r.answers.a.yes, true, '0.5 는 예로 친다');
  assert.equal(r.answers.b.probability, 0);
}
assert.deepEqual(simplify({}).answers, {});

// --- 배치 격리 ----------------------------------------------------------
{
  process.env.TYPESAFE_API_KEY = 'x';
  process.env.JEV_ENDPOINT = 'http://127.0.0.1:1';
  const r = await askMany(['a', 'b', 'c'], { q: { type: 'noul', instructions: 'x' } }, { concurrency: 2 });
  assert.equal(r.length, 3);
  assert.ok(r.every((x) => x.error));
  delete process.env.JEV_ENDPOINT;
}
await assert.rejects(ask('x', {}), (e) => e instanceof JevError && /질문이 없습니다/.test(e.message));
{
  const saved = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  await assert.rejects(ask('x', { q: { type: 'noul', instructions: 'q' } }),
    (e) => e instanceof JevError && /console\.typesafe\.ai/.test(e.hint));
  process.env.TYPESAFE_API_KEY = saved;
}

// --- CLI (목 서버로 실제 HTTP 를 태운다) --------------------------------
{
  const mock = spawn(process.execPath, ['test/mock.mjs'], { stdio: ['ignore', 'ignore', 'pipe'] });
  await new Promise((r) => mock.stderr.once('data', r));
  const env = { ...process.env, TYPESAFE_API_KEY: 'test-key', JEV_ENDPOINT: 'http://localhost:7331' };

  const run = (args, input, script = SKILL) => new Promise((resolve) => {
    const p = spawn(process.execPath, [script, ...args], { env });
    let o = '', e = '';
    p.stdout.on('data', (d) => (o += d));
    p.stderr.on('data', (d) => (e += d));
    if (input !== undefined) { p.stdin.write(input); p.stdin.end(); } else p.stdin.end();
    p.on('close', (code) => resolve({ o, e, code }));
  });

  const one = await run(['티켓 본문', '--bool', 'urgent', '급한가?', '--quiet']);
  assert.equal(one.code, 0);
  assert.equal(one.o.trim(), 'true');

  const multi = await run(['본문', '--bool', 'a', 'q1', '--pick', 'b', 'q2', 'x', 'y', '--json']);
  const j = JSON.parse(multi.o);
  assert.deepEqual(Object.keys(j.answers), ['a', 'b'], '질문을 묶어도 한 호출');

  const batch = await run(['--batch', '--pick', 'team', '어느 팀?', 'billing', 'tech'], 'one\ntwo\n\nthree\n');
  const lines = batch.o.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 3, '빈 줄은 건너뛴다');
  assert.deepEqual(lines.map((l) => l.input), ['one', 'two', 'three'], '입력 순서가 유지된다');

  const noQ = await run(['본문']);
  assert.equal(noQ.code, 2);
  assert.match(noQ.e, /질문이 없습니다/);

  const piped = await run(['--bool', 'a', 'q', '--quiet'], '파이프로 들어온 대상');
  assert.equal(piped.o.trim(), 'true');

  // 플러그인은 심볼릭 링크로 설치된다. 링크로 실행해도 CLI 가 돌아야 한다.
  // (경로 문자열만 비교하던 초기 버전은 여기서 조용히 아무것도 안 했다)
  const viaLink = await run(['본문', '--bool', 'a', 'q', '--quiet'], undefined, '.agents/skills/jev/jev.mjs');
  assert.equal(viaLink.o.trim(), 'true', '.agents/skills 링크로 실행하면 CLI 가 돌아야 한다');

  mock.kill();
}

console.log('ok');
