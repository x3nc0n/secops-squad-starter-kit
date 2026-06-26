# Sydnor — Foundry F-002 secret-scan fail-closed redaction

## Change

Fail-closed behavior is preserved: scan exceptions still return `ok:false` and block egress.

## Reason string

Before:
```js
`secret-scan failed closed: ${message}`
```

After:
```js
'secret-scan failed closed (<redacted>)'
```

## Log string

Before catch-path call:
```js
warn(logger, 'scan-error')
```

Before emitted log:
```text
[foundry/secret-scan] blocked outbound payload: rule=scan-error indicator=<redacted:scan-error>
```

After catch-path call:
```js
warn(logger, `scan-error:${errorTypeOf(err)}`)
```

After emitted log for the Carver repro `Error`:
```text
[foundry/secret-scan] blocked outbound payload: rule=scan-error:Error indicator=<redacted:scan-error:Error>
```

Only the exception type/name is logged. The raw exception message/text is never interpolated into the returned reason or log output.

## Validation

- `node --test lib\foundry\gates\secret-scan.test.js`: tests 7, suites 1, pass 7, fail 0, cancelled 0, skipped 0, todo 0, duration_ms 95.7075
- `node --test "lib\foundry\**\*.test.js"`: tests 96, suites 22, pass 96, fail 0, cancelled 0, skipped 0, todo 0, duration_ms 461.1062
- `npm test`: tests 322, suites 59, pass 322, fail 0, cancelled 0, skipped 0, todo 0, duration_ms 461.753
