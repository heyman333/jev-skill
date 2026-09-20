// 실제 jev 대신 답하는 목 서버. 두 백엔드의 와이어 형식을 모두 흉내낸다.
//   JEV_MOCK=typesafe  noul / 답변에 붙은 confidence  (기본)
//   JEV_MOCK=gateway   boolean / providerMetadata 로 분리된 confidence
import { createServer } from 'node:http';

const MODE = process.env.JEV_MOCK ?? 'typesafe';

createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  const b = JSON.parse(raw);
  const errs = [];
  if (!/^Bearer test-key$/.test(req.headers.authorization ?? '')) errs.push('authorization');
  if (b.state === undefined || b.state === '') errs.push('state');
  if (!b.questions || !Object.keys(b.questions).length) errs.push('questions');
  if (MODE === 'typesafe') {
    if (b.model !== 'jev-latest') errs.push('model');
    if (Object.values(b.questions ?? {}).some((q) => q.type === 'boolean')) errs.push('noul 이어야 하는데 boolean');
  } else {
    if (req.headers['ai-model-id'] !== 'typesafe-ai/jev') errs.push('ai-model-id');
    if (req.headers['ai-evaluation-model-specification-version'] !== '4') errs.push('spec-version');
    if (Object.values(b.questions ?? {}).some((q) => q.type === 'noul')) errs.push('boolean 이어야 하는데 noul');
  }
  if (errs.length) { console.error('REQ-FAIL ' + errs.join(',')); return res.writeHead(400).end('{}'); }
  console.error('REQ-OK ' + MODE + ' ' + Object.keys(b.questions).join(','));

  const answers = {};
  const confidence = {};
  for (const [id, q] of Object.entries(b.questions)) {
    const conf = id === 'vague' ? 0.42 : 0.83;
    if (q.type === 'noul') answers[id] = { type: 'noul', noul: 0.87 };
    else if (q.type === 'boolean') answers[id] = { type: 'boolean', probability: 0.87 };
    else if (q.type === 'choice') {
      const keys = Object.keys(q.criteria);
      const probs = {}; keys.forEach((k, i) => (probs[k] = i === 0 ? 0.71 : 0.29 / (keys.length - 1)));
      answers[id] = { type: 'choice', choice: keys[0], probabilities: probs };
      if (MODE === 'typesafe') answers[id].confidence = conf; else confidence[id] = conf;
    } else {
      const n = q.criteria.length;
      const probs = {}; q.criteria.forEach((_, i) => (probs[i] = i === n - 1 ? 0.6 : 0.4 / (n - 1)));
      answers[id] = { type: 'score', score: n - 1.2, probabilities: probs };
      if (MODE === 'typesafe') {
        answers[id].legend = Object.fromEntries(q.criteria.map((d, i) => [i, d]));
        answers[id].confidence = conf;
      } else confidence[id] = conf;
    }
  }

  const body = MODE === 'typesafe'
    ? { model: 'jev-latest', answers, usage: { input_tokens: 240, output_tokens: 38 } }
    : { answers, providerMetadata: { typesafe: { confidence } }, usage: { inputTokens: 240, outputTokens: 38 } };
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}).listen(7331, () => console.error('mock up ' + MODE));
