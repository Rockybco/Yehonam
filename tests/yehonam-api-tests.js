const assert = require('assert');
const Module = require('module');
const { PassThrough } = require('stream');
const path = require('path');

// Repo root — works regardless of where this file is run from.
const ROOT = path.resolve(__dirname, '..');

const products = [
  {
    id: 'prod_A1', name: 'Alpha Oil', description: 'Alpha', images: ['https://cdn.example.com/a.jpg'],
    active: true, created: 100, metadata: { category: 'haircare', featured: 'true', display_order: '2' },
    default_price: 'price_A1',
  },
  {
    id: 'prod_B1', name: 'Beta Bar', description: 'Beta', images: [], active: true, created: 200,
    metadata: { category: 'bodycare', featured: 'false', display_order: '1' },
    default_price: 'price_B_off',
  },
  {
    id: 'prod_C1', name: 'Gamma None', description: 'Gamma', images: [], active: true, created: 300,
    metadata: { category: 'bodycare', featured: 'true', display_order: '3' },
    default_price: null,
  },
  {
    id: 'prod_D1', name: 'Archived', description: 'Old', images: [], active: false, created: 50,
    metadata: { category: 'haircare' }, default_price: 'price_A1',
  },
];

const prices = [
  { id: 'price_A1', product: 'prod_A1', active: true, type: 'one_time', currency: 'usd', unit_amount: 2500, nickname: '100 ml', metadata: {}, recurring: null },
  { id: 'price_A2', product: 'prod_A1', active: true, type: 'one_time', currency: 'usd', unit_amount: 4500, nickname: '250 ml', metadata: {}, recurring: null },
  { id: 'price_B_off', product: 'prod_B1', active: false, type: 'one_time', currency: 'usd', unit_amount: 1200, nickname: '', metadata: {}, recurring: null },
  { id: 'price_B1', product: 'prod_B1', active: true, type: 'one_time', currency: 'usd', unit_amount: 1500, nickname: '', metadata: { size: 'Large' }, recurring: null },
  { id: 'price_B2', product: 'prod_B1', active: true, type: 'one_time', currency: 'usd', unit_amount: 1300, nickname: '', metadata: {}, recurring: null },
  { id: 'price_EUR', product: 'prod_A1', active: true, type: 'one_time', currency: 'eur', unit_amount: 2200, nickname: 'Euro', metadata: {}, recurring: null },
  { id: 'price_REC', product: 'prod_A1', active: true, type: 'recurring', currency: 'usd', unit_amount: 2200, nickname: 'Monthly', metadata: {}, recurring: { interval: 'month' } },
  { id: 'price_C1', product: 'prod_C1', active: false, type: 'one_time', currency: 'usd', unit_amount: 1000, nickname: '', metadata: {}, recurring: null },
];

const stripeMock = {
  capturedSession: null,
  paymentIntentUpdates: [],
  prices: {
    retrieve: async () => { throw new Error('not set'); },
    list: async () => ({ data: [], has_more: false }),
  },
  products: {
    retrieve: async () => { throw new Error('not set'); },
    list: async () => ({ data: [], has_more: false }),
  },
  checkout: {
    sessions: {
      create: async (params) => {
        stripeMock.capturedSession = params;
        return { id: 'cs_test_mock', url: 'https://checkout.example.test/cs_test_mock' };
      },
      retrieve: async () => { throw new Error('not set'); },
    },
  },
  paymentIntents: {
    update: async (id, params) => {
      stripeMock.paymentIntentUpdates.push({ id, params });
      return { id, ...params };
    },
  },
  webhooks: {
    constructEvent: (raw, signature, secret) => {
      assert.strictEqual(secret, 'whsec_test');
      if (signature !== 'valid-signature') throw new Error('Invalid signature');
      return JSON.parse(raw.toString());
    },
  },
};

