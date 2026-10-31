#!/usr/bin/env node
import { main } from '../src/cli.js';
main().catch(error => { console.error(`错误：${error.message}`); process.exitCode = 1; });
