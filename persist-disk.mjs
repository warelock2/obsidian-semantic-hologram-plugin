const PORT = 9222;
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find(t => t.url?.includes('app://obsidian.md'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.j(new Error(JSON.stringify(m.error))) : p.r(m.result); } };
const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { r: resolve, j: reject }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: `(async () => ${expr})()`, awaitPromise: true, returnByValue: true })).result.value;
console.log(JSON.stringify(await ev(`({
  live: app.plugins.plugins['semantic-hologram']?.settings?.rotationMode,
  onDisk: JSON.parse(await app.vault.adapter.read(app.vault.configDir + '/plugins/semantic-hologram/data.json')).rotationMode
})`), null, 2));
process.exit(0);
