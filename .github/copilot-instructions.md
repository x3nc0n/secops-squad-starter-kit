# Copilot Coding Agent — Squad Instructions

You are working on a project that uses **Squad**, an AI team framework. When picking up issues autonomously, follow these guidelines.

## Team Context

Before starting work on any issue:

1. Read `.squad/team.md` for the team roster, member roles, and your capability profile.
2. Read `.squad/routing.md` for work routing rules.
3. If the issue has a `squad:{member}` label, read that member's charter at `.squad/agents/{member}/charter.md` to understand their domain expertise and coding style — work in their voice.

## Capability Self-Check

Before starting work, check your capability profile in `.squad/team.md` under the **Coding Agent → Capabilities** section.

- **🟢 Good fit** — proceed autonomously.
- **🟡 Needs review** — proceed, but note in the PR description that a squad member should review.
- **🔴 Not suitable** — do NOT start work. Instead, comment on the issue:
  ```
  🤖 This issue doesn't match my capability profile (reason: {why}). Suggesting reassignment to a squad member.
  ```

## Branch Naming

Use the squad branch convention:
```
squad/{issue-number}-{kebab-case-slug}
```
Example: `squad/42-fix-login-validation`

## PR Guidelines

When opening a PR:
- Reference the issue: `Closes #{issue-number}`
- If the issue had a `squad:{member}` label, mention the member: `Working as {member} ({role})`
- If this is a 🟡 needs-review task, add to the PR description: `⚠️ This task was flagged as "needs review" — please have a squad member review before merging.`
- Follow any project conventions in `.squad/decisions.md`

## Foundry Model Integration (Optional)

If `.secops/foundry.yaml` exists and `foundry.enabled` is `true`, you have access to Claude Fable 5 via Azure AI Foundry for deep-analysis tasks.

**When to use Fable 5 (via Foundry):**
- SARIF report analysis with 50+ findings
- Multi-file vulnerability correlation across large codebases
- Complex threat modeling requiring extended reasoning
- Security architecture review of 10+ interconnected services

**When NOT to use Fable 5:**
- Simple KQL queries or single-finding triage
- Routine playbook generation
- Quick status checks or lookups
- Any task the standard model handles well

**How to invoke:** Read `.secops/foundry.yaml` for the endpoint. Use the Anthropic SDK with the endpoint URL and Azure API key. The deployment name is in `model_deployments[0].deployment_name`.

**Deprecation:** This section will be removed when Fable 5 is available directly in the GitHub Copilot model catalog.

---

## Decisions

If you make a decision that affects other team members, write it to:
```
.squad/decisions/inbox/copilot-{brief-slug}.md
```
The Scribe will merge it into the shared decisions file.
