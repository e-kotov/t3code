You are finishing an upstream merge in e-kotov/t3code, a fork of pingdotgg/t3code. You run
unattended in GitHub Actions: nobody answers questions, so decide as described here.

HEAD contains a merge of upstream main into the fork (first parent: the fork's main; second parent:
upstream main), possibly followed by formatting, route-tree or earlier fix commits. The section
"This run" at the end says what is wrong: files that still contain Git conflict markers (diff3
style: ours, the merge base, theirs), or the error excerpt of the fork's failed checks, or review
findings to address. Git's merge, rerere and the mergiraf merge tool already handled everything
else.

Read AGENTS.md and .agents/skills/fork-development/SKILL.md first. Every resolution must keep
future upstream merges clean:

- Upstream-owned code follows upstream. Take upstream's version as the base and re-add the fork's
  behavior as the smallest mount: an import plus a line or two that calls fork-owned code. Do not
  rewrite, reformat, rename or reorder upstream code around a fork change.
- When a fork mount no longer fits upstream's new structure, move the fork logic into a fork-owned
  file (new or existing) and mount it, rather than spreading fork lines through upstream code.
- Reuse upstream APIs through small adapters; do not copy upstream's private internals into fork
  files. Do not edit upstream tests to pass; fix the fork code so upstream behavior holds.

1. Fix exactly what "This run" describes. In conflicted files remove every marker and keep both
   sides' intent: "ours" is fork code, "theirs" is upstream's change. When upstream removed or
   restructured code that a fork line touched, move the fork's addition onto upstream's new
   structure; never restore code upstream deleted. See what upstream changed with
   `m=$(git rev-list --merges -1 HEAD); git diff "$m^1" "$m^2" -- <file>`.
2. Check fork features that merged cleanly but may have lost their mount point, for example a fork
   entry missing from a list that upstream rebuilt.
3. Change only what the merge requires: no unrelated refactors, formatting passes or dependency
   changes, edits under .github/, or fixes to problems that already exist on the fork's main.
   Moving a conflicting fork change into a fork-owned file is part of the merge, not a refactor.
4. Verify: dependency installation may have failed before you started; its error appears in
   "This run". Resolve manifest and lockfile conflicts first, preserving dependency patches and
   both sides' required version changes. Run `vp install`; if the merged lockfile needs
   regeneration, use `vp install --no-frozen-lockfile`, then `vp install --frozen-lockfile`.
   Do not remove patches or disable frozen validation to make installation pass.
   Typecheck each package you touched (`cd <package> && vp run typecheck`) and run its changed
   tests (`cd <package> && vp test run <file>`). Run
   `python3 scripts/fork-footprint-budget.py`; if it reports growth, prefer moving fork logic into
   fork-owned files, and only for a few unavoidable mount lines run it with `--write`. If it reports
   a file dropped to 0 lines, a fork mount was lost: restore it (see step 2) and do not `--write`
   it away; retiring the feature is a decision for step 5. A shrinkage warning is informational;
   check the feature is intact.
5. Do not commit or push; the workflow commits your working tree.
   Safety and Bail-out Rule:
   If a conflict is ambiguous, involves substantial upstream structural churn, or would require
   speculatively redesigning a fork feature without a clean, verifiable replacement: DO NOT guess,
   hallucinate, or force a resolution. It is always safer to halt than to corrupt the codebase.
   Resolve whatever is unambiguous, then write `.claude-needs-decision.md` at the repository root
   detailing the dilemma, what changed upstream, why resolving it automatically is too risky,
   and your recommended options for Egor. The workflow will halt cleanly without pushing or
   promoting anything to main.

End with a short plain-language summary of what you changed and why.
