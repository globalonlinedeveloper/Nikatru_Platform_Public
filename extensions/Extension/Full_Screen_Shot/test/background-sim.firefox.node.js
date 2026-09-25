#!/usr/bin/env node
/* FullShot BACKGROUND sim, FIREFOX ENGINE (2026-09-24,
   O-FIREFOX-BUILD-NEVER-RUN-IN-A-BROWSER limb 1).

   The whole of test/background-sim.node.js, run a second time as Firefox runs
   the same background.js: FS_ENGINE=gecko. That sim then
     · builds the manifest Firefox receives — manifest.json with the overlay
       tool.json names, merged by the mergePatch graded equal to scripts/pack.mjs's;
     · loads that manifest's background.scripts IN ORDER into one global,
       background.js last, instead of handing the worker an importScripts();
     · has NO importScripts in scope, so an unguarded call at background.js:24
       throws ReferenceError on load exactly as it does in Firefox;
     · refuses a permissions.request made outside a user gesture, as Firefox does
       ("permissions.request may only be called from a user input handler").

   Before this file, every sim run supplied importScripts, so the branch
   Firefox takes through background.js had never been executed by anything.

   A separate FILE rather than an argument, because scripts/run-tests.mjs runs
   each tool.json "tests" entry as `node <file>` with no arguments, and the
   ambient environment is passed through unchanged. Set here, before the require,
   so it is the only engine this process can model. */
'use strict';
process.env.FS_ENGINE = 'gecko';
require('./background-sim.node.js');
