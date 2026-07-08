---
title: Okta Groups and Rules
category: okta
author: Kima
version: 1.0.0
last_updated: 2026-07-08
---

# Okta Groups and Rules

## Overview

Okta groups control application access, policy targeting, and user segmentation. Understanding group types and dynamic rules is essential for migration — Entra's group model is similar in concept but differs in important ways, particularly around group provenance and dynamic rule syntax.

## Group Types

Okta surfaces three group types in the API, identifiable via the `type` field:

### OKTA_GROUP

Groups created and owned within Okta. These are the standard groups that teams create manually or via provisioning connectors. Membership can be static (manually managed) or dynamic (controlled by a group rule).

```json
{
  "id": "00g1a2b3c4d5e6f7g8h9",
  "objectClass": ["okta:user_group"],
  "type": "OKTA_GROUP",
  "profile": {
    "name": "Engineering - Backend",
    "description": "Backend engineering team"
  }
}
```

OKTA_GROUP groups are the primary migration target — these map most cleanly to Entra security groups.

### APP_GROUP

Groups imported (pushed) from connected applications — most commonly from on-premises Active Directory via the Okta AD agent, or from HR systems via HR-driven provisioning. These groups originate outside Okta.

```json
{
  "type": "APP_GROUP",
  "profile": {
    "name": "CN=corp-vpn-users,OU=Groups,DC=acme,DC=com",
    "dn": "CN=corp-vpn-users,OU=Groups,DC=acme,DC=com",
    "samAccountName": "corp-vpn-users"
  }
}
```

**Migration consideration:** If the organization already uses Entra Connect (formerly AAD Connect) to sync on-prem AD groups into Entra, these APP_GROUP groups may already exist in Entra. Do not double-create them. Reconcile by `samAccountName` or `dn`.

**If there is no on-prem AD** (pure Okta mastered groups from an HR integration), these must be recreated as OKTA_GROUP equivalents or re-driven from the HR source directly into Entra.

### BUILT_IN

System groups built into every Okta org. The most important one:

- **Everyone** — all users in the org. Cannot be modified. Frequently used as the base for broad app assignments and default policies.

```json
{
  "type": "BUILT_IN",
  "profile": {
    "name": "Everyone",
    "description": "All users in your organization"
  }
}
```

**No direct Entra equivalent for "Everyone."** Entra expresses this in Conditional Access as `includeUsers: "All"` and in app assignments as assigning to all users. For dynamic groups, you'd need a rule like `(user.objectId -ne "")` — but this is awkward and not recommended. In Entra, "all users" is a first-class concept in CA policies, not a group.

## Group API Operations

```bash
# List all groups
GET /api/v1/groups?limit=200

# Filter to only OKTA_GROUP type
GET /api/v1/groups?filter=type eq "OKTA_GROUP"&limit=200

# Get group membership
GET /api/v1/groups/{groupId}/users?limit=200

# Get apps assigned to a group
GET /api/v1/groups/{groupId}/apps
```

## Group Rules (Dynamic Membership)

Okta group rules provide dynamic membership for OKTA_GROUP groups. A rule evaluates a condition expression against user profile attributes and automatically adds/removes users from the target group.

**Rule object structure:**

```json
{
  "id": "0pr1a2b3c4d5e6f7g8h9",
  "type": "group_rule",
  "status": "ACTIVE",
  "name": "Auto-assign Backend Engineers",
  "conditions": {
    "expression": {
      "value": "user.department == \"Engineering\" AND user.title =~ \".*[Bb]ackend.*\"",
      "type": "urn:okta:expression:1.0"
    }
  },
  "actions": {
    "assignUserToGroups": {
      "groupIds": ["00g1a2b3..."]
    }
  }
}
```

### Okta Expression Language for Rules

Okta rules use an expression language with the following common operators:

| Operator | Example | Meaning |
|---|---|---|
| `==` | `user.department == "Finance"` | Exact match |
| `!=` | `user.status != "SUSPENDED"` | Not equal |
| `=~` | `user.title =~ ".*[Ee]ngineer.*"` | Regex match |
| `AND` | `user.department == "Eng" AND user.city == "Austin"` | Logical AND |
| `OR` | `user.department == "HR" OR user.department == "Legal"` | Logical OR |
| `NOT` | `NOT user.department == "Alumni"` | Negation |
| `String.startsWith()` | `String.startsWith(user.email, "svc-")` | Function |
| `Arrays.contains()` | Okta OIE only | Array membership |

**Fetch all rules:**

```bash
GET /api/v1/groups/rules?limit=200
```

## Mapping to Entra ID Dynamic Groups

Entra ID supports dynamic user groups via membership rules (MembershipRule property on the group object). The concept is the same — evaluate user attributes to determine group membership — but the syntax is different.

### Syntax Translation Examples

