import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSecretScanGate } = require('./secret-scan.js');

describe('createSecretScanGate', () => {
  const cases = [
    { name: 'AWS access key', value: 'AKIA1234567890ABCDEF' },
    { name: 'private key', value: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----' },
    { name: 'JWT', value: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjYXJ2ZXItc2VjcmV0In0.signaturepart12345' },
    { name: 'bearer token', value: 'Bearer abcdefghijklmnopqrstuvwxyz1234567890' },
    {
      name: 'connection string',
      value: 'DefaultEndpointsProtocol=https;AccountName=secopsacct;AccountKey=abcdefghijklmnopqrstuvwxyzABCDE1234567890+/=;EndpointSuffix=core.windows.net',
    },
  ];

  for (const { name, value } of cases) {
    it(`blocks ${name} and redacts the matched value`, () => {
      const warnings = [];
      const gate = createSecretScanGate({ logger: { warn: (msg) => warnings.push(msg) } });
      const result = gate.run({ payload: { prompt: `please analyze ${value}` } });

      assert.equal(result.ok, false);
      assert.match(result.reason, /secret-scan detected/);
      assert.equal(result.reason.includes(value), false, 'returned reason must not contain the secret value');
      assert.equal(warnings.join('\n').includes(value), false, 'logs must not contain the secret value');
    });
  }

  it('allows a clean payload', () => {
    const gate = createSecretScanGate({ logger: { warn: () => assert.fail('clean payload must not warn') } });
    const result = gate.run({ payload: { messages: [{ role: 'user', content: 'summarize this benign finding' }] } });
    assert.deepEqual(result, { ok: true });
  });

  it('fails closed if scanning throws and does not leak the payload secret', () => {
    const secret = 'Bearer scanthrowsecretvalue1234567890';
    const warnings = [];
    const gate = createSecretScanGate({
      rules: [
        {
          id: 'throwing-rule',
          get pattern() {
            throw new Error(`scanner exploded near ${secret}`);
          },
        },
      ],
      logger: { warn: (msg) => warnings.push(msg) },
    });

    const result = gate.run({ payload: { token: secret } });
    assert.equal(result.ok, false);
    assert.match(result.reason, /failed closed/i);
    assert.equal(result.reason.includes(secret), false, 'scan error reason must not leak secret values');
    assert.equal(warnings.join('\n').includes(secret), false, 'scan error logs must not leak secret values');
  });
});
