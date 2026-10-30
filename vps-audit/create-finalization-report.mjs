import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { writeAuditPdf } from './write-audit-pdf.mjs';
const dir = import.meta.dirname;
const root = path.dirname(dir);
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const files = (p) => readdirSync(path.join(root, p), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(`${p}/${e.name}`) : [`${p}/${e.name}`]);
const tests = [...files('test'), ...files('server/test')].filter((f) => f.endsWith('.test.js') || f.endsWith('.test.mjs'));
const index = (paths, pattern) => paths.flatMap((f) => read(f).split(/\r?\n/).flatMap((line, i) => pattern.test(line) ? [`${f}:${i + 1}: ${line.trim()}`] : []));
writeFileSync(path.join(dir, 'evidence/feature-test-index.txt'), index(tests, /^test\(/).join('\n') + '\n');
writeFileSync(path.join(dir, 'evidence/feature-route-index.txt'), index(files('server/src/routes'), /\w+Router\.(get|post|put|patch|delete)\(/).join('\n') + '\n');

const current = read('vps-audit/finalization-report.md');
const inventory = read('vps-audit/feature-inventory.md');
const prior = JSON.parse(read('vps-audit/findings.json'));
const register = '# Previous audit issue register\n\n' + prior.map((e) => `## ${e.id} — ${e.status}: ${e.title}\n\nSeverity: ${e.severity}. Source: ${e.currentReference}.\n\n${e.resolution}\n\nAcceptance check: ${e.verify}`).join('\n\n');
const markdown = [current, inventory, register].join('\n\n');
writeFileSync(path.join(dir, 'report.md'), markdown);
const parts = [];
for (const line of markdown.split(/\r?\n/)) {
  if (/^#+ /.test(line)) parts.push({ title: line.replace(/^#+ /, ''), body: [] });
  else if (line.trim() && !/^\|[-| ]+\|$/.test(line)) {
    if (!parts.length) parts.push({ title: 'Review', body: [] });
    parts.at(-1).body.push(line.replace(/\*\*/g, '').replace(/`/g, ''));
  }
}
console.log(JSON.stringify(writeAuditPdf(parts, path.join(dir, 'report.pdf'))));