| Okta Rule Expression | Entra Dynamic Rule | Notes |
|---|---|---|
| `user.department == "Finance"` | `(user.department -eq "Finance")` | Clean 1:1 |
| `user.department != "Alumni"` | `(user.department -ne "Alumni")` | Clean 1:1 |
| `user.city == "Austin" AND user.department == "Eng"` | `(user.city -eq "Austin") -and (user.department -eq "Eng")` | AND logic |
| `user.city == "Austin" OR user.city == "Dallas"` | `(user.city -eq "Austin") -or (user.city -eq "Dallas")` | OR logic |
| `user.title =~ ".*[Mm]anager.*"` | `(user.jobTitle -contains "Manager")` | **Gotcha:** Entra does not support regex in dynamic rules. Use `-contains`, `-startsWith`, or `-endsWith` instead. |
| `user.userType == "CONTRACTOR"` | `(user.userType -eq "Contractor")` | Case may differ — normalize at migration time |
| `user.login =~ "svc-.*"` | `(user.userPrincipalName -startsWith "svc-")` | Attribute name change: `login` → `userPrincipalName` |

### What Does Not Translate

- **Regex rules** — Okta supports full regex in `=~`; Entra dynamic rules do NOT support regex. Approximate with `-contains`, `-startsWith`, or `-endsWith`. For complex regex patterns, you may need to redesign the rule or use a scheduled logic app to maintain membership.

- **Compound conditions on the same attribute** — Okta allows `user.title =~ ".*Eng.*" AND user.title =~ ".*Senior.*"`. Entra allows `-and` but without regex, this may require `-contains` on a single value or two separate dynamic groups combined with a policy.

- **`Arrays.contains()` on multi-value attributes** — Okta supports array attributes in some profile configurations; Entra dynamic group rules have limited support for multi-value attribute matching.

- **Rules targeting APP_GROUP or BUILT_IN groups** — Okta rules can only target OKTA_GROUP. This constraint also applies to Entra dynamic groups (cannot create a built-in equivalent dynamically).

- **Cross-attribute expressions using functions** — Okta supports `String.startsWith()`, `String.contains()`, etc. Entra dynamic rules have a fixed operator set; not all Okta functions have a direct equivalent.

### Creating Entra Dynamic Groups via Graph API

```powershell
# Entra: Create dynamic security group equivalent
Connect-MgGraph -Scopes "Group.ReadWrite.All"

New-MgGroup -BodyParameter @{
    displayName = "dyn-Engineering-Backend"
    description = "Dynamic: Backend engineers (migrated from Okta rule)"
    mailEnabled = $false
    securityEnabled = $true
    mailNickname = "dyn-engineering-backend"
    groupTypes = @("DynamicMembership")
    membershipRule = '(user.department -eq "Engineering") -and (user.jobTitle -contains "Backend")'
    membershipRuleProcessingState = "On"
}
```

### Microsoft 365 Groups vs Security Groups

Okta only has a single group concept. In Entra, you must choose:
- **Security Group** — for access control, CA policy targeting, app assignment (recommended for Okta migration)
- **Microsoft 365 Group** — has mailbox and Teams workspace; not appropriate for pure access-control scenarios

During migration, recreate all OKTA_GROUP groups as Entra **Security Groups** unless a specific use case requires M365 Group features.

## Group-App Assignments

In Okta, groups are assigned to apps. This drives who can access the application.

```bash
# Get all apps assigned to a group
GET /api/v1/groups/{groupId}/apps

# Get all groups assigned to an app
GET /api/v1/apps/{appId}/groups
```

**Entra equivalent:** App assignments to groups in Enterprise Applications:

```powershell
# Assign group to enterprise app in Entra
New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $spId -BodyParameter @{
    principalId = $groupId
    resourceId = $spId
    appRoleId = $appRoleId  # Use "00000000-0000-0000-0000-000000000000" for default access
}
```

**Migration sequencing:** Recreate groups before app assignments. Group IDs in Okta do not carry over — you must map old Okta group IDs to new Entra group object IDs before setting up assignments.

## Nested Groups

Okta does NOT support nested groups within Okta's own directory. Group hierarchy is flat. If the customer expects nested group behavior migrated to Entra, this must be designed from scratch — it's not a migration of existing Okta structure.

**Entra** does support nested security groups (groups as members of other groups). This is a capability that Okta lacks. Post-migration, security architects can introduce nesting, but it has no Okta antecedent to migrate from.

## Related Skills

- **[users-and-profiles.md](users-and-profiles.md)** — Profile attributes used in group rules
- **[applications-saml-oidc.md](applications-saml-oidc.md)** — App-group assignment model
- **[policies-and-authenticators.md](policies-and-authenticators.md)** — Policy targeting by group
- **[okta-to-entra-migration-map.md](okta-to-entra-migration-map.md)** — Consolidated mapping with gotchas
