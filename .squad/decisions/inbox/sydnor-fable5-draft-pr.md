# Decision: Fable 5 Activation Draft PR Ready to Merge

**Date:** 2026-07-08  
**Author:** Sydnor  
**Status:** Draft PR open — awaiting Azure quota grant

**Draft PR:** https://github.com/x3nc0n/secops-squad-starter-kit/pull/4 (PR #4)

## Decision

A draft PR (`feat/foundry-fable5-activate`) has been opened to activate Claude Fable 5 as the primary Foundry model in `.secops/foundry.yaml`. The PR is complete and ready to merge; the only blocker is the pending Azure TPM quota grant for `AIServices.GlobalStandard.claude-fable-5`.

## Config Changes in the PR

| Field | Before | After |
|-------|--------|-------|
| `active_model` | `"o4-mini"` | `"claude-fable-5"` |
| `model_deployments[0]` | `o4-mini` (active) | `claude-fable-5` (active) |
| `model_deployments[1]` | `claude-fable-5` (pending_quota) | `o4-mini` (standby) |
| `claude-fable-5` status | `"pending_quota"` | `"active"` |
| `o4-mini` status | `"active"` | `"standby"` |

## Merge Checklist (Before Merging)

1. **Quota granted:** Confirm Azure TPM quota for `AIServices.GlobalStandard.claude-fable-5` (SC-OnlineLZ-00 / eastus2) has been approved.
2. **Deploy:** Run `scripts/deploy-foundry-fable5.ps1` (Windows) or `scripts/deploy-foundry-fable5.sh` (Linux/macOS) to deploy the `claude-fable-5` model to the Foundry resource. Confirm `provisioningState=Succeeded`.
3. **Smoke test:** Send a test inference request to the endpoint and confirm a valid response from Claude Fable 5.
4. **Mark ready:** Remove draft status from the PR, request review, and merge.

## Context

- Azure TPM quota for `claude-fable-5` was requested on 2026-07-08 (SC-OnlineLZ-00 / eastus2, resource `jospaid-1163-secops-squ-resource`, RG `secops-squad-alpha-fable-rg`).
- A prior deployment attempt on 2026-07-08 failed with `InsufficientQuota` (limit=0). This draft PR is pre-staged so the activation is a one-step merge once quota lands.
- Follows up merged PR #1 which shipped the Foundry scaffolding.
- `o4-mini` remains configured as standby fallback; agents can route to it if Fable 5 is unavailable.
