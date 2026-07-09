// Regression guard for irm|iex safety — see GitHub issue #2.
// Ensures install.ps1 is forever BOM-free and free of iex-breaking constructs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

describe('install.ps1 irm|iex safety', () => {
  const psBytes   = readFileSync(resolve(root, 'install.ps1'));
  const psContent = psBytes.toString('utf8');

  it('has no UTF-8 BOM (first 3 bytes must not be EF BB BF)', () => {
    const hasBom = psBytes[0] === 0xEF && psBytes[1] === 0xBB && psBytes[2] === 0xBF;
    assert.equal(hasBom, false, 'install.ps1 must be saved without a UTF-8 BOM');
  });

  it('contains no #Requires directive', () => {
    assert.doesNotMatch(
      psContent,
      /#Requires/im,
      'install.ps1 must not contain #Requires — it breaks iex scriptblock parsing'
    );
  });

  it('contains no [CmdletBinding()] attribute', () => {
    assert.doesNotMatch(
      psContent,
      /\[CmdletBinding\(\)\]/i,
      'install.ps1 must not contain [CmdletBinding()] — it breaks iex scriptblock parsing'
    );
  });

  it('contains no top-level param() block', () => {
    // Match lines that start with optional whitespace then "param(" in first 30 lines.
    const firstThirtyLines = psContent.split('\n').slice(0, 30).join('\n');
    assert.doesNotMatch(
      firstThirtyLines,
      /^\s*param\s*\(/im,
      'install.ps1 must not have a top-level param() block — it breaks iex scriptblock parsing'
    );
  });
});

describe('install.sh shebang guard', () => {
  const shBytes = readFileSync(resolve(root, 'install.sh'));

  it('starts with #! shebang (0x23 0x21) and has no BOM', () => {
    assert.equal(shBytes[0], 0x23, 'install.sh first byte must be 0x23 (#)');
    assert.equal(shBytes[1], 0x21, 'install.sh second byte must be 0x21 (!)');
    const hasBom = shBytes[0] === 0xEF && shBytes[1] === 0xBB && shBytes[2] === 0xBF;
    assert.equal(hasBom, false, 'install.sh must not have a UTF-8 BOM');
  });
});
