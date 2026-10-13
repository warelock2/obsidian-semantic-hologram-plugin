import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';

async function getWebSocketUrl() {
    return new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:9222/json', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const targets = JSON.parse(data);
                    const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
                    if (page) {
                        resolve(page.webSocketDebuggerUrl);
                    } else {
                        reject(new Error('No Obsidian page target found'));
                    }
                } catch (err) {
                    reject(err);
                }
            });
        }).on('error', reject);
    });
}

class CDPClient {
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
        this.ws = null;
        this.id = 1;
        this.callbacks = new Map();
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.wsUrl);
            this.ws.onopen = () => resolve();
            this.ws.onerror = (err) => reject(err);
            this.ws.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                if (msg.id && this.callbacks.has(msg.id)) {
                    const { resolve, reject } = this.callbacks.get(msg.id);
                    this.callbacks.delete(msg.id);
                    if (msg.error) {
                        reject(new Error(msg.error.message));
                    } else {
                        resolve(msg.result);
                    }
                }
            };
        });
    }

    send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = this.id++;
            this.callbacks.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    close() {
        if (this.ws) this.ws.close();
    }
}

test('CDP Camera and View Invariants', async (t) => {
    let wsUrl;
    try {
        wsUrl = await getWebSocketUrl();
    } catch (err) {
        console.warn('Skipping live CDP tests: Obsidian debug port (9222) unreachable:', err.message);
        return;
    }

    const client = new CDPClient(wsUrl);
    await client.connect();
    await client.send('Runtime.enable');

    const stateRes = await client.send('Runtime.evaluate', {
        expression: `
            (() => {
                const leaf = app.workspace.getLeavesOfType('semantic-hologram-view')[0];
                const view = leaf?.view;
                if (!view) return null;
                const m = view.rotM;
                // Compute determinant of 3x3 rotM
                const det = m[0]*(m[4]*m[8] - m[5]*m[7]) - m[1]*(m[3]*m[8] - m[5]*m[6]) + m[2]*(m[3]*m[7] - m[4]*m[6]);
                return {
                    hasView: true,
                    rotM: [...m],
                    det: Math.round(det * 1000) / 1000,
                    azimuth: view.azimuth,
                    elevation: view.elevation,
                    distance: view.cameraDistance,
                    is3D: view.is3D,
                    isPerspective: view.isPerspective
                };
            })()
        `,
        returnByValue: true
    });

    const state = stateRes.result.value;
    if (!state || !state.hasView) {
        console.warn('Semantic Hologram view not open in Obsidian; skipping state assertions.');
        client.close();
        return;
    }

    await t.test('Rotation matrix determinant is +1 (up-row negation invariant)', () => {
        assert.strictEqual(state.det, 1.0, `Determinant should be +1, got ${state.det}`);
    });

    await t.test('Camera state azimuth and elevation are valid finite numbers', () => {
        assert.strictEqual(typeof state.azimuth, 'number');
        assert.strictEqual(typeof state.elevation, 'number');
        assert(Number.isFinite(state.azimuth));
        assert(Number.isFinite(state.elevation));
    });

    await t.test('setCameraState preserves determinism and updates angles', async () => {
        const testAzim = 45;
        const testElev = 20;
        const res = await client.send('Runtime.evaluate', {
            expression: `
                (() => {
                    const view = app.workspace.getLeavesOfType('semantic-hologram-view')[0]?.view;
                    if (!view) return false;
                    view.setCameraState({ azimuth: ${testAzim}, elevation: ${testElev}, distance: 1000 });
                    const m = view.rotM;
                    const det = m[0]*(m[4]*m[8] - m[5]*m[7]) - m[1]*(m[3]*m[8] - m[5]*m[6]) + m[2]*(m[3]*m[7] - m[4]*m[6]);
                    return {
                        azimuth: view.azimuth,
                        elevation: view.elevation,
                        det: Math.round(det * 1000) / 1000
                    };
                })()
            `,
            returnByValue: true
        });

        const updated = res.result.value;
        assert.strictEqual(updated.det, 1.0);
        assert.strictEqual(updated.azimuth, testAzim);
        assert.strictEqual(updated.elevation, testElev);
    });

    client.close();
});
