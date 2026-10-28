#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { IssueStore } = require('../../apps/workbench/issues.js');
const hash = text => createHash('sha256').update(text).digest('hex');
async function main() {
  const root = path.resolve(__dirname, '../..'), store = new IssueStore(root);
  const source = 'docs/workbench/verification/README.md';
  const evidence = await fs.readFile(path.join(root, source), 'utf8');
  const statement = evidence.split('\n').find(line => /第 01[—–－-]12 项本机验收通过/.test(line));
  assert.ok(statement, '先核对现有验收索引中的第 01—12 项完成结论');
  const catalog = await store.list(), selected = catalog.issues.filter(i => ['vault-workspace-v1', 'workbench-agent-control'].includes(i.feature));
  assert.equal(selected.length, 15, '初始化只覆盖本轮已确认的原有 15 个 Issue');
  const plans = [];
  for (const issue of selected) {
    const completed = issue.feature === 'vault-workspace-v1' && issue.number <= 12;
    if (completed) assert.ok(issue.checks.length > 0 && issue.checks.every(c => c.done), `验收勾选与完成结论不一致：${issue.ref}`);
    const section = issue.description.match(/## 前置任务\r?\n([\s\S]*?)(?=\r?\n## |$)/)?.[1].trim().split(/\r?\n\s*\r?\n/)[0] || '';
    const dependencies = [...section.matchAll(/\]\((\d+)-[^)]+\.md\)/g)].map(match => `${issue.feature}#${match[1].padStart(2, '0')}`);
    for (const ref of dependencies) assert.ok(selected.some(i => i.ref === ref), `前置链接不存在：${ref}`);
    plans.push({ path: issue.path, ref: issue.ref, state: completed ? 'completed' : 'open', dependencies, beforeHash: hash(issue.content), alreadyRecorded: Boolean(issue.fields.State) });
  }
  const report = { checkedAt: new Date().toISOString(), authorization: '2026-10-21 用户确认按照设计建议实施，包含原有 Issue 状态核对与登记', source, sourceHash: hash(evidence), statement, plans, applied: false };
  const out = path.join(root, 'docs/workbench/verification/issues'); await fs.mkdir(out, { recursive: true });
  if (!process.argv.includes('--apply')) { console.log(JSON.stringify(report, null, 2)); return; }
  for (const plan of plans) {
    let issue = await store.read(plan.path); assert.equal(hash(issue.content), plan.beforeHash, `执行前文件已变化：${plan.path}`);
    if (plan.alreadyRecorded) { plan.skipped = '已有明确 State，保留当前决定，不重置。'; continue; }
    const original = issue;
    issue = await store.update(issue.path, issue.content, { action: 'initialize', resolution: plan.state, actor: 'Agent', conclusion: plan.state === 'completed' ? '按本轮已确认的初始化范围，根据现有验收索引及本 Issue 的验收记录登记为已完成；本次未重新执行历史功能验收。' : '按本轮已确认的初始化范围登记为未关闭；原任务仍有未完成工作或待补信息。' });
    issue = await store.update(issue.path, issue.content, { action: 'metadata', blockedBy: plan.dependencies, actor: 'Agent' });
    assert.equal(issue.description, original.description, '原正文必须逐字保留');
    assert.equal(issue.title, original.title); assert.equal(issue.triage, original.triage);
    assert.ok(issue.legacyComments.startsWith(original.legacyComments), '旧评论必须原样保留');
    plan.afterHash = hash(issue.content); plan.originalBodyPreserved = true; plan.originalCommentsPreserved = true;
    await fs.writeFile(path.join(out, 'migration.json'), JSON.stringify(report, null, 2) + '\n');
  }
  report.applied = true; await fs.writeFile(path.join(out, 'migration.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ applied: true, completed: plans.filter(p => p.state === 'completed').length, open: plans.filter(p => p.state === 'open').length, skipped: plans.filter(p => p.skipped).length }));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
