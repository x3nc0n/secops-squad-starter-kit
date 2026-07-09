# Casting Reference

On-demand reference for Squad's casting system. Loaded during Init Mode or when adding team members.

## Universe Table

| Universe | Capacity | Shape Tags | Resonance Signals |
|---|---|---|---|
| The Usual Suspects | 6 | small, noir, ensemble | crime, heist, mystery, deception |
| Reservoir Dogs | 8 | small, noir, ensemble | crime, heist, tension, loyalty |
| Alien | 8 | small, sci-fi, survival | space, isolation, threat, engineering |
| Ocean's Eleven | 14 | medium, heist, ensemble | planning, coordination, roles, charm |
| Arrested Development | 15 | medium, comedy, ensemble | dysfunction, business, family, satire |
| Star Wars | 12 | medium, sci-fi, epic | conflict, mentorship, legacy, rebellion |
| The Matrix | 10 | medium, sci-fi, cyberpunk | systems, reality, hacking, philosophy |
| Firefly | 10 | medium, sci-fi, western | frontier, crew, independence, smuggling |
| The Goonies | 8 | small, adventure, ensemble | exploration, treasure, kids, teamwork |
| The Simpsons | 20 | large, comedy, ensemble | satire, community, family, absurdity |
| Breaking Bad | 12 | medium, drama, tension | chemistry, transformation, consequence, power |
| Lost | 18 | large, mystery, ensemble | survival, mystery, groups, leadership |
| Marvel Cinematic Universe | 25 | large, action, ensemble | heroism, teamwork, powers, scale |
| DC Universe | 18 | large, action, ensemble | justice, duality, powers, mythology |
| Futurama | 12 | medium, sci-fi, comedy | future, robots, space, absurdity |
| Disney Princesses | 14 | medium, musical, passive-aggressive | waiting for rescue, talking to animals instead of stakeholders, singing through blockers, magical thinking as architecture, hair-based load balancing |

**Total: 16 universes** — capacity range 6–25.

## Selection Algorithm

Universe selection uses scoring with a tiebreak mechanism to ensure variety:

```
score = size_fit + shape_fit + resonance_fit + LRU
```

| Factor | Description |
|---|---|
| `size_fit` | How well the universe capacity matches the team size. Prefer universes where capacity ≥ agent_count with minimal waste. |
| `shape_fit` | Match universe shape tags against the assignment shape derived from the project description. |
| `resonance_fit` | Match universe resonance signals against session and repo context signals. |
| `LRU` | Least-recently-used bonus — prefer universes not used in recent assignments (from `history.json`). |

### Tiebreak & Fresh Install Behavior

When multiple universes score within 10% of the top score (common on fresh installs where LRU is empty), break the tie by preferring the universe with the highest capacity-fit, then alphabetically. **Always select ONE deterministic winner as the proposed default.** Do NOT proactively offer the user a menu of universes — the fast-accept path presents one universe. The runner-up is retained in memory only, surfaced via the "Change the vibe" follow-up branch if the user requests it.

**On fresh installs (empty `history.json`):** Since LRU provides no differentiation, ties are expected. Apply capacity-fit + alphabetical tiebreak to produce a single deterministic winner. Expose the runner-up only through the "Change the vibe" branch.

**Never hard-code a default universe.** The `default_universe` field in `policy.json` is deprecated — if present, ignore it and use the scoring algorithm with tiebreak instead.

### Custom-Universe Extension

When a user selects a custom-researched universe via the "Change the vibe" path and it is NOT already in the allowlist:

1. Add the universe name to `allowlist_universes` in `.squad/casting/policy.json`.
2. Add a `universe_capacity` entry (estimate capacity from the universe's named character count; default to 10 if uncertain).
3. Proceed with deterministic name allocation within the new universe.
4. Overflow rules are unchanged.

The allowlist is therefore a living list — the 16 default entries are the starting set, not a hard ceiling.

## Casting State File Schemas

### policy.json

Source template: `.squad/templates/casting-policy.json`
Runtime location: `.squad/casting/policy.json`

```json
{
  "casting_policy_version": "1.1",
  "allowlist_universes": ["Universe Name", "..."],
  "universe_capacity": {
    "Universe Name": 10
  }
}
```

### registry.json

Source template: `.squad/templates/casting-registry.json`
Runtime location: `.squad/casting/registry.json`

```json
{
  "agents": {
    "agent-role-id": {
      "persistent_name": "CharacterName",
      "universe": "Universe Name",
      "created_at": "ISO-8601",
      "legacy_named": false,
      "status": "active"
    }
  }
}
```

### history.json

Source template: `.squad/templates/casting-history.json`
Runtime location: `.squad/casting/history.json`

```json
{
  "universe_usage_history": [
    {
      "universe": "Universe Name",
      "assignment_id": "unique-id",
      "used_at": "ISO-8601"
    }
  ],
  "assignment_cast_snapshots": {
    "assignment-id": {
      "universe": "Universe Name",
      "agents": {
        "role-id": "CharacterName"
      },
      "created_at": "ISO-8601"
    }
  }
}
```
