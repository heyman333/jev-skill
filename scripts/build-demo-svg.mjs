// 실제 CLI 출력을 터미널 카드 SVG 로 굳힌다. 손으로 그리지 않는다.
//
// 폭 계산은 하지 않는다. 한 줄을 <text> 하나로 두고 색만 <tspan> 으로 나누면
// 렌더러가 실제 글꼴 폭으로 배치한다 — 한글이 섞여도 정렬이 맞는다.
// 대신 xml:space="preserve" 가 없으면 SVG 가 공백을 접어 열이 무너진다.
import { writeFileSync, readFileSync } from 'node:fs';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const C = { bg:'#141A24', chrome:'#1E2632', line:'#2A3444', dim:'#697383', fg:'#E5E8EF',
            blue:'#4DA3FF', amber:'#FFAA33', prompt:'#04CA81' };

function spans(line) {
  if (line.startsWith('$ ')) return [['$ ', C.prompt], [line.slice(2), C.fg]];
  if (/^\s+--/.test(line)) return [[line, C.dim]];
  if (line.includes('⚠')) return [[line, C.amber]];
  if (/^\s+\d+ms/.test(line)) return [[line, C.dim]];
  const m = line.match(/^(\S+)(\s+)(\S+)(.*)$/);
  return m ? [[m[1], C.dim], [m[2], C.dim], [m[3], C.blue], [m[4], C.dim]] : [[line, C.fg]];
}

const [, , src, title, out] = process.argv;
const lines = readFileSync(src, 'utf8').replace(/\n+$/, '').split('\n');
const PAD = 28, TOP = 60, LH = 26, W = 1120;
const H = TOP + lines.length * LH + PAD - 10;

const rows = lines.map((line, i) => {
  const kids = spans(line).filter(([t]) => t !== '')
    .map(([t, c]) => `<tspan fill="${c}">${esc(t)}</tspan>`).join('');
  return `<text xml:space="preserve" x="${PAD}" y="${TOP + i * LH}">${kids}</text>`;
}).join('\n  ');

writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace, 'SF Mono', Menlo, Consolas, monospace" font-size="14">
  <rect width="${W}" height="${H}" rx="12" fill="${C.bg}"/>
  <path d="M0 12a12 12 0 0 1 12-12h${W - 24}a12 12 0 0 1 12 12v24H0z" fill="${C.chrome}"/>
  <line x1="0" y1="36" x2="${W}" y2="36" stroke="${C.line}"/>
  <circle cx="20" cy="18" r="5" fill="#FF5F57"/><circle cx="38" cy="18" r="5" fill="#FEBC2E"/><circle cx="56" cy="18" r="5" fill="#28C840"/>
  <text x="${W / 2}" y="23" fill="${C.dim}" font-size="12" text-anchor="middle">${esc(title)}</text>
  ${rows}
</svg>
`);
console.log(`${out}  ${lines.length}줄`);
