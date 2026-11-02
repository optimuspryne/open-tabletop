import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { deflateSync, gzipSync } from 'node:zlib';
import express from 'express';
import nodemailer from 'nodemailer';
import qs from 'qs';
import { createRecoveryMailer, recoveryMailConfig } from '../server/recovery-mail.js';

test('query string serialization handles hostile own toString values without throwing', () => {
  for (const toString of ['blocked', null, 42]) {
    assert.doesNotThrow(() => qs.stringify({ a: [{ toString }] }, { arrayFormat: 'comma' }));
  }
  assert.equal(qs.stringify({ a: ['one', 'two'] }, { arrayFormat: 'comma' }), 'a=one%2Ctwo');
});

test('mail address parsing keeps quoted text and nested comments out of recipients', async () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  for (const [to, expected] of [
    ['Victim (x(y) <unexpected@example.test>) <victim@example.test>', 'victim@example.test'],
    ['G: (a; <unexpected@example.test>) <victim@example.test>;', 'victim@example.test'],
    ['<"a@unexpected.test>"@expected.test>', '@expected.test'],
  ]) {
    const result = await transport.sendMail({ from: 'table@example.test', to, text: 'test' });
    assert.equal(result.envelope.to.length, 1);
    if (expected.startsWith('@')) assert.ok(result.envelope.to[0].endsWith(expected));
    else assert.deepEqual(result.envelope.to, [expected]);
  }
});

test('recovery mail uses the real mail transport with one recipient and fragment links', async () => {
  const sent = [];
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const mailer = createRecoveryMailer({
    config: recoveryMailConfig({
      SMTP_HOST: 'smtp.example.test',
      SMTP_FROM: 'table@example.test',
      PUBLIC_ORIGIN: 'https://table.example.test',
    }),
    createTransport: () => ({
      sendMail: async (message) => sent.push(await transport.sendMail(message)),
    }),
  });
  for (const purpose of ['verify', 'recover']) {
    await mailer.send({ email: 'player@example.test', purpose, token: 'test/token' });
    const result = sent.at(-1);
    assert.deepEqual(result.envelope.to, ['player@example.test']);
    const message = JSON.parse(result.message);
    assert.ok(message.text.includes(`https://table.example.test/#${purpose}=test%2Ftoken`));
    assert.equal(message.html, undefined);
  }
});

test('HTTP JSON parsing accepts compressed bodies and survives corrupt compressed input', async (t) => {
  const app = express();
  app.use(express.json());
  app.post('/', (req, res) => res.json(req.body));
  app.use((error, req, res, _next) =>
    res.status(error.status || 500).json({ error: 'invalid body' }),
  );
  const server = createServer(app);
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/`;
  for (const [encoding, compress] of [
    ['gzip', gzipSync],
    ['deflate', deflateSync],
  ]) {
    const headers = { 'content-type': 'application/json', 'content-encoding': encoding };
    const corrupt = await fetch(url, { method: 'POST', headers, body: Buffer.from('invalid') });
    assert.equal(corrupt.status, 400);
    await corrupt.json();
    const healthy = await fetch(url, {
      method: 'POST',
      headers,
      body: compress(Buffer.from('{"healthy":true}')),
    });
    assert.equal(healthy.status, 200);
    assert.deepEqual(await healthy.json(), { healthy: true });
  }
});