const emailMock = {
  sent: [],
  failNext: false,
  createTransport: (options) => ({
    sendMail: async (mail) => {
      if (emailMock.failNext) {
        emailMock.failNext = false;
        throw new Error('SMTP relay down');
      }
      emailMock.sent.push({ ...mail });
      return { accepted: ['buyer@example.com'], response: '250 OK' };
    },
  }),
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'stripe') return () => stripeMock;
  if (request === 'nodemailer') return emailMock;
  return originalLoad.call(this, request, parent, isMain);
};

process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.SITE_URL = 'https://shop.example.test';

const handlers = {
  checkout: require(path.join(ROOT, 'api/create-checkout.js')),
  products: require(path.join(ROOT, 'api/get-products.js')),
  product: require(path.join(ROOT, 'api/get-product.js')),
  verify: require(path.join(ROOT, 'api/verify-order.js')),
  webhook: require(path.join(ROOT, 'api/webhook.js')),
};

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; },
    end() { return this; },
  };
}

function reqBody(method, body, query = {}) {
  return { method, body, query, headers: {} };
}

async function call(handler, req) {
  const res = makeRes();
  await handler(req, res);
  return { status: res.statusCode, body: res.body, headers: res.headers };
}

function paginate(data, params, pageSize = 2) {
  const start = params.starting_after
    ? data.findIndex((item) => item.id === params.starting_after) + 1
    : 0;
  const page = data.slice(start, start + pageSize);
  return { data: page, has_more: start + pageSize < data.length };
}

function priceForCheckout(id, overrides = {}) {
  const base = prices.find((price) => price.id === id) || {
    id, product: 'prod_A1', active: true, type: 'one_time', currency: 'usd',
    unit_amount: 1000, nickname: '', metadata: {}, recurring: null,
  };
  return { ...base, ...overrides, product: { id: 'prod_A1', active: true, deleted: false } };
}

