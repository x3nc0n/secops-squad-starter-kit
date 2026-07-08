# Work Routing

How to decide who handles what. This is the **starter-kit dev team** routing.

## Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| Identity & migration | Keymaker | Okta/Ping/Entra APIs, SAML/OIDC config, users/groups, conditional access, MCP/skill design for IdPs, migration mappings |
| CLI / framework / MCP | Tank | `secops-squad` CLI, install/update engine, MCP server scaffolding, manifest/classifyPath, framework tooling |
| Architecture & scope | Morpheus | Scope calls, design specs, trade-offs, what to build next, cross-agent coordination |
| Code review | Morpheus | Review PRs, approve/reject, enforce standards |
| Testing / QA | Seraph | Write tests, find edge cases, verify fixes, reviewer gate |
| Session logging | Scribe | Automatic — never needs routing |
| Work monitoring | Ralph | Backlog/PR/CI queue, keep-alive |

## Issue Routing

| Label | Action | Who |
|-------|--------|-----|
| `squad` | Triage: analyze issue, assign `squad:{member}` label | Morpheus (Lead) |
| `squad:{name}` | Pick up issue and complete the work | Named member |

### How Issue Assignment Works

1. When a GitHub issue gets the `squad` label, **Morpheus** triages it — analyzing content, assigning the right `squad:{member}` label, and commenting with triage notes.
2. When a `squad:{member}` label is applied, that member picks up the issue in their next session.
3. Members can reassign by removing their label and adding another member's label.
4. The `squad` label is the "inbox" — untriaged issues waiting for Lead review.

## Rules

1. **Eager by default** — spawn all agents who could usefully start work, including anticipatory downstream work.
2. **Scribe always runs** after substantial work, always as `mode: "background"`. Never blocks.
3. **Quick facts → coordinator answers directly.** Don't spawn an agent for trivia.
4. **When two agents could handle it**, pick the one whose domain is the primary concern.
5. **"Team, ..." → fan-out.** Spawn all relevant agents in parallel as `mode: "background"`.
6. **Anticipate downstream work.** If a feature is being built, spawn Seraph to write test cases from requirements simultaneously.
7. **Reviewer gate:** Seraph/Morpheus may reject; rejected work goes to a *different* agent per the lockout rule.
8. **Issue-labeled work** — route `squad:{member}` to that member; Morpheus handles all `squad` triage.
