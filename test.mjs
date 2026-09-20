import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { simplify, askMany, ask, parseQuestions, backend, JevError } from './skills/jev/jev.mjs';
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

// --- 키 두 종류 ---------------------------------------------------------
{
  const saved = { t: process.env.TYPESAFE_API_KEY, g: process.env.AI_GATEWAY_API_KEY };
  const set = (t, g) => {
    if (t) process.env.TYPESAFE_API_KEY = t; else delete process.env.TYPESAFE_API_KEY;
    if (g) process.env.AI_GATEWAY_API_KEY = g; else delete process.env.AI_GATEWAY_API_KEY;
  };

  set('ts', null);
  assert.deepEqual(backend(), { kind: 'typesafe', key: 'ts' });

  set(null, 'vck_x');
  assert.deepEqual(backend(), { kind: 'gateway', key: 'vck_x' }, '게이트웨이 키만 있어도 쓸 수 있어야 한다');

  set('ts', 'vck_x');
  assert.equal(backend().kind, 'typesafe', '둘 다 있으면 직접 호출');

  set(null, null);
  assert.throws(() => backend(), (e) => e instanceof JevError
    && /console\.typesafe\.ai/.test(e.hint) && /ai-gateway/.test(e.hint));

  set(saved.t, saved.g);
}

// --- 게이트웨이 응답 정규화 ---------------------------------------------
// 게이트웨이는 boolean 타입을 쓰고 confidence 를 providerMetadata 로 분리해 보낸다.
{
  const r = simplify({
    answers: {
      urgent: { type: 'boolean', probability: 0.95 },
      team: { type: 'choice', choice: 'billing', probabilities: { billing: 1, technical: 0 } },
      sev: { type: 'score', score: 1.69, probabilities: { 0: 0, 1: 0.3, 2: 0.7 } },
    },
    providerMetadata: { typesafe: { confidence: { team: 1, sev: 0.54 } } },
    usage: { inputTokens: 435, outputTokens: 40 },
  }, { sev: { criteria: ['사소', '불편', '정지'] } });

  assert.equal(r.answers.urgent.type, 'noul', 'boolean 은 noul 로 통일한다');
  assert.equal(r.answers.urgent.probability, 0.95);
  assert.equal(r.answers.urgent.yes, true);
  assert.equal(r.answers.team.confidence, 1, 'providerMetadata 의 confidence 를 끌어온다');
  assert.equal(r.answers.sev.confidence, 0.54);
  assert.equal(r.answers.sev.level, '정지', 'legend 가 없으면 criteria 로 만든다');
  assert.equal(r.usage.inputTokens, 435, 'inputTokens 표기도 읽는다');
}

// 확신도가 아예 없는 것과 낮은 것은 다르다. 없으면 경고하지 않는다.
{
  const r = simplify({ answers: { team: { type: 'choice', choice: 'a', probabilities: { a: 1 } } } });
  assert.equal(r.answers.team.confidence, undefined, '없는 confidence 를 0 으로 떨구면 가짜 경고가 나간다');
}

// --- CLI (목 서버로 실제 HTTP 를 태운다) --------------------------------
for (const mode of ['typesafe', 'gateway']) {
  const mock = spawn(process.execPath, ['test/mock.mjs'],
    { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, JEV_MOCK: mode } });
  await new Promise((r) => mock.stderr.once('data', r));
  const env = {
    ...process.env,
    JEV_ENDPOINT: 'http://localhost:7331',
    ...(mode === 'typesafe'
      ? { TYPESAFE_API_KEY: 'test-key', AI_GATEWAY_API_KEY: '' }
      : { TYPESAFE_API_KEY: '', AI_GATEWAY_API_KEY: 'test-key' }),
  };

  const run = (args, input, script = SKILL) => new Promise((resolve) => {
    const p = spawn(process.execPath, [script, ...args], { env });
    let o = '', e = '';
    p.stdout.on('data', (d) => (o += d));
    p.stderr.on('data', (d) => (e += d));
    if (input !== undefined) { p.stdin.write(input); p.stdin.end(); } else p.stdin.end();
    p.on('close', (code) => resolve({ o, e, code }));
  });

  const one = await run(['티켓 본문', '--bool', 'urgent', '급한가?', '--quiet']);
  assert.equal(one.code, 0, `${mode}: ${one.e}`);
  assert.equal(one.o.trim(), 'true', `${mode} 모드에서 bool 이 나와야 한다`);

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
  await new Promise((r) => mock.once('close', r));
}

