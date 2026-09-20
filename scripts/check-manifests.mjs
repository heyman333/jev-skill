#!/usr/bin/env node
// 매니페스트 정합성 — 여섯 파일이 같은 이름과 버전을 말하는지 확인한다.
//
// Codex(portable + .codex-plugin)와 Claude Code(.claude-plugin)가 같은 저장소를
// 읽기 때문에 버전이 갈라지면 한쪽만 옛 스킬을 설치한다. 눈으로 지킬 수 있는
// 불변식이 아니라서 테스트에 박아 둔다.

import { readFileSync, existsSync, lstatSync, readlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const SOURCES = [
  ['package.json', (d) => d.version, (d) => d.name === 'jev-skill' ? 'jev' : d.name],
  ['plugin.json', (d) => d.version, (d) => d.name],
  ['.codex-plugin/plugin.json', (d) => d.version, (d) => d.name],
  ['.claude-plugin/plugin.json', (d) => d.version, (d) => d.name],
  ['.claude-plugin/marketplace.json', (d) => d.plugins[0].version, (d) => d.plugins[0].name],
  ['.agents/plugins/marketplace.json', () => null, (d) => d.plugins[0].name],
];

export function checkManifests() {
  const problems = [];
  const versions = {};
  const names = {};

  for (const [rel, getVersion, getName] of SOURCES) {
    let data;
    try {
      data = read(rel);
    } catch (e) {
      problems.push(`${rel} 을 읽지 못했습니다: ${e.message}`);
      continue;
    }
    const v = getVersion(data);
    if (v != null) versions[rel] = v;
    names[rel] = getName(data);
  }

  for (const [label, map] of [['버전', versions], ['이름', names]]) {
    const uniq = [...new Set(Object.values(map))];
    if (uniq.length > 1) {
      problems.push(`${label}이 갈라졌습니다: ` +
        Object.entries(map).map(([f, v]) => `${f}=${v}`).join(', '));
    }
  }

  // Codex 가 읽는 .agents/skills/jev 는 복사본이 아니라 링크여야 한다.
  // 복사본이면 스킬이 두 벌이 되고 한쪽만 고치게 된다.
  const link = join(ROOT, '.agents/skills/jev');
  if (!existsSync(link)) {
    problems.push('.agents/skills/jev 가 없습니다');
  } else if (!lstatSync(link).isSymbolicLink()) {
    problems.push('.agents/skills/jev 가 심볼릭 링크가 아닙니다. 복사본이면 스킬이 두 벌이 됩니다.');
  } else if (readlinkSync(link) !== '../../skills/jev') {
    problems.push(`.agents/skills/jev 링크가 ../../skills/jev 를 가리키지 않습니다: ${readlinkSync(link)}`);
  }

  // 스킬 본체가 제자리에 있는지
  for (const rel of ['skills/jev/SKILL.md', 'skills/jev/jev.mjs']) {
    if (!existsSync(join(ROOT, rel))) problems.push(`${rel} 이 없습니다`);
  }

  return { problems, version: Object.values(versions)[0], name: Object.values(names)[0] };
}

if (process.argv[1]?.endsWith('check-manifests.mjs')) {
  const { problems, version, name } = checkManifests();
  if (problems.length) {
    for (const p of problems) process.stderr.write(`✗ ${p}\n`);
    process.exit(1);
  }
  process.stdout.write(`✓ 매니페스트 6개가 ${name} ${version} 로 일치합니다\n`);
}
