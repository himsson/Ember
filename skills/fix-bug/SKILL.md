---
name: fix-bug
title: Find and fix a bug
description: Find the cause of an error in existing code and fix it without rewriting more than needed
---
Steps:
1. If the user gave an error message, search_text for the key words or the function name from it.
2. read_file the file where the error happens. Read it before any change.
3. In "thought", name the cause in one sentence before changing anything. If you are not sure, read one more related file instead of guessing.
4. Make the smallest change that fixes the cause: edit_file with a few lines in "find" copied exactly from read_file. Do not reformat or rename other code.
5. Check: run the program or its tests with run_command if that is possible without user input. If you cannot run it, say so.
6. finish: what the cause was, which file and what you changed, and whether you verified it.