async function main() {
  const results = [];
  const test = async (name, fn) => {
    try {
      await fn();
      results.push(`PASS ${name}`);
    } catch (error) {
      results.push(`FAIL ${name}: ${error.message}`);
      process.exitCode = 1;
    }
  };

  await test('create-checkout rejects invalid quantity', async () => {
    stripeMock.prices.retrieve = async (id) => priceForCheckout(id);
    const out = await call(handlers.checkout, reqBody('POST', { items: [{ priceId: 'price_A1', quantity: 0 }] }));
    assert.strictEqual(out.status, 400);
  });

  await test('create-checkout rejects more than 10 per line', async () => {
    stripeMock.prices.retrieve = async (id) => priceForCheckout(id);
    const out = await call(handlers.checkout, reqBody('POST', { items: [{ priceId: 'price_A1', quantity: 11 }] }));
    assert.strictEqual(out.status, 400);
  });

  await test('create-checkout rejects duplicate lines exceeding limit', async () => {
    stripeMock.prices.retrieve = async (id) => priceForCheckout(id);
    const out = await call(handlers.checkout, reqBody('POST', {
      items: [{ priceId: 'price_A1', quantity: 6 }, { priceId: 'price_A1', quantity: 6 }],
    }));
    assert.strictEqual(out.status, 400);
  });

  await test('create-checkout rejects inactive price', async () => {
    stripeMock.prices.retrieve = async (id) => priceForCheckout(id, { active: false });
    const out = await call(handlers.checkout, reqBody('POST', { items: [{ priceId: 'price_A1', quantity: 1 }] }));
    assert.strictEqual(out.status, 400);
  });

  await test('create-checkout rejects recurring price', async () => {
    stripeMock.prices.retrieve = async (id) => priceForCheckout(id, { type: 'recurring', recurring: { interval: 'month' } });
    const out = await call(handlers.checkout, reqBody('POST', { items: [{ priceId: 'price_A1', quantity: 1 }] }));
    assert.strictEqual(out.status, 400);
  });

  await test('create-checkout rejects non-USD price', async () => {
    stripeMock.prices.retrieve = async (id) => priceForCheckout(id, { currency: 'eur' });
    const out = await call(handlers.checkout, reqBody('POST', { items: [{ priceId: 'price_EUR', quantity: 1 }] }));
    assert.strictEqual(out.status, 400);
  });

  await test('create-checkout rejects inactive product', async () => {
    stripeMock.prices.retrieve = async (id) => ({ ...priceForCheckout(id), product: { id: 'prod_A1', active: false } });
    const out = await call(handlers.checkout, reqBody('POST', { items: [{ priceId: 'price_A1', quantity: 1 }] }));
    assert.strictEqual(out.status, 400);
  });

  await test('create-checkout accepts valid items and ignores client URLs', async () => {
    stripeMock.prices.retrieve = async (id) => priceForCheckout(id);
    const out = await call(handlers.checkout, reqBody('POST', {
      items: [{ priceId: 'price_A1', quantity: 2 }, { priceId: 'price_A2', quantity: 1 }],
      success_url: 'https://evil.example/steal',
      cancel_url: 'https://evil.example/cancel',
    }));
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.body.url, 'https://checkout.example.test/cs_test_mock');
    assert.strictEqual(stripeMock.capturedSession.success_url, 'https://shop.example.test/confirmation.html?session_id={CHECKOUT_SESSION_ID}');
    assert.strictEqual(stripeMock.capturedSession.cancel_url, 'https://shop.example.test/cart.html');
    assert.strictEqual(stripeMock.capturedSession.line_items.length, 2);
    assert.strictEqual(stripeMock.capturedSession.metadata.total_quantity, '3');
  });

  await test('create-checkout collects the shipping address without shipping options', async () => {
    stripeMock.prices.retrieve = async (id) => priceForCheckout(id);
    const out = await call(handlers.checkout, reqBody('POST', { items: [{ priceId: 'price_A1', quantity: 1 }] }));
    assert.strictEqual(out.status, 200);
    assert.strictEqual('shipping_options' in stripeMock.capturedSession, false);
    assert.strictEqual(stripeMock.capturedSession.shipping_options, undefined);
    assert.ok(stripeMock.capturedSession.shipping_address_collection);
    const allowed = stripeMock.capturedSession.shipping_address_collection.allowed_countries;
    assert.ok(Array.isArray(allowed));
    assert.ok(allowed.includes('US'));
  });

  await test('create-checkout rejects missing configuration', async () => {
    const key = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    const out = await call(handlers.checkout, reqBody('POST', { items: [{ priceId: 'price_A1', quantity: 1 }] }));
    process.env.STRIPE_SECRET_KEY = key;
    assert.strictEqual(out.status, 503);
  });

  await test('get-products paginates and skips unpurchasable products', async () => {
    stripeMock.products.list = async (params) => paginate(products, params);
    stripeMock.prices.list = async (params) => paginate(prices, params);
    const out = await call(handlers.products, reqBody('GET', null, {}));
    assert.strictEqual(out.status, 200);
    assert.deepStrictEqual(out.body.products.map((p) => p.id), ['prod_B1', 'prod_A1']);
    const beta = out.body.products.find((p) => p.id === 'prod_B1');
    assert.strictEqual(beta.priceId, 'price_B2');
    assert.strictEqual(beta.price, 1300);
    assert.strictEqual(beta.priceIsFrom, true);
    assert.strictEqual(beta.variants.length, 2);
    assert.deepStrictEqual(beta.variants.map((v) => v.priceId), ['price_B2', 'price_B1']);
    assert.strictEqual(beta.variants[1].label, 'Large');
  });

  await test('get-products applies category and featured filters', async () => {
    stripeMock.products.list = async (params) => paginate(products, params);
    stripeMock.prices.list = async (params) => paginate(prices, params);
    const category = await call(handlers.products, reqBody('GET', null, { category: 'haircare' }));
    assert.deepStrictEqual(category.body.products.map((p) => p.id), ['prod_A1']);
    const featured = await call(handlers.products, reqBody('GET', null, { featured: 'true' }));
    assert.deepStrictEqual(featured.body.products.map((p) => p.id), ['prod_A1']);
  });

  await test('get-products respects limit', async () => {
    stripeMock.products.list = async (params) => paginate(products, params);
    stripeMock.prices.list = async (params) => paginate(prices, params);
    const out = await call(handlers.products, reqBody('GET', null, { limit: '1' }));
    assert.strictEqual(out.body.products.length, 1);
  });

  await test('get-product returns real variant price IDs', async () => {
    stripeMock.products.retrieve = async () => products[0];
    stripeMock.prices.list = async (params) => paginate(prices.filter((p) => p.product === params.product), params);
    const out = await call(handlers.product, reqBody('GET', null, { id: 'prod_A1' }));
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.body.priceId, 'price_A1');
    assert.deepStrictEqual(out.body.variants.map((v) => v.priceId), ['price_A1', 'price_A2']);
    assert.strictEqual(out.body.available, true);
  });

  await test('get-product 404s an inactive product', async () => {
    stripeMock.products.retrieve = async () => ({ ...products[0], active: false });
    const out = await call(handlers.product, reqBody('GET', null, { id: 'prod_A1' }));
    assert.strictEqual(out.status, 404);
  });

  await test('get-product 400s an invalid id', async () => {
    const out = await call(handlers.product, reqBody('GET', null, { id: '../secret' }));
    assert.strictEqual(out.status, 400);
  });

  await test('get-product reports a product with no usable price as unavailable', async () => {
    stripeMock.products.retrieve = async () => products[2];
    stripeMock.prices.list = async () => ({ data: [], has_more: false });
    const out = await call(handlers.product, reqBody('GET', null, { id: 'prod_C1' }));
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.body.available, false);
    assert.strictEqual(out.body.priceId, null);
  });

  const session = (overrides) => ({
    id: 'cs_test_paid1234',
    payment_status: 'paid',
    status: 'complete',
    payment_intent: { status: 'succeeded' },
    customer_details: { name: 'Buyer Example', email: 'buyer@example.com' },
    amount_subtotal: 2500,
    amount_total: 2500,
    currency: 'usd',
    total_details: { amount_discount: 0, amount_tax: 0, amount_shipping: 0 },
    line_items: { data: [{ description: 'Alpha Oil', quantity: 1, amount_total: 2500, currency: 'usd' }] },
    ...overrides,
  });

  // A Checkout Session object as returned by the webhook's session retrieve
  // (with expanded line_items and payment_intent).
  const webhookSession = (overrides) => ({
    id: 'cs_test_1',
    payment_status: 'paid',
    amount_subtotal: 2200,
    amount_total: 1900,
    currency: 'usd',
    customer_details: { name: 'Ada Lovelace', email: 'emailwh@example.com' },
    total_details: { amount_discount: 500, amount_tax: 200, amount_shipping: 0 },
    line_items: { data: [{ description: 'Alpha Oil', quantity: 1, amount_total: 1900, currency: 'usd' }] },
    payment_intent: { id: 'pi_test_emailwh1', status: 'succeeded', metadata: {} },
    ...overrides,
  });

  await test('verify-order returns verified only for paid sessions', async () => {
    stripeMock.checkout.sessions.retrieve = async () => session();
    const paid = await call(handlers.verify, reqBody('GET', null, { session_id: 'cs_test_paid1234' }));
    assert.strictEqual(paid.body.verified, true);
    assert.strictEqual(paid.body.payment_status, 'paid');
    assert.strictEqual(paid.body.email, 'buyer@example.com');
    assert.strictEqual(paid.body.amount_total, 2500);

    stripeMock.checkout.sessions.retrieve = async () => session({ payment_status: 'unpaid', status: 'open', payment_intent: { status: 'requires_payment_method' } });
    const unpaid = await call(handlers.verify, reqBody('GET', null, { session_id: 'cs_test_pending1234' }));
    assert.strictEqual(unpaid.body.verified, false);
  });

  await test('verify-order returns receipt fields for paid sessions', async () => {
    const receiptSession = session({
      id: 'cs_test_receiptfields',
      customer_details: { name: 'Receipt Person', email: 'receipt@example.com' },
      amount_subtotal: 2200,
      amount_total: 1900,
      total_details: { amount_discount: 500, amount_tax: 200, amount_shipping: 0 },
      shipping_details: {
        name: 'Receipt Person',
        address: { line1: '123 Main St', city: 'Denver', state: 'CO', postal_code: '80202', country: 'US' },
      },
      created: 1700000000,
    });
    stripeMock.checkout.sessions.retrieve = async () => receiptSession;
    const out = await call(handlers.verify, reqBody('GET', null, { session_id: 'cs_test_receiptfields' }));
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.body.customer_name, 'Receipt Person');
    assert.strictEqual(out.body.order_date, new Date(1700000000 * 1000).toISOString());
    assert.strictEqual(out.body.amount_subtotal, 2200);
    assert.strictEqual(out.body.discount_amount, 500);
    assert.strictEqual(out.body.tax_amount, 200);
    assert.deepStrictEqual(out.body.address, ['Receipt Person', '123 Main St', 'Denver', 'CO', '80202', 'US']);
  });

  await test('verify-order flags a failed payment intent', async () => {
    stripeMock.checkout.sessions.retrieve = async () => session({
      payment_status: 'unpaid',
      payment_intent: { status: 'requires_payment_method', last_payment_error: { code: 'card_declined' } },
    });
    const out = await call(handlers.verify, reqBody('GET', null, { session_id: 'cs_test_failed1234' }));
    assert.strictEqual(out.body.verified, false);
    assert.strictEqual(out.body.payment_failed, true);
  });

  await test('verify-order treats no_payment_required as not verified', async () => {
    stripeMock.checkout.sessions.retrieve = async () => session({ payment_status: 'no_payment_required' });
    const out = await call(handlers.verify, reqBody('GET', null, { session_id: 'cs_test_nopay1234' }));
    assert.strictEqual(out.body.verified, false);
    assert.strictEqual(out.body.payment_status, 'no_payment_required');
  });

  await test('verify-order validates the session id', async () => {
    const out = await call(handlers.verify, reqBody('GET', null, { session_id: 'nonsense' }));
    assert.strictEqual(out.status, 400);
  });

  await test('verify-order maps a missing session to 404', async () => {
    const error = new Error('No such checkout session');
    error.code = 'resource_missing';
    stripeMock.checkout.sessions.retrieve = async () => { throw error; };
    const out = await call(handlers.verify, reqBody('GET', null, { session_id: 'cs_test_missing1234' }));
    assert.strictEqual(out.status, 404);
  });

  function streamReq(raw, method = 'POST', signature = 'valid-signature') {
    const req = new PassThrough();
    req.method = method;
    req.headers = signature ? { 'stripe-signature': signature } : {};
    req.query = {};
    req.end(raw);
    return req;
  }

  await test('webhook rejects a missing signature', async () => {
    const out = await call(handlers.webhook, streamReq('{}', 'POST', ''));
    assert.strictEqual(out.status, 400);
  });

  await test('webhook rejects an invalid signature', async () => {
    const out = await call(handlers.webhook, streamReq('{}', 'POST', 'wrong'));
    assert.strictEqual(out.status, 400);
  });

  await test('webhook accepts a signed event', async () => {
    stripeMock.checkout.sessions.retrieve = async () => webhookSession({ id: 'cs_test_1', payment_status: 'paid' });
    const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', payment_status: 'paid', amount_total: 2500, currency: 'usd' } } });
    const out = await call(handlers.webhook, streamReq(raw));
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.body.received, true);
  });

  await test('webhook accepts the three supported event types', async () => {
    for (const type of ['payment_intent.payment_failed', 'charge.refunded']) {
      const raw = JSON.stringify({ type, data: { object: { id: 'x', amount: 1, currency: 'usd', amount_refunded: 1, last_payment_error: null } } });
      const out = await call(handlers.webhook, streamReq(raw));
      assert.strictEqual(out.status, 200);
    }
  });

  await test('webhook rejects GET', async () => {
    const out = await call(handlers.webhook, streamReq('', 'GET'));
    assert.strictEqual(out.status, 405);
  });

  // ---- WEBHOOK ORDER CONFIRMATION EMAIL (lib/email.js + api/webhook.js, mocked SMTP) ----

  const smtpFixture = {
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    SMTP_USER: 'user@example.test',
    SMTP_PASS: 'test-smtp-password',
    EMAIL_FROM: 'orders@yehonam.com',
    EMAIL_FROM_NAME: 'Yehonam Suds',
  };
  const savedSmtpEnv = {};
  Object.keys(smtpFixture).forEach((key) => { savedSmtpEnv[key] = process.env[key]; process.env[key] = smtpFixture[key]; });

  const emailLib = require(path.join(ROOT, 'lib/email.js'));

  function markerUpdatesFor(paymentIntentId) {
    return stripeMock.paymentIntentUpdates.filter(
      (u) => u.id === paymentIntentId &&
        u.params &&
        u.params.metadata &&
        u.params.metadata.yehonam_order_email_status === 'sent'
    );
  }

  await test('webhook sends an order confirmation email for a paid Checkout Session', async () => {
    emailMock.sent.length = 0;
    stripeMock.paymentIntentUpdates.length = 0;
    const paidSession = webhookSession({ id: 'cs_test_emailwh1', payment_status: 'paid' });
    stripeMock.checkout.sessions.retrieve = async () => paidSession;
    const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_emailwh1', payment_status: 'paid' } } });
    const out = await call(handlers.webhook, streamReq(raw));
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.body.received, true);
    const mail = emailMock.sent.find((m) => m.to === 'emailwh@example.com');
    assert.ok(mail, 'an email is sent to the customer email from the session');
    assert.ok(String(mail.subject).startsWith('Order confirmed: #'), 'subject starts with "Order confirmed: #"');
    assert.ok(mail.text.includes('Ada Lovelace'), 'text includes the customer name');
    assert.ok(mail.text.includes('YOUR ORDER IS CONFIRMED!'), 'text includes the receipt heading');
    assert.ok(mail.text.includes('Alpha Oil'), 'text includes the purchased product');
    assert.ok(mail.text.includes('Subtotal: $22.00'), 'text includes the subtotal');
    assert.ok(mail.text.includes('Discount: -$5.00'), 'text includes the discount when applicable');
    assert.ok(mail.text.includes('Tax: +$2.00'), 'text includes the tax when charged');
    assert.ok(mail.text.includes('Total paid: $19.00'), 'text includes the total paid');
    assert.strictEqual(markerUpdatesFor(paidSession.payment_intent.id).length, 1, 'the PaymentIntent sent marker is persisted');
  });

  await test('webhook does not send emails for unpaid or no-payment sessions', async () => {
    emailMock.sent.length = 0;
    for (const status of ['unpaid', 'no_payment_required']) {
      const s = webhookSession({ id: `cs_test_emailwh_${status}`, payment_status: status, payment_intent: null });
      stripeMock.checkout.sessions.retrieve = async () => s;
      const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: `cs_test_emailwh_${status}`, payment_status: status } } });
      const out = await call(handlers.webhook, streamReq(raw));
      assert.strictEqual(out.status, 200);
    }
    assert.strictEqual(emailMock.sent.length, 0, 'no email is sent for non-paid sessions');
  });

  await test('webhook sends an order confirmation email on async_payment_succeeded for a paid session', async () => {
    emailMock.sent.length = 0;
    stripeMock.paymentIntentUpdates.length = 0;
    const asyncSession = webhookSession({ id: 'cs_test_emailasync1', payment_status: 'paid' });
    stripeMock.checkout.sessions.retrieve = async () => asyncSession;
    const raw = JSON.stringify({ type: 'checkout.session.async_payment_succeeded', data: { object: { id: 'cs_test_emailasync1', payment_status: 'paid' } } });
    const out = await call(handlers.webhook, streamReq(raw));
    assert.strictEqual(out.status, 200);
    const mail = emailMock.sent.find((m) => m.to === 'emailwh@example.com');
    assert.ok(mail, 'an email is sent on async_payment_succeeded for a paid session');
    assert.ok(String(mail.subject).startsWith('Order confirmed: #'), 'subject starts with "Order confirmed: #"');
    assert.ok(mail.text.includes('Ada Lovelace'), 'text includes the customer name');
    assert.ok(mail.text.includes('Alpha Oil'), 'text includes the purchased product');
    assert.ok(mail.text.includes('Total paid: $19.00'), 'text includes the total paid');
    assert.strictEqual(markerUpdatesFor(asyncSession.payment_intent.id).length, 1, 'the PaymentIntent sent marker is persisted');
  });

  await test('webhook does not send emails for async_payment_succeeded when the session is not paid', async () => {
    emailMock.sent.length = 0;
    const unpaidAsyncSession = webhookSession({ id: 'cs_test_emailasync2', payment_status: 'unpaid', payment_intent: null });
    stripeMock.checkout.sessions.retrieve = async () => unpaidAsyncSession;
    const raw = JSON.stringify({ type: 'checkout.session.async_payment_succeeded', data: { object: { id: 'cs_test_emailasync2', payment_status: 'unpaid' } } });
    const out = await call(handlers.webhook, streamReq(raw));
    assert.strictEqual(out.status, 200);
    assert.strictEqual(emailMock.sent.length, 0, 'no email is sent when the session is not paid');
  });

  await test('webhook acknowledges an already-sent PaymentIntent without resending', async () => {
    emailMock.sent.length = 0;
    const sentSession = webhookSession({
      id: 'cs_test_emailwh_sent',
      payment_intent: { id: 'pi_test_emailwh_sent', status: 'succeeded', metadata: { yehonam_order_email_status: 'sent' } },
    });
    stripeMock.checkout.sessions.retrieve = async () => sentSession;
    const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_emailwh_sent', payment_status: 'paid' } } });
    const out = await call(handlers.webhook, streamReq(raw));
    assert.strictEqual(out.status, 200);
    assert.strictEqual(emailMock.sent.length, 0);
  });

  await test('webhook returns a retryable non-2xx when SMTP fails and does not mark the PaymentIntent', async () => {
    emailMock.sent.length = 0;
    emailMock.failNext = true;
    const failSession = webhookSession({
      id: 'cs_test_emailwh_smtp',
      payment_intent: { id: 'pi_test_emailwh_smtp', status: 'succeeded', metadata: {} },
    });
    stripeMock.checkout.sessions.retrieve = async () => failSession;
    const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_emailwh_smtp', payment_status: 'paid' } } });
    const out = await call(handlers.webhook, streamReq(raw));
    assert.strictEqual(out.status, 500, 'non-2xx so Stripe retries the webhook');
    assert.strictEqual(emailMock.sent.length, 0);
    assert.strictEqual(markerUpdatesFor('pi_test_emailwh_smtp').length, 0, 'no sent marker is persisted on SMTP failure');
    // The payment itself is unchanged — verify-order still reports paid.
    const verified = await call(handlers.verify, reqBody('GET', null, { session_id: 'cs_test_emailwh_smtp' }));
    assert.strictEqual(verified.status, 200);
    assert.strictEqual(verified.body.verified, true);
  });

  await test('sendOrderConfirmationEmail dedupes on PaymentIntent metadata', async () => {
    emailMock.sent.length = 0;
    stripeMock.paymentIntentUpdates.length = 0;
    const dedupeSession = {
      ...session(),
      id: 'cs_test_emaildedupe1234',
      payment_intent: { id: 'pi_test_emaildedupe', status: 'succeeded', metadata: {} },
    };
    const first = await emailLib.sendOrderConfirmationEmail(dedupeSession, stripeMock);
    const second = await emailLib.sendOrderConfirmationEmail(dedupeSession, stripeMock);
    assert.strictEqual(first.sent, true);
    assert.strictEqual(second.sent, false);
    assert.strictEqual(second.reason, 'already-sent');
    assert.strictEqual(emailMock.sent.length, 1, 'only one email is recorded');
    assert.strictEqual(markerUpdatesFor('pi_test_emaildedupe').length, 1, 'sent marker is persisted on the PaymentIntent');
  });

  await test('sendOrderConfirmationEmail in-flight guard prevents concurrent duplicates', async () => {
    emailMock.sent.length = 0;
    let releaseSend;
    const gate = new Promise((resolve) => { releaseSend = resolve; });
    const originalCreateTransport = emailMock.createTransport;
    emailMock.createTransport = () => ({
      sendMail: async (mail) => {
        await gate;
        emailMock.sent.push({ ...mail });
        return { accepted: ['buyer@example.com'], response: '250 OK' };
      },
    });
    const inflightSession = {
      ...session(),
      id: 'cs_test_emailinflight1',
      payment_intent: { id: 'pi_test_emailinflight', status: 'succeeded', metadata: {} },
    };
    try {
      const first = emailLib.sendOrderConfirmationEmail(inflightSession, stripeMock);
      const second = await emailLib.sendOrderConfirmationEmail(inflightSession, stripeMock);
      assert.strictEqual(second.sent, false);
      assert.strictEqual(second.reason, 'in-flight');
      releaseSend();
      const firstResult = await first;
      assert.strictEqual(firstResult.sent, true);
      assert.strictEqual(emailMock.sent.length, 1);
    } finally {
      emailMock.createTransport = originalCreateTransport;
      releaseSend();
    }
  });

  await test('sendOrderConfirmationEmail is a no-op when SMTP is not configured', async () => {
    const saved = {};
    ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM'].forEach((key) => { saved[key] = process.env[key]; delete process.env[key]; });
    try {
      const result = await emailLib.sendOrderConfirmationEmail(
        session({ id: 'cs_test_emailnoconf1234', customer_details: { email: 'emailnoconf@example.com' } }),
        stripeMock
      );
      assert.strictEqual(result.sent, false);
      assert.strictEqual(result.reason, 'not-configured');
    } finally {
      ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM'].forEach((key) => {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      });
    }
  });

  await test('verify-order never sends order confirmation emails (sending moved to the webhook)', async () => {
    emailMock.sent.length = 0;
    stripeMock.checkout.sessions.retrieve = async () =>
      session({ id: 'cs_test_emailverify1', customer_details: { email: 'emailverify@example.com' } });
    const out = await call(handlers.verify, reqBody('GET', null, { session_id: 'cs_test_emailverify1' }));
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.body.verified, true);
    assert.strictEqual(emailMock.sent.length, 0);
  });

  await test('verify-order still reports paid when SMTP is unavailable', async () => {
    emailMock.failNext = true;
    stripeMock.checkout.sessions.retrieve = async () =>
      session({ id: 'cs_test_emailverifyfail1', customer_details: { email: 'emailverifyfail@example.com' } });
    const out = await call(handlers.verify, reqBody('GET', null, { session_id: 'cs_test_emailverifyfail1' }));
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.body.verified, true);
  });

  Object.keys(smtpFixture).forEach((key) => {
    if (savedSmtpEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedSmtpEnv[key];
  });

  console.log(results.join('\n'));
  const failed = results.filter((line) => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
