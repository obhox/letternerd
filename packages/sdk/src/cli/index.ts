#!/usr/bin/env node
import { run } from "./run";

/**
 * The bin. Everything it does is in `run`, which is a function of its argv so
 * that it can be tested without spawning a process.
 *
 * `.then` rather than a top-level `await`: this entry is emitted in both ESM
 * and CJS, and CJS has no top-level await. Setting `exitCode` rather than
 * calling `process.exit` lets stdout drain — a summary truncated mid-file-list
 * is exactly the output someone would act on.
 */
void run(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
