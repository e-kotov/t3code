You are resolving an upstream merge in e-kotov/t3code, a fork of pingdotgg/t3code.

The branch you start on ends with a merge commit, "Merge upstream main … with unresolved
conflicts". Its first parent is the fork's main and its second parent is upstream main. The files
listed after "Unresolved:" in that commit message still contain Git conflict markers (diff3
style: ours, the merge base, theirs). Git's automatic merge and the mergiraf merge tool already
handled everything else.

Before editing, read AGENTS.md and .agents/skills/fork-development/SKILL.md, which explain where
fork code lives and why fork edits in upstream files are kept small.

Do this:

1. In each listed file, remove every conflict marker and keep both sides' intent. "Ours" is fork
   code; "theirs" is upstream's change. When upstream removed or restructured code that a fork
   line touched, move the fork's addition onto upstream's new structure; do not restore code
   upstream deleted. Compare the two parents (`git diff HEAD^1 HEAD^2 -- <file>`) to see what
   upstream changed.
2. Check fork features that merged without a conflict but may have lost their mount point, for
   example a fork entry missing from a list that upstream rebuilt.
3. Change nothing else: no unrelated refactors, formatting passes, dependency updates or edits
   under .github/. Keep fork edits in upstream-owned files as small as before.
4. Run `python3 scripts/fork-footprint-budget.py`. If it reports growth, prefer moving fork logic
   into fork-owned files. Only when a few extra mount lines are unavoidable, run it with `--write`
   and keep the budget change.
5. If dependencies install in your environment, typecheck the packages you touched. Otherwise
   rely on the repository's CI, which runs after your pull request.
6. If a conflict needs a product decision (removing, relocating or redesigning a fork feature or
   its interface), do not guess. Resolve the rest, then add `.jules-needs-decision.md` at the
   repository root describing the decision, the options and your recommendation.

Commit your resolution on top of this branch. Do not rebase, squash, or rewrite the merge commit;
the fork's automation rebuilds a clean merge commit from your final files and checks it.
