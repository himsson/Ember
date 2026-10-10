---
name: web-page
title: Website or web app
description: Make a website, a page or a small web app that opens in a browser with nothing to install
---
Build a web page that works by opening index.html in a browser. No build tools, no npm, no frameworks.

Steps:
1. list_dir to see what exists.
2. write_file index.html: full document with <!doctype html>, <meta charset="utf-8">, <meta name="viewport" content="width=device-width, initial-scale=1">, a <title>, a link to style.css and a <script src="app.js"></script> right before </body>.
3. write_file style.css: readable font (system-ui), max-width container, spacing, visible buttons. Keep it under 120 lines.
4. write_file app.js: plain JavaScript. Every id used in app.js must exist in index.html. Save user data with localStorage if the app has data.
5. run_command: node --check app.js (skip if node is missing).
6. finish: tell the user to open index.html and list the files.

Common mistakes to avoid:
- Using an element id in app.js that is not in index.html.
- Forgetting to call the first render function at the end of app.js.
- Using import/require in a page opened from disk: it does not work, keep one script file.
