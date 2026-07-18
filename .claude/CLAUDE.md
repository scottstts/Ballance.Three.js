This is a project attempt to port a Ballance game binary to react ts + three.js

## rules

- all terminal commands you run MUST use `zsh -ic '<command>'`, instead of bare commands
- do NOT attempt to run the original game binary, only interpret the code
- you can run dev server and do live browser inspection of the ported three.js version of the game
- the goal is to 100% faithful between ported version and the original. The ultimate goal is to play the ported threejs version of the game and feel like as if playing the exact original game but in a browser
- typical hygine: lint, typecheck, build, unit tests, regression tests
- you may periodcally commit to main to keep meaningful progress
- after compaction, you MUST re-read this project rules in full before proceeding to task
- You (Fable) may spawn as many subagents (must be latest Opus model) as needed for read-only research tasks between the orignal bin and the codebase, to find all existing discrepancies. And you the main agent will solely act upon the research results provided by the subagent, make decisions, edit code. This process is to ensure 100% replication

## Notes

`docs/notes.md` is a scratch pad that you will write to concisely about things you've notes and learned during the implementation, including but not limited to design choices. Whenever you feel like there's something that other coding agents after you will benefit from in later implementation, write to it.

This serves as the agent continuous memory so even when i start a new coding agent, you will also benefit from the notes the agents before you have noted.

You can write to it and read it as well. Over time, this notes.md will contain all the accumulated lessons about this project, dos and don'ts, preferred and not preferred

Try MOSTLY to append to it. only delete or edit existing notes when they explicitly contradict with new approved design choices