#!/usr/bin/env node
// dsh-plugin-tool-doctor — arranca cada servidor MCP instalado y verifica handshake + tools.
// Tools: status, scan, check.

import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const v = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return v || path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
})();
const PLUGINS_DIR = path.join(DSH_HOME, 'plugins');
const PROFILE_PKG = path.join(DSH_HOME, 'profiles', 'desktop', 'package.json');
const log = (m) => process.stderr.write(`[doctor] ${m}\n`);

function listRuntimes() {
  let entries = [];
  try { entries = readdirSync(PLUGINS_DIR, { withFileTypes: true }); } catch { /* sin plugins */ }
  const runtimes = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(PLUGINS_DIR, entry.name);
    const entryFile = path.join(dir, 'server.mjs');
    if (!existsSync(entryFile)) continue;
    let pkg = {};
    try { pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8').replace(/^\uFEFF/, '')); } catch { /* ignora */ }
    runtimes.push({ name: entry.name, entryFile, version: pkg.version || null, packageName: pkg.name || `dsh-plugin-${entry.name}`, configFile: path.join(DSH_HOME, entry.name, 'config.json') });
  }
  return runtimes.sort((a, b) => a.name.localeCompare(b.name));
}

function installedFromProfile() {
  try {
    const pkg = JSON.parse(readFileSync(PROFILE_PKG, 'utf8').replace(/^\uFEFF/, ''));
    return Object.entries(pkg.dependencies || {}).filter(([, spec]) => String(spec).startsWith('github:thegabopacheco-sudo/dsh-plugin-')).map(([name]) => name.replace(/^dsh-plugin-/, ''));
  } catch { return []; }
}

function parseMessages(buffer, messages) {
  const text = buffer.toString('utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const message = JSON.parse(trimmed);
      if (message && typeof message === 'object') messages.push(message);
    } catch { /* líneas de log mezcladas */ }
  }
}

