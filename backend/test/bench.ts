// Latency benchmark against the test database (in-process, no network): npm run bench
import { setupTestApp } from './helpers.js';

const t = await setupTestApp();
await t.reset();
const { token, item } = await t.shop();
const c = await t.customer(token, 'Ramesh Yadav', '9812345321');
// a shop with a realistic amount of data
for (let k = 0; k < 300; k++) await t.customer(token, `Customer ${k}`);
await t.inject('POST', '/api/v1/items/bulk', token, { items: Array.from({ length: 300 }, (_, k) => ({ name: `Item ${k}`, unit: 'pc', price: 10 + k, stock: 100 })) });

const pct = (xs: number[], p: number) => xs.sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
async function measure(name: string, n: number, fn: (k: number) => Promise<{ statusCode: number }>, concurrency = 1) {
  const times: number[] = [];
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < n) {
      const k = next++;
      const t0 = performance.now();
      const r = await fn(k);
      times.push(performance.now() - t0);
      if (r.statusCode >= 300) failed++;
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`${name.padEnd(46)} n=${n} c=${concurrency}  p50=${pct(times, 50).toFixed(1)}ms  p95=${pct(times, 95).toFixed(1)}ms  p99=${pct(times, 99).toFixed(1)}ms  failed=${failed}`);
}

const say = (text: string) => t.inject('POST', '/api/v1/assistant/message', token, { text });
await measure('voice bill draft (assistant)', 200, () => say('Ramesh ko paanch kilo atta, ek kilo toor dal, do kilo cheeni udhaar mein likh do'));
await measure('balance question (assistant)', 200, () => say('Ramesh ka kitna baaki hai?'));
await measure('confirm bill (stock + khata + receipt)', 200, async () => {
  const d = (await t.inject('POST', '/api/v1/bills', token, { customerId: c.id, paymentMode: 'udhaar', lines: [{ itemId: item('Chawal 1 kg').id, quantity: 1 }] })).json().bill;
  return t.inject('POST', `/api/v1/bills/${d.id}/confirm`, token);
});
await measure('record payment', 200, (k) => t.inject('POST', `/api/v1/customers/${c.id}/payments`, token, { amount: 1 + (k % 5) }));
await measure('customer list (300 customers)', 200, () => t.inject('GET', '/api/v1/customers', token));
await measure('daily summary', 200, () => t.inject('GET', '/api/v1/summary/daily', token));
await measure('confirm bill, 10 at a time (one shop)', 200, async () => {
  const d = (await t.inject('POST', '/api/v1/bills', token, { customerId: c.id, paymentMode: 'udhaar', lines: [{ itemId: item('Namak').id, quantity: 1 }] })).json().bill;
  return t.inject('POST', `/api/v1/bills/${d.id}/confirm`, token);
}, 10);
await measure('voice bill draft, 20 at a time', 400, () => say('do kilo cheeni aur ek namak'), 20);
await t.close();
