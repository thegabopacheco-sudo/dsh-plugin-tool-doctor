// Test end-to-end de tool-doctor con runtimes MCP sintéticos.
import path from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
const home = path.join(tmpDir, 'dsh-home');
const plugins = path.join(home, 'plugins');
mkdirSync(plugins, { recursive: true });

function writeRuntime(name, serverSource) {
  const dir = path.join(plugins, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `dsh-plugin-${name}`, version: '0.0.1' }), 'utf8');
  writeFileSync(path.join(dir, 'server.mjs'), serverSource, 'utf8');
}
const goodSource = `
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-good', version: '1.0.0' } } }) + '\\n');
  if (msg.method === 'tools/list') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'status', description: 'ok', inputSchema: { type: 'object' } }] } }) + '\\n');
});
`;
writeRuntime('good', goodSource);
writeRuntime('bad', `throw new Error('boom de arranque');`);
writeRuntime('empty', `process.exit(0);`);
mkdirSync(path.join(plugins, 'sin-server'), { recursive: true });
writeFileSync(path.join(plugins, 'sin-server', 'package.json'), '{}', 'utf8');

function makeClient() {
  const entry = process.env.DOCTOR_SERVER ? path.resolve(process.env.DOCTOR_SERVER) : path.join(packageDir, 'server.mjs');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME || process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: home }, stderr: 'pipe' });
  transport.stderr?.on('data', (c) => process.stderr.write(`[server] ${c}`));
  const client = new Client({ name: 'doctor-test', version: '1.0.0' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } });
  return client.connect(transport).then(() => ({ client, transport }));
}
const textOf = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

const { client, transport } = await makeClient();
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
console.log('--- status ---'); console.log(textOf(await client.callTool({ name: 'status', arguments: {} })));
const scan = await client.callTool({ name: 'scan', arguments: { timeoutMs: 8000 } });
const scanText = textOf(scan);
console.log('--- scan ---'); console.log(scanText);
console.log('good OK:', scanText.includes('✅ good'));
console.log('bad falla:', scanText.includes('❌ bad') && scanText.includes('boom'));
console.log('empty falla:', scanText.includes('❌ empty'));
console.log('sin-server se ignora:', !scanText.includes('sin-server'));
console.log('resumen 1/3:', scanText.includes('1/3 OK'));
const checkGood = await client.callTool({ name: 'check', arguments: { name: 'good' } });
console.log('--- check good ---'); console.log(textOf(checkGood));
console.log('check lista tools:', textOf(checkGood).includes('status'));
const checkBad = await client.callTool({ name: 'check', arguments: { name: 'bad' } });
console.log('check bad error:', textOf(checkBad).includes('FALLO'));
const missing = await client.callTool({ name: 'check', arguments: { name: 'no-existe' } });
console.log('check inexistente isError:', missing.isError === true);
await client.close(); try { await transport.close?.(); } catch {}
console.log('OK');
