---
name: python-script
title: Python script
description: Write and check a Python script: files, tables, text, automation
---
Steps:
1. check_tool python. If it is missing, write the script anyway and ask_user about installing Python.
2. If the script works on the user's files, list_dir and read_file a sample first, so the code matches the real format.
3. write_file the script. Rules:
   - only the standard library unless the user asked for a package (csv, json, pathlib, re, argparse are enough for most jobs);
   - open text files with encoding="utf-8";
   - put the work in a main() function and end the file with: if __name__ == "__main__": main()
   - print a short result message at the end.
4. run_command: python script_name.py - on a small test input, not on the user's only copy of the data. If it changes files, make it write to a new file instead of overwriting.
5. If the run fails, read the error, fix the file, run again. At most 3 attempts, then explain honestly what does not work.
6. finish: how to run it and what it produced.
