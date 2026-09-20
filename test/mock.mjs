// 실제 jev 대신 답하는 목 서버. 요청 형식을 역으로 검증하고 질문 타입에 맞는 응답을 만든다.
import { createServer } from 'node:http';
createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  const b = JSON.parse(raw);
  const errs = [];
  if (req.headers.authorization !== 'Bearer test-key') errs.push('authorization');
  if (b.model !== 'jev-latest') errs.push('model');
  if (b.state === undefined || b.state === '') errs.push('state');
  if (!b.questions || !Object.keys(b.questions).length) errs.push('questions');
  if (errs.length) { console.error('REQ-FAIL ' + errs.join(',')); return res.writeHead(400).end('{}'); }
  console.error('REQ-OK ' + Object.keys(b.questions).join(','));

  const answers = {};
  for (const [id, q] of Object.entries(b.questions)) {
    if (q.type === 'noul') answers[id] = { type: 'noul', noul: 0.87 };
    else if (q.type === 'choice') {
      const keys = Object.keys(q.criteria);
      const probs = {}; keys.forEach((k, i) => (probs[k] = i === 0 ? 0.71 : (0.29 / (keys.length - 1))));
      answers[id] = { type: 'choice', choice: keys[0], probabilities: probs, confidence: id === 'vague' ? 0.42 : 0.83 };
    } else {
      const n = q.criteria.length;
      const probs = {}; q.criteria.forEach((_, i) => (probs[i] = i === n - 1 ? 0.6 : 0.4 / (n - 1)));
      answers[id] = { type: 'score', score: n - 1.2,
        legend: Object.fromEntries(q.criteria.map((d, i) => [i, d])), probabilities: probs, confidence: 0.79 };
    }
  }
  res.writeHead(200, { 'content-type': 'application/json' })
     .end(JSON.stringify({ model: 'jev-latest', answers, usage: { input_tokens: 240, output_tokens: 38 } }));
}).listen(7331, () => console.error('mock up'));
