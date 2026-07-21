// Generate THIRD_PARTY_NOTICES.md by collecting the license text of every
// production dependency (the code we redistribute in the bundle / Pages build).
// Over-inclusion is safe: attributing a dependency we happen not to ship is
// harmless, missing one we do ship is not.
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tree = JSON.parse(execSync('npm ls --omit=dev --all --json || true', { cwd: root }).toString());

const pkgs = new Map(); // name -> version
(function walk(deps) {
  if (!deps) return;
  for (const [name, info] of Object.entries(deps)) {
    if (info.version && !pkgs.has(name)) pkgs.set(name, info.version);
    walk(info.dependencies);
  }
})(tree.dependencies);

function readLicense(name) {
  const dir = join(root, 'node_modules', name);
  let spdx = 'UNKNOWN';
  let author = '';
  try {
    const p = JSON.parse(readFileSync(join(dir, 'package.json')));
    spdx = p.license || (p.licenses && p.licenses.map((x) => x.type).join(' OR ')) || 'UNKNOWN';
    author = typeof p.author === 'string' ? p.author : p.author?.name || '';
  } catch {
    /* ignore */
  }
  let text = '';
  try {
    const file = readdirSync(dir).find((f) => /^(LICENSE|LICENCE|COPYING|NOTICE)/i.test(f));
    if (file) text = readFileSync(join(dir, file), 'utf8').trim();
  } catch {
    /* ignore */
  }
  return { spdx, author, text };
}

const names = [...pkgs.keys()].sort();
let out = `# Third-Party Notices\n\n`;
out += `이 프로젝트는 아래 오픈소스 구성요소를 브라우저 번들/배포물에 포함합니다.\n`;
out += `각 구성요소는 해당 라이선스를 따르며, 원 저작권 및 라이선스 고지를 여기에 보존합니다.\n\n`;
out += `> jszip 는 (MIT OR GPL-3.0-or-later) 듀얼 라이선스이며, 본 배포는 **MIT**를 선택합니다.\n\n`;

// license summary
const summary = {};
for (const n of names) {
  const { spdx } = readLicense(n);
  summary[spdx] = (summary[spdx] || 0) + 1;
}
out += `## 요약\n\n| 라이선스 | 패키지 수 |\n| --- | --- |\n`;
for (const [k, v] of Object.entries(summary).sort()) out += `| ${k} | ${v} |\n`;
out += `\n---\n\n`;

let withText = 0;
for (const name of names) {
  const { spdx, author, text } = readLicense(name);
  out += `## ${name}@${pkgs.get(name)}\n\n`;
  out += `- SPDX: \`${spdx}\`\n`;
  if (author) out += `- Author: ${author}\n`;
  out += `\n`;
  if (text) {
    withText++;
    out += '```\n' + text + '\n```\n\n';
  } else {
    out += `_(패키지에 라이선스 파일이 없어 SPDX 식별자로 표기)_\n\n`;
  }
}

writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), out);
console.log(`THIRD_PARTY_NOTICES.md 생성: ${names.length} packages (${withText} with license text)`);
