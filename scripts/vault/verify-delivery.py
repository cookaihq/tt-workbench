#!/usr/bin/env python3
"""Read-only delivery checks; writes formal evidence for the approved feature."""
from pathlib import Path
from datetime import datetime, timezone
import ast
import hashlib
import json
import re
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.scratch/vault-rules-and-skills/verification'
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
baseline = json.loads((OUT / 'baseline.json').read_text())
installer = (ROOT / 'scripts/workbench/install.mjs').read_text()
names = ast.literal_eval(re.search(r'const names = (\[[^;]+\]);', installer)[1])
pairs = [(ROOT / 'apps/workbench' / name, ROOT / '.obsidian/plugins/tt-workbench' / name) for name in names]
for p in (ROOT / 'lib/vault').rglob('*'):
    relative = p.relative_to(ROOT / 'lib/vault')
    if p.is_file() and 'tests' not in relative.parts and p.name != 'README.md':
        pairs.append((p, ROOT / '.obsidian/plugins/tt-workbench/vault-lib' / relative))
installed = [{'source': str(a.relative_to(ROOT)), 'installed': str(b.relative_to(ROOT)),
              'sha256': digest(a), 'matched': b.is_file() and digest(a) == digest(b)} for a, b in pairs]

business_changes = [name for name, expected in baseline['business_files'].items()
                    if not (ROOT / name).is_file() or digest(ROOT / name) != expected]
business = {}
for name in ['01.收件箱', '02.独立任务', '03.知识', '04.资料', '05.领域', '06.经验']:
    for p in (ROOT / name).rglob('*'):
        if p.is_file() and not p.is_symlink(): business[str(p.relative_to(ROOT))] = digest(p)

source_paths = {ROOT / name for name in baseline['source_files']}
for name in ['lib/vault', 'docs/rules', 'skills', 'scripts/vault', 'scripts/agent-skills']:
    source_paths.update(p for p in (ROOT / name).rglob('*') if p.is_file() and not p.is_symlink())
source_paths.update(ROOT / n for n in ['AGENTS.md','README.md','docs/agents/vault-file-operations.md',
    'apps/workbench/tests/attachments.test.cjs',
    'docs/workbench/agent-skill-setup.md','docs/workbench/verification/README.md',
    '.scratch/vault-rules-and-skills/spec.md','.scratch/vault-rules-and-skills/rule-migration.md',
    '.scratch/vault-rules-and-skills/backlog.md'])
source_paths.update((ROOT / '.scratch/vault-rules-and-skills/issues').glob('*.md'))
source_paths.update(a for a,b in pairs)
source_paths.update(b for a,b in pairs)
target = {str(p.relative_to(ROOT)): digest(p) for p in sorted(source_paths) if p.is_file()}

docs = [ROOT / n for n in ['AGENTS.md','README.md','apps/workbench/README.md',
    'docs/agents/vault-file-operations.md','docs/adr/0001-shared-rules-and-scenario-skills.md',
    'docs/workbench/agent-skill-setup.md','docs/workbench/inbox-format.md',
    'docs/workbench/attachments.md','docs/workbench/work-records.md','docs/workbench/note-reuse.md',
    'docs/workbench/verification/README.md','.scratch/vault-rules-and-skills/spec.md',
    '.scratch/vault-rules-and-skills/backlog.md','.scratch/vault-rules-and-skills/verification/README.md']]
docs.extend((ROOT / 'docs/rules').glob('*.md'))
docs.extend((ROOT / '.scratch/vault-rules-and-skills/issues').glob('*.md'))
missing, count = [], 0
for p in docs:
    for link in re.findall(r'\[[^\]]*\]\(([^)]+)\)', p.read_text()):
        link = link.strip('<>').split('#')[0]
        if not link or re.match(r'[a-z][a-z0-9+.-]*:', link): continue
        count += 1
        if not (p.parent / unquote(link)).exists(): missing.append({'file': str(p.relative_to(ROOT)), 'link': link})

links = {'files':len(docs),'links':count,'missing':missing}
(OUT / 'document-links.json').write_text(json.dumps(links,ensure_ascii=False,indent=2)+'\n')
report = {'checked_at':datetime.now(timezone.utc).isoformat(),'baseline':'baseline.json',
    'version':json.loads((ROOT/'apps/workbench/manifest.json').read_text())['version'],
    'source_files':target,'installed_files':installed,'original_business_count':len(baseline['business_files']),
    'original_business_changed':business_changes,
    'new_business_files':{n:h for n,h in business.items() if n not in baseline['business_files']},
    'document_links':links,
    'passed':not business_changes and not missing and all(x['matched'] for x in installed)}
(OUT/'delivery.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['checked_at','version','original_business_count','original_business_changed','document_links','passed']},ensure_ascii=False))
print(json.dumps({'installed_files':len(installed),'new_business_files':len(report['new_business_files']),'target_files':len(target)}))
raise SystemExit(0 if report['passed'] else 1)
