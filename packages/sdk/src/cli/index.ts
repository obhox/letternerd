#!/usr/bin/env node
import { run } from "./run";

/**
 * The bin. Everything it does is in `run`, which is a function of its argv so
 * that it can be tested without spawning a process.
 */
process.exitCode = await run(process.argv.slice(2));
