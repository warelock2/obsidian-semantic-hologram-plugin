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
                        reject(new Error('No Obsidian page target found with webSocketDebuggerUrl'));
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

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function main() {
    const wsUrl = await getWebSocketUrl();
    const client = new CDPClient(wsUrl);
    await client.connect();
    await client.send('Runtime.enable');

    // Get hologram view canvas bounding client rect and window dimensions
    const evalRes = await client.send('Runtime.evaluate', {
        expression: `
            (() => {
                const view = app.workspace.getLeavesOfType('semantic-hologram-view')[0]?.view;
                const rect = view?.canvas?.getBoundingClientRect();
                return {
                    hasView: !!view,
                    rect: rect ? {
                        left: Math.round(rect.left),
                        top: Math.round(rect.top),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height)
                    } : null,
                    winW: window.innerWidth,
                    winH: window.innerHeight
                };
            })()
        `,
        returnByValue: true
    });

    const info = evalRes.result.value;
    console.log('Canvas Rect in Obsidian Window:', info.rect);

    const left = info.rect ? info.rect.left + 5 : 50;
    const top = info.rect ? info.rect.top + 5 : 50;
    const width = info.rect ? info.rect.width - 10 : 200;
    const height = info.rect ? info.rect.height - 10 : 200;

    let currentX = Math.round(left + width / 2);
    let currentY = Math.round(top + height / 2);

    // Initial position dispatch
    await client.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: currentX,
        y: currentY
    });
    await sleep(60);

    let allMatched = true;

    console.log('\n================ STARTING 10-ITERATION LIVE MOUSE MOVEMENT TEST ================');

    for (let iter = 1; iter <= 10; iter++) {
        const targetX = Math.round(left + Math.random() * width);
        const targetY = Math.round(top + Math.random() * height);

        console.log(`\n--- Iteration ${iter}/10 ---`);
        console.log(`Current: (${currentX}, ${currentY}) -> Selected Target: (${targetX}, ${targetY})`);

        const steps = 5;
        const dx = (targetX - currentX) / steps;
        const dy = (targetY - currentY) / steps;

        for (let s = 1; s <= steps; s++) {
            const predX = Math.round(currentX + dx * s);
            const predY = Math.round(currentY + dy * s);

            // Real input dispatched to Obsidian Chromium window
            await client.send('Input.dispatchMouseEvent', {
                type: 'mouseMoved',
                x: predX,
                y: predY
            });
            await sleep(35);

            // Sample actual state from live plugin view
            const sampleRes = await client.send('Runtime.evaluate', {
                expression: `
                    (() => {
                        const view = app.workspace.getLeavesOfType('semantic-hologram-view')[0]?.view;
                        return {
                            pointerX: view?.pointerX,
                            pointerY: view?.pointerY,
                            pointerInside: view?.pointerInside
                        };
                    })()
                `,
                returnByValue: true
            });

            const sampled = sampleRes.result.value;
            const diffX = sampled.pointerX !== null ? Math.abs(sampled.pointerX - predX) : null;
            const diffY = sampled.pointerY !== null ? Math.abs(sampled.pointerY - predY) : null;
            const matched = (diffX === 0 || diffX === 1) && (diffY === 0 || diffY === 1); // accounts for rounding

            if (!matched) {
                allMatched = false;
            }

            console.log(
                `  Step ${s}/${steps} | ` +
                `Predicted: (${predX}, ${predY}) | ` +
                `Actual Sampled: (${sampled.pointerX}, ${sampled.pointerY}) | ` +
                `Match: ${matched ? '✓ EXACT' : '✗ MISMATCH'} (diff: dx=${diffX}, dy=${diffY})`
            );
        }

        currentX = targetX;
        currentY = targetY;
        await sleep(50);
    }

    console.log('\n================ TEST SUMMARY ================');
    console.log(`All 10 iterations & 50 individual steps verified: ${allMatched ? 'ALL MATCHED PERFECTLY ✓' : 'SOME DISCREPANCIES DETECTED ✗'}`);
    
    client.close();
}

main().catch(err => {
    console.error('Test execution failed:', err);
    process.exit(1);
});
