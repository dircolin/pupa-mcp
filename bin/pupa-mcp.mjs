#!/usr/bin/env node
// npx pupa-mcp  → stdio 모드 (Claude Desktop / Claude Code / Cursor 가 실행)
import { runStdio, runHttp } from '../src/server.mjs';
(process.argv.includes('--http') ? runHttp() : runStdio()).catch(e => { console.error('[pupa-mcp]', e && e.message); process.exit(1); });
