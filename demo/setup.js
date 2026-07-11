'use strict';
// Builds demo/shop-api: a small fake e-commerce service with realistic git
// history on main, plus a feature branch that changes the architecture in
// interesting ways (new module, forbidden dependency, new cycle, deleted module).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, 'shop-api');

function git(args, env) {
  execFileSync('git', ['-C', REPO, ...args], {
    stdio: 'pipe',
    env: { ...process.env, ...env },
  });
}

function write(rel, content) {
  const abs = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function rm(rel) {
  fs.rmSync(path.join(REPO, rel), { recursive: true, force: true });
}

let clock = new Date('2026-01-05T10:00:00');
function commit(msg) {
  clock = new Date(clock.getTime() + 12 * 24 * 3600 * 1000); // ~12 days apart
  const date = clock.toISOString();
  git(['add', '-A']);
  git(
    ['-c', 'user.name=Demo Dev', '-c', 'user.email=dev@shop.example', 'commit', '-m', msg],
    { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
  );
}

// ---- reset ----
fs.rmSync(REPO, { recursive: true, force: true });
fs.mkdirSync(REPO, { recursive: true });
git(['init', '-b', 'main']);

// ---- commit 1: initial skeleton ----
write('archrules.json', JSON.stringify({
  forbid: [
    { from: 'payments', to: 'ui', reason: 'payment logic must stay UI-free' },
    { from: 'orders', to: 'ui', reason: 'domain code must not depend on UI' },
    { from: '*', to: 'legacy', reason: 'legacy SOAP bridge is frozen — no new callers' },
  ],
}, null, 2) + '\n');

write('src/api/server.ts', `import { listProducts } from '../catalog/service';
import { placeOrder } from '../orders/service';
import { legacyInventorySync } from '../legacy/soap';

export function startServer() {
  legacyInventorySync();
  return { routes: { listProducts, placeOrder } };
}
`);
write('src/api/routes.ts', `import { startServer } from './server';

export const app = startServer();
`);
write('src/catalog/service.ts', `import { findAll } from './repo';

export function listProducts() {
  return findAll();
}
`);
write('src/catalog/repo.ts', `export function findAll() {
  return [{ id: 1, name: 'Keyboard', price: 49 }];
}
`);
write('src/orders/service.ts', `import { listProducts } from '../catalog/service';
import { saveOrder } from './repo';

export function placeOrder(productId: number) {
  const product = listProducts().find((p) => p.id === productId);
  return saveOrder({ product });
}
`);
write('src/orders/repo.ts', `export function saveOrder(order: unknown) {
  return { id: Date.now(), order };
}
`);
write('src/ui/app.ts', `import { startServer } from '../api/server';

export const ui = { server: startServer() };
`);
write('src/ui/toast.ts', `export function toast(message: string) {
  console.log('[toast]', message);
}
`);
write('src/legacy/soap.ts', `export function legacyInventorySync() {
  /* ancient SOAP call nobody dares to touch */
}
`);
commit('feat: initial service — api, catalog, orders, ui, legacy SOAP bridge');

// ---- commit 2: payments ----
write('src/payments/gateway.ts', `export function charge(amount: number) {
  return { ok: true, amount };
}
`);
write('src/orders/service.ts', `import { listProducts } from '../catalog/service';
import { charge } from '../payments/gateway';
import { saveOrder } from './repo';

export function placeOrder(productId: number) {
  const product = listProducts().find((p) => p.id === productId);
  charge(product ? product.price : 0);
  return saveOrder({ product });
}
`);
commit('feat: charge cards through a payment gateway');

// ---- commit 3: notification emails ----
write('src/notifications/email.ts', `export function sendEmail(to: string, subject: string) {
  return { queued: true, to, subject };
}
`);
write('src/orders/service.ts', `import { listProducts } from '../catalog/service';
import { sendEmail } from '../notifications/email';
import { charge } from '../payments/gateway';
import { saveOrder } from './repo';

export function placeOrder(productId: number) {
  const product = listProducts().find((p) => p.id === productId);
  charge(product ? product.price : 0);
  const order = saveOrder({ product });
  sendEmail('customer@example.com', 'Order confirmed');
  return order;
}

export function getOrderStatus(orderId: number) {
  return { orderId, status: 'confirmed' };
}
`);
commit('feat: order confirmation emails');

// ---- commit 4: catalog search (internal change — architecture untouched) ----
write('src/catalog/search.ts', `import { findAll } from './repo';

export function search(q: string) {
  return findAll().filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
}
`);
commit('feat: catalog text search');

// ---- commit 5: product reviews ----
write('src/reviews/service.ts', `import { findAll } from '../catalog/repo';

export function reviewsFor(productId: number) {
  const exists = findAll().some((p) => p.id === productId);
  return exists ? [{ stars: 5, text: 'Great!' }] : [];
}
`);
write('src/api/server.ts', `import { listProducts } from '../catalog/service';
import { placeOrder } from '../orders/service';
import { legacyInventorySync } from '../legacy/soap';
import { reviewsFor } from '../reviews/service';

export function startServer() {
  legacyInventorySync();
  return { routes: { listProducts, placeOrder, reviewsFor } };
}
`);
commit('feat: product reviews');

// ---- feature branch: the "PR" ----
git(['checkout', '-b', 'feature/analytics-refunds']);

write('src/analytics/tracker.ts', `export function track(event: string, data?: unknown) {
  console.log('[analytics]', event, data);
}
`);
write('src/orders/service.ts', `import { track } from '../analytics/tracker';
import { listProducts } from '../catalog/service';
import { sendEmail } from '../notifications/email';
import { charge } from '../payments/gateway';
import { saveOrder } from './repo';

export function placeOrder(productId: number) {
  const product = listProducts().find((p) => p.id === productId);
  charge(product ? product.price : 0);
  const order = saveOrder({ product });
  sendEmail('customer@example.com', 'Order confirmed');
  track('order_placed', { productId });
  return order;
}

export function getOrderStatus(orderId: number) {
  return { orderId, status: 'confirmed' };
}
`);
// Oops #1: a domain module reaching into the UI layer (forbidden by archrules.json)
write('src/payments/refund.ts', `import { toast } from '../ui/toast';
import { charge } from './gateway';

export function refund(orderId: number, amount: number) {
  const result = charge(-amount);
  toast('Refund issued for order ' + orderId);
  return result;
}
`);
// Oops #2: notifications now calls back into orders -> dependency cycle
write('src/notifications/email.ts', `import { getOrderStatus } from '../orders/service';

export function sendEmail(to: string, subject: string) {
  return { queued: true, to, subject };
}

export function sendOrderUpdate(orderId: number) {
  const status = getOrderStatus(orderId);
  return sendEmail('customer@example.com', 'Order ' + status.status);
}
`);
// Cleanup: legacy SOAP bridge finally retired
rm('src/legacy');
write('src/api/server.ts', `import { listProducts } from '../catalog/service';
import { placeOrder } from '../orders/service';
import { reviewsFor } from '../reviews/service';

export function startServer() {
  return { routes: { listProducts, placeOrder, reviewsFor } };
}
`);
commit('feat: refunds + analytics, retire legacy SOAP bridge');

git(['checkout', 'main']);
console.log('✅ demo repo ready at demo/shop-api');
console.log('   main                       — 5 commits of history');
console.log('   feature/analytics-refunds  — the "PR" that changes the architecture');
