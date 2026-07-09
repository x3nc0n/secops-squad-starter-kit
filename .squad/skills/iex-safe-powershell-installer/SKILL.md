# Skill: iex-safe-powershell-installer

**Domain:** Platform Dev / Install Scripts  
**Author:** Tank  
**Last updated:** 2026-07-08

## Problem

A PowerShell install script distributed as `irm <url> | iex` will fail with `Unexpected attribute 'CmdletBinding'` if the file has:
1. A **UTF-8 BOM** (`EF BB BF`) — when `irm` downloads the raw text, the BOM survives as U+FEFF at character 0, pushing `[CmdletBinding()]` out of first-statement position inside `[scriptblock]::Create()`.
2. A **`#Requires` directive** — only legal at the top of a real script file, not inside an `iex` scriptblock.
3. A **top-level `[CmdletBinding()]`** — same restriction.
4. A **top-level `param()` block** — same restriction.

## Solution Pattern

### 1. Write without BOM

```powershell
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
```

**Never** use `Set-Content -Encoding utf8` or `Out-File -Encoding utf8` on Windows PowerShell 5.1 — both add the BOM.

### 2. Replace `#Requires -Version X` with a runtime guard

Place this after the comment-based help block (`<# ... #>`), before any executable code:

```powershell
if ($PSVersionTable.PSVersion.Major -lt 5) {
    Write-Error "This script requires PowerShell 5.1 or later."; return
}
```

### 3. Replace `[CmdletBinding()]` + `param()` with env-var-default

```powershell
$InstallDir = if ($env:MY_INSTALL_DIR) { $env:MY_INSTALL_DIR } else { "$env:USERPROFILE\my-tool" }
```

This works for both `irm | iex` **and** direct `.\install.ps1` invocation.  
Document in help: `$env:MY_INSTALL_DIR = "C:\alt\path"` before piping.

### 4. Comment-based help is safe

Leading `<# ... #>` blocks don't break `iex` — they're treated as comments.

## Verification Harness (deterministic, non-executing)

```powershell
$bytes = [System.IO.File]::ReadAllBytes("install.ps1")
$text  = [System.Text.Encoding]::UTF8.GetString($bytes)  # preserves BOM as U+FEFF, just like irm
[scriptblock]::Create($text)  # throws before fix, succeeds after fix
```

## Regression Test Pattern (node:test)

```js
import { readFileSync } from 'node:fs';
const bytes   = readFileSync('install.ps1');
const content = bytes.toString('utf8');

// No BOM
assert.equal(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF, false);
// No iex-breaking constructs
assert.doesNotMatch(content, /#Requires/im);
assert.doesNotMatch(content, /\[CmdletBinding\(\)\]/i);
const first30 = content.split('\n').slice(0, 30).join('\n');
assert.doesNotMatch(first30, /^\s*param\s*\(/im);
```

## References
- GitHub Issue #2: `irm ... /install.ps1 | iex` fails with "Unexpected attribute 'CmdletBinding'"
- `cli/install.test.js` — permanent regression guard
- Decision: `.squad/decisions/inbox/tank-install-iex-safety.md`