// --- --doctor ----------------------------------------------------------
// 키가 안 잡히는 이유를 손으로 짚다가 키를 그대로 출력하는 사고가 났다.
// doctor 는 어떤 경우에도 값을 찍지 않고, 네 가지 상황을 구분해야 한다.
{
  const { mkdtempSync, writeFileSync: wf, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const runDoctor = (home, env = {}) => new Promise((resolve) => {
    const p = spawn(process.execPath, [SKILL, '--doctor'], {
      env: { ...process.env, HOME: home, TYPESAFE_API_KEY: '', AI_GATEWAY_API_KEY: '', ...env },
    });
    let o = ''; p.stdout.on('data', (d) => (o += d));
    p.on('close', (code) => resolve({ o, code }));
  });

  const home = mkdtempSync(join(tmpdir(), 'jev-'));

  // 아무 데도 없을 때
  let r = await runDoctor(home);
  assert.equal(r.code, 1);
  assert.match(r.o, /어느 파일에도 없음/);

  // ~/.zshrc 에만 있을 때 — 이게 이 스킬에서 가장 많은 시간을 잡아먹은 상황이다
  wf(join(home, '.zshrc'), 'export AI_GATEWAY_API_KEY="SECRET-VALUE"\n');
  r = await runDoctor(home);
  assert.equal(r.code, 1);
  assert.match(r.o, /~\/\.zshenv 에 없습니다/, '.zshrc 에만 있는 경우를 못 짚는다');
  assert.match(r.o, /비대화형/, '이유를 설명하지 않는다');

  // ~/.zshenv 에 있는데 셸에 안 보일 때 = 재시작 안 함
  wf(join(home, '.zshenv'), 'export AI_GATEWAY_API_KEY="SECRET-VALUE"\n');
  r = await runDoctor(home);
  assert.equal(r.code, 1);
  assert.match(r.o, /재시작/, '재시작 안내가 없다');

  // 어떤 상황에서도 키 값을 출력하지 않는다
  for (const home2 of [home]) {
    const out = (await runDoctor(home2)).o;
    assert.ok(!out.includes('SECRET-VALUE'), 'doctor 가 키 값을 출력했다');
  }
  const withKey = await runDoctor(home, { AI_GATEWAY_API_KEY: 'SECRET-VALUE', JEV_ENDPOINT: 'http://127.0.0.1:1' });
  assert.ok(!withKey.o.includes('SECRET-VALUE'), 'doctor 가 환경변수의 키 값을 출력했다');
  assert.match(withKey.o, /12자/, '길이는 보여줘야 한다');

  rmSync(home, { recursive: true, force: true });
}

// --- 키 안내가 세 곳에 흩어져 있다 ------------------------------------
// README · SKILL.md · CLI 오류 메시지. "재시작" 을 빠뜨리면 사용자가
// 키를 제대로 넣고도 같은 오류를 계속 본다. 실제로 가장 자주 걸리는 지점이라
// 세 곳 모두에 남아 있는지 검사한다.
{
  // 영문·국문 README 와 스킬 문서, CLI 오류 메시지까지 넷이 같은 내용을 말해야 한다.
  const files = ['README.md', 'README.ko.md', 'skills/jev/SKILL.md', 'skills/jev/jev.mjs'];

  for (const name of files) {
    const text = readFileSync(name, 'utf8');
    assert.ok(text.includes('TYPESAFE_API_KEY'), `${name} 에 TYPESAFE_API_KEY 안내가 없다`);
    assert.ok(text.includes('AI_GATEWAY_API_KEY'), `${name} 에 AI_GATEWAY_API_KEY 안내가 없다`);
    assert.match(text, /재시작|껐다 켜|[Rr]estart/, `${name} 에 에이전트 재시작 안내가 없다`);
    // .zshrc 는 대화형 셸만 읽는다. 에이전트는 비대화형 셸로 명령을 돌리므로
    // .zshrc 에 넣으라고 안내하면 터미널에서는 되는데 에이전트만 실패한다.
    // 실제로 그렇게 안내해 놓고 막혔다. 세 곳 모두 .zshenv 를 말해야 한다.
    assert.ok(text.includes('.zshenv'), `${name} 이 .zshenv 를 안내하지 않는다`);
    assert.match(text, /대화형|interactive/, `${name} 에 .zshrc 가 왜 안 되는지 설명이 없다`);
  }
}

console.log('ok');
