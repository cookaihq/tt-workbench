#!/usr/bin/env python3
"""在已打开的 tannt DevTools Console 执行从 stdin 提交的验收代码。

要求窗口 ID 参数来自当次 list-windows；不打开其他库或自动切换窗口。
"""
import json
import re
import subprocess
import sys

window_id = sys.argv[1]
code = sys.stdin.read()
if not code.strip():
    raise SystemExit('stdin 需要提供验收代码')


def run(command, *args, payload=None):
    process = subprocess.run([
        '/usr/local/bin/orca', 'computer', command, '--app', 'md.obsidian',
        '--window-id', window_id, *args, '--no-screenshot', '--json'
    ], input=payload, capture_output=True, text=True, check=True)
    result = json.loads(process.stdout)
    tree = result.get('result', {}).get('snapshot', {}).get('treeText', '')
    if ' - tannt - Obsidian ' not in tree:
        raise SystemExit('没有得到 tannt 窗口，停止操作；其他窗口内容不输出。')
    return tree


tree = run('get-app-state')
if '--clear' in sys.argv:
    clear = re.search(r'(\d+) button Clear console', tree)
    if clear:
        run('click', '--element-index', clear[1], '--restore-window')
        tree = run('get-app-state')
prompt = re.search(r'(\d+) text entry area \(settable\) Console prompt', tree)
if not prompt:
    raise SystemExit('当前窗口没有 Console prompt；先打开开发者工具。')
if not re.search(r'The focused UI element is \d+ text entry area \(settable\) Console prompt', tree):
    run('click', '--element-index', prompt[1], '--restore-window')
    tree = run('get-app-state')
if not re.search(r'The focused UI element is \d+ text entry area \(settable\) Console prompt', tree):
    if len(sys.argv) >= 4 and not sys.argv[2].startswith('--'):
        # Optional coordinates must come from the caller's current screenshot.
        run('click', '--x', sys.argv[2], '--y', sys.argv[3])
        tree = run('get-app-state')
    if not re.search(r'The focused UI element is \d+ text entry area \(settable\) Console prompt', tree):
        raise SystemExit('Console 没有实际焦点，未输入代码。')
prompt = re.search(r'(\d+) text entry area \(settable\) Console prompt', tree)
guarded = 'void (async()=>{const a=window.app||window.opener?.app;if(a?.vault.getName()!=="tannt")throw new Error("NOT_TANNT");' + code.strip() + '\n})()'
run('set-value', '--element-index', prompt[1], '--value-stdin', payload=guarded)
tree = run('get-app-state')
if 'NOT_TANNT' not in tree:
    raise SystemExit('未在 Console 回读到输入，未按回车。')
run('press-key', '--key', 'Return')
print('已从 tannt Console 发起；是否成功以验收报告或后续 UI 回读为准。')
