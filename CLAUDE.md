@AGENTS.md

# Claude Code

Read docs/CLAUDE-CODE.md before setup or production. Follow the common production
procedure in docs/AUTOMATIC.md, substituting the tools described in that guide
for Codex-only tools and skills. Do not assume Codex image_gen or bundled skills
are available. Use the declared external renderer and actually inspect PNGs with
Read. Use a real manga-reviewer subagent for independent stage reviews, passing
the exact prepared request and files; never invent task IDs or observations.
Preserve all common review, history, coverage and completion gates.