function handshake(runtime, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tempHome = path.join(os.tmpdir(), `tool-doctor-${process.pid}-${runtime.name}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tempHome, { recursive: true });
    const child = spawn(process.execPath, [runtime.entryFile], {
      env: { ...process.env, DSH_HOME: tempHome, DSH_PROFILE: 'tool-doctor-check' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const messages = [];
    let stderrText = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGTERM'); } catch { /* ya cerrado */ }
      try { rmSync(tempHome, { recursive: true, force: true }); } catch { /* ignora */ }
      resolve({ durationMs: Date.now() - started, stderr: stderrText.trim().slice(-600), ...result });
    };
    const timer = setTimeout(() => finish({ ok: false, tools: [], error: `timeout tras ${timeoutMs} ms` }), timeoutMs);
    child.on('error', (error) => finish({ ok: false, tools: [], error: `spawn: ${error.message}` }));
    child.on('exit', (code) => { if (!settled) finish({ ok: false, tools: [], error: `el proceso terminó (código ${code}) antes del handshake` }); });
    child.stdout.on('data', (chunk) => {
      parseMessages(chunk, messages);
      if (!messages.some((m) => m.id === 1 && (m.result || m.error))) return;
      if (messages.some((m) => m.id === 2 && (m.result || m.error))) return; // aún no
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
    });
    child.stderr.on('data', (chunk) => { stderrText += chunk.toString('utf8'); });
    const ping = setInterval(() => {
      const init = messages.find((m) => m.id === 1);
      const tools = messages.find((m) => m.id === 2);
      if (init && tools) {
        clearInterval(ping);
        if (init.error) return finish({ ok: false, tools: [], error: `initialize: ${init.error.message || JSON.stringify(init.error)}` });
        if (tools.error) return finish({ ok: false, tools: [], error: `tools/list: ${tools.error.message || JSON.stringify(tools.error)}` });
        const list = Array.isArray(tools.result?.tools) ? tools.result.tools : [];
        finish({ ok: true, tools: list.map((tool) => tool.name), serverInfo: init.result?.serverInfo || null });
      }
    }, 50);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'tool-doctor', version: VERSION } } }) + '\n');
  });
}

function textResult(text) { return { content: [{ type: 'text', text }] }; }
function icon(ok) { return ok ? '✅' : '❌'; }

function buildInstructions() {
  return [
    'Tool Doctor: diagnostica los servidores MCP instalados en el harness.',
    '',
    `Runtimes: ${PLUGINS_DIR}`,
    '',
    'Herramientas: status, scan, check.',
    '',
    'Reglas:',
    '- scan arranca cada servidor en un DSH_HOME temporal aislado, hace handshake MCP y lista sus tools; luego lo cierra.',
    '- Es solo lectura sobre la instalación real: no modifica plugins ni configs.',
    '- Reporta fallos reales con stderr; no marques OK sin handshake completo.',
    '- Usa check para inspeccionar un servidor concreto con más detalle.',
  ].join('\n');
}

function buildServer() {
  const server = new McpServer({ name: 'dsh-plugin-tool-doctor', version: VERSION }, { capabilities: { tools: {} }, instructions: buildInstructions() });

  server.registerTool(
    'status',
    { title: 'Estado', description: 'Runtimes instalados, perfil y diferencias.', inputSchema: z.object({}) },
    async () => {
      const runtimes = listRuntimes();
      const installed = installedFromProfile();
      const missing = installed.filter((slug) => !runtimes.some((runtime) => runtime.name === slug));
      return textResult([`Runtimes desplegados: ${runtimes.length}`, `Instalados en perfil: ${installed.length}`, `Sin runtime (reinstalar): ${missing.length ? missing.join(', ') : 'ninguno'}`, `Raíz: ${PLUGINS_DIR}`].join('\n'));
    },
  );

  server.registerTool(
    'scan',
    {
      title: 'Escanear servidores',
      description: 'Arranca cada servidor MCP y verifica handshake y tools. Puede tardar.',
      inputSchema: z.object({ limit: z.number().int().min(1).max(60).optional(), timeoutMs: z.number().int().min(1000).max(60000).optional(), only: z.string().optional() }),
    },
    async (args) => {
      const runtimes = listRuntimes().filter((runtime) => !args.only || runtime.name.includes(args.only));
      const slice = runtimes.slice(0, args.limit ?? 60);
      if (slice.length === 0) return textResult(`No hay runtimes en ${PLUGINS_DIR}.`);
      const results = [];
      for (const runtime of slice) results.push({ runtime, ...(await handshake(runtime, args.timeoutMs ?? 15000)) });
      const lines = results.map((result) => `${icon(result.ok)} ${result.runtime.name}${result.ok ? ` · ${result.tools.length} tools · ${result.durationMs} ms` : ` · ${result.durationMs} ms · ${result.error}`}`);
      const ok = results.filter((result) => result.ok).length;
      const failed = results.filter((result) => !result.ok);
      const summary = `\nResultado: ${ok}/${results.length} OK${failed.length ? ` · fallan: ${failed.map((f) => f.runtime.name).join(', ')}` : ''}`;
      const details = failed.map((f) => `\n--- ${f.runtime.name} ---\n${f.stderr ? f.stderr : '(sin stderr)'}`).join('');
      return textResult(lines.join('\n') + summary + details);
    },
  );

  server.registerTool(
    'check',
    { title: 'Revisar servidor', description: 'Handshake detallado de un servidor MCP concreto.', inputSchema: z.object({ name: z.string().min(1), timeoutMs: z.number().int().min(1000).max(60000).optional() }) },
    async (args) => {
      const runtime = listRuntimes().find((item) => item.name === args.name || item.name.includes(args.name));
      if (!runtime) throw new Error(`runtime no encontrado: ${args.name}`);
      const result = await handshake(runtime, args.timeoutMs ?? 15000);
      return textResult([
        `Runtime: ${runtime.name}`,
        `Entry: ${runtime.entryFile}`,
        `Versión: ${runtime.version || 'desconocida'}`,
        `Config: ${existsSync(runtime.configFile) ? runtime.configFile : '(sin config.json)'}`,
        `Estado: ${result.ok ? 'OK' : 'FALLO'}`,
        `Duración: ${result.durationMs} ms`,
        result.ok ? `Server: ${JSON.stringify(result.serverInfo)}\nTools (${result.tools.length}): ${result.tools.join(', ')}` : `Error: ${result.error}\nStderr: ${result.stderr || '(vacío)'}`,
      ].join('\n'));
    },
  );

  return server;
}

try { mkdirSync(path.join(DSH_HOME, 'cache', 'tool-doctor'), { recursive: true }); } catch { /* ignora */ }
log(`plugins: ${PLUGINS_DIR}`);
serveStdio(buildServer, { onerror: (e) => log(`serveStdio: ${e.message}`) });
process.on('uncaughtException', (e) => log(`excepción: ${e.message}`));
process.on('unhandledRejection', (e) => log(`rechazo: ${e && e.message ? e.message : String(e)}`));
