#!/usr/bin/env python3
"""Run one explicitly scoped, fresh CLI Skill acceptance session.

Prompts and full output are formal verification evidence, not temporary files.
The caller chooses a prompt stored in this feature's verification directory.
"""
import argparse
import json
import subprocess
import time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("agent", choices=["codex", "claude"])
parser.add_argument("case")
parser.add_argument("--read-only", action="store_true")
parser.add_argument("--no-skills", action="store_true", help="Claude-only diagnostic, with no tools or Skills")
parser.add_argument("--timeout", type=int, default=240)
args = parser.parse_args()
if not args.case.replace("-", "").isalnum():
    parser.error("case must use letters, digits and hyphens")
root = Path(__file__).resolve().parents[2]
evidence = root / ".scratch/vault-rules-and-skills/verification"
prompt = evidence / (args.case + ".prompt.md")
if args.agent == "codex":
    command = ["codex", "exec", "--ephemeral", "--skip-git-repo-check", "--json",
               "-s", "read-only" if args.read_only else "danger-full-access",
               "-c", 'approval_policy="never"', "-"]
else:
    command = ["claude", "-p", "--verbose", "--output-format", "stream-json",
               "--no-session-persistence", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
               "--permission-mode", "dontAsk", "--tools", "Skill,Read,Bash,Glob,Grep",
               "--allowedTools", "Skill,Read,Bash,Glob,Grep"]
    if args.no_skills:
        command = command[:command.index("--tools")] + ["--tools", "", "--disable-slash-commands"]
started = time.time()
output = evidence / (args.case + ".jsonl")
errors = evidence / (args.case + ".stderr.txt")
with prompt.open("rb") as stdin, output.open("wb") as stdout, errors.open("wb") as stderr:
    process = subprocess.Popen(command, cwd=root, stdin=stdin, stdout=stdout, stderr=stderr)
    timed_out = False
    try:
        status = process.wait(timeout=args.timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        process.terminate()
        try:
            status = process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            status = process.wait()
result = {"agent": args.agent, "case": args.case, "command": command, "cwd": str(root),
          "started": started, "seconds": round(time.time() - started, 2), "exit_code": status,
          "timed_out": timed_out, "output": str(output.relative_to(root))}
(evidence / (args.case + ".execution.json")).write_text(json.dumps(result, ensure_ascii=False, indent=2))
print(json.dumps(result, ensure_ascii=False))
