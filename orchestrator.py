"""
NewKey Orchestrator — Injects critical rules into every Claude API call.

PURPOSE:
Claude Code reads CLAUDE.md once at session start, but in long sessions the rules
drift out of context. This orchestrator ensures your non-negotiable rules are
injected into EVERY API call as a system prompt — they can never be forgotten.

USAGE:
    from orchestrator import call_claude, call_subagent

    # General purpose call with rules always injected
    response = call_claude("Scrape Toll Brothers Elm Collection and ingest")

    # Call a specific builder subagent
    response = call_subagent("toll", "Check for new listings in Elm Collection")

SETUP:
    pip install anthropic
    Set env var: ANTHROPIC_API_KEY=your-key
"""

import os
import json
from anthropic import Anthropic

client = Anthropic()  # reads ANTHROPIC_API_KEY from env

# ──────────────────────────────────────────────────────────────────────
# CRITICAL RULES — Injected into every API call as system prompt.
# Edit these when your rules change. They override everything.
# ──────────────────────────────────────────────────────────────────────

CRITICAL_RULES = """
## ⛔ MANDATORY RULES — NEVER VIOLATE

1. ADDRESS FORMAT: Street number + street name ONLY. No suffix (St, Rd, Dr, Ave, Ln, Way, Cir, Ct, Pl, Ter, Trl, Pkwy, Loop, Run, Path, Pass, Alley, Blvd). No city. Title case.
   ✅ "108 Palisades"  ❌ "108 Palisades Lane"  ❌ "108 Palisades, Irvine"

2. COMMUNITY NAME: ALWAYS use exact name from Google Sheet Table 1 Column A. Never the raw API/website name.
   ✅ "Elm Collection"  ❌ "Toll Brothers at Great Park Neighborhoods - Elm Collection"

3. LISTING ID (lotNumber): communityName.replace(/\\s+/g,"") + String(rawLot).
   Example: "Isla at Luna Park" + lot 42 → "IslaatLunaPark42"
   Placeholder lots (sold-N, avail-N, future-N) keep raw format — NO prefix.

4. MISSING FIELDS: When ANY field is blank (beds, baths, sqft, floors, type, HOA, tax, schools) → ALWAYS fallback to Google Sheet Table 3. Hardcode into COMMUNITIES config. Never fetch from builder API. ALL 10 builders.

5. LISTING STATUS: ONLY the 1 AM scraper changes status based on builder map observation. NEVER change status from Table 2. Table 2 = display counts only.

6. NEW COMMUNITIES: MANUAL ONLY. Never auto-create. Scraper uses strict:true — rejects unknown communities.

7. SCRAPERS READ ONLY FROM GOOGLE SHEET: No hardcoded URLs. No auto-discovery. No following links. Only Table 1 URLs.

8. LOT COUNTS: Community card numbers ALWAYS from Google Sheet Table 2. Never builder API.

9. DUPLICATE DETECTION: Always cross-community. Normalize addresses. Keep listing with more data. Run after every ghost merge/backfill/ingest.

10. GHOST COMMUNITIES: If found, move listings to correct community and delete the ghost immediately.

11. NO DEV SERVER: Never run npm run dev or preview_start unless explicitly asked.

12. INGEST IS INSTANT: POST to /api/ingest is live immediately. 1 AM scrapers are for detection only.
""".strip()


# ──────────────────────────────────────────────────────────────────────
# SUBAGENT CONFIGS — One per builder, with builder-specific context
# ──────────────────────────────────────────────────────────────────────

SUBAGENTS = {
    "toll": {
        "name": "Toll Brothers Specialist",
        "extra_rules": "Never use notReleasedLots API field — it's inflated.",
        "sheet_tab": "Toll Communities",
        "agent_dir": "Toll Specialist",
    },
    "lennar": {
        "name": "Lennar Agent",
        "extra_rules": "",
        "sheet_tab": "Lennar Communities",
        "agent_dir": "Lennar Agent",
    },
    "taylor": {
        "name": "Taylor Morrison Agent",
        "extra_rules": "",
        "sheet_tab": "Taylor Communities",
        "agent_dir": "Taylor Morrison Agent",
    },
    "pulte": {
        "name": "Pulte Agent",
        "extra_rules": "",
        "sheet_tab": "Pulte Communities",
        "agent_dir": "Pulte Agent",
    },
    "delwebb": {
        "name": "Del Webb Agent",
        "extra_rules": "",
        "sheet_tab": "Del Webb Communities",
        "agent_dir": "Pulte Agent",  # shares with Pulte
    },
    "shea": {
        "name": "Shea Agent",
        "extra_rules": "",
        "sheet_tab": "Shea Communities",
        "agent_dir": None,
    },
    "kb": {
        "name": "KB Home Agent",
        "extra_rules": "",
        "sheet_tab": "KB Home Communities",
        "agent_dir": None,
    },
    "brookfield": {
        "name": "Brookfield Agent",
        "extra_rules": "",
        "sheet_tab": "Brookfield Communities",
        "agent_dir": None,
    },
    "tripointe": {
        "name": "TriPointe Agent",
        "extra_rules": "",
        "sheet_tab": "TriPointe Communities",
        "agent_dir": None,
    },
    "melia": {
        "name": "Melia Agent",
        "extra_rules": "",
        "sheet_tab": "Melia Communities",
        "agent_dir": None,
    },
}

# ──────────────────────────────────────────────────────────────────────
# PROJECT CONTEXT — Injected so the model knows the stack
# ──────────────────────────────────────────────────────────────────────

PROJECT_CONTEXT = """
## Project: NewKey
- Stack: Next.js 16 + Prisma + Supabase
- Live: https://www.newkey.us
- Local: C:\\New Key\\
- DB schema: Builder → Community → Listing → PriceHistory
- Listing unique key: [communityId, address]
- Status values: active, sold, future, removed
- Ingest endpoint: POST https://www.newkey.us/api/ingest (Header: x-ingest-secret: xxSaog6apBaSMEFOb7OE9gPPgszA8zz_wpW8nR-1Og0)
- Google Sheet: https://docs.google.com/spreadsheets/d/1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c
- Fetch tab CSV: https://docs.google.com/spreadsheets/d/1CVHJ5Fimh4bknzuPjdiPDsxgCnkiuaGsTw0p2yvvE5c/gviz/tq?tqx=out:csv&sheet=TAB_NAME
""".strip()


# ──────────────────────────────────────────────────────────────────────
# CORE FUNCTIONS
# ──────────────────────────────────────────────────────────────────────

def build_system_prompt(extra_rules: str = "") -> str:
    """Build the full system prompt with critical rules always included."""
    parts = [CRITICAL_RULES, PROJECT_CONTEXT]
    if extra_rules:
        parts.append(f"## Builder-Specific Rules\n{extra_rules}")
    # Add a reinforcement at the end (recency bias helps)
    parts.append(
        "## REMINDER: Re-read the MANDATORY RULES above before taking any action. "
        "Especially: address format (no suffixes), community names (Sheet Table 1 only), "
        "listing IDs (composite key), and never auto-create communities."
    )
    return "\n\n".join(parts)


def call_claude(
    user_message: str,
    model: str = "claude-sonnet-4-20250514",
    max_tokens: int = 4096,
    extra_system: str = "",
    conversation_history: list = None,
) -> str:
    """
    Call Claude with critical rules always injected.

    Args:
        user_message: The task/prompt to send.
        model: Which Claude model to use.
        max_tokens: Max response tokens.
        extra_system: Additional system prompt text for this call.
        conversation_history: Optional list of prior messages for multi-turn.

    Returns:
        Claude's response text.
    """
    system_prompt = build_system_prompt(extra_system)

    messages = []
    if conversation_history:
        messages.extend(conversation_history)
    messages.append({"role": "user", "content": user_message})

    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system_prompt,
        messages=messages,
    )

    return response.content[0].text


def call_subagent(
    builder_key: str,
    task: str,
    model: str = "claude-sonnet-4-20250514",
    max_tokens: int = 4096,
    conversation_history: list = None,
) -> str:
    """
    Call a builder-specific subagent with its rules injected.

    Args:
        builder_key: One of: toll, lennar, taylor, pulte, delwebb, shea, kb, brookfield, tripointe, melia
        task: The task to perform.

    Returns:
        Claude's response text.
    """
    if builder_key not in SUBAGENTS:
        raise ValueError(
            f"Unknown builder '{builder_key}'. "
            f"Valid keys: {', '.join(SUBAGENTS.keys())}"
        )

    agent = SUBAGENTS[builder_key]
    extra = f"You are the {agent['name']}.\n"
    extra += f"Google Sheet tab: {agent['sheet_tab']}\n"
    if agent["agent_dir"]:
        extra += f"Agent directory: C:\\New Key\\{agent['agent_dir']}\\\n"
    if agent["extra_rules"]:
        extra += f"\n{agent['extra_rules']}"

    return call_claude(
        user_message=task,
        model=model,
        max_tokens=max_tokens,
        extra_system=extra,
        conversation_history=conversation_history,
    )


# ──────────────────────────────────────────────────────────────────────
# ORCHESTRATOR — Run multiple subagents in sequence
# ──────────────────────────────────────────────────────────────────────

def run_orchestrated_task(task_plan: list[dict]) -> list[dict]:
    """
    Run a multi-step plan across subagents.

    Args:
        task_plan: List of steps, each a dict with:
            - builder: builder key (or "main" for general)
            - task: the prompt/task string
            - depends_on: (optional) index of a prior step whose output to include

    Returns:
        List of dicts with step index, builder, task, and response.

    Example:
        results = run_orchestrated_task([
            {"builder": "toll", "task": "Scrape Elm Collection and return JSON of new listings"},
            {"builder": "main", "task": "Take these listings and POST to /api/ingest", "depends_on": 0},
        ])
    """
    results = []

    for i, step in enumerate(task_plan):
        builder = step["builder"]
        task = step["task"]

        # If this step depends on a prior step's output, prepend it
        if "depends_on" in step and step["depends_on"] is not None:
            dep_idx = step["depends_on"]
            prior_output = results[dep_idx]["response"]
            task = f"Previous step output:\n{prior_output}\n\n---\n\nYour task:\n{task}"

        if builder == "main":
            response = call_claude(task)
        else:
            response = call_subagent(builder, task)

        results.append({
            "step": i,
            "builder": builder,
            "task": step["task"],
            "response": response,
        })

        print(f"✅ Step {i} ({builder}): done")

    return results


# ──────────────────────────────────────────────────────────────────────
# CLI — Run from command line
# ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage:")
        print("  python orchestrator.py 'your task here'")
        print("  python orchestrator.py --agent toll 'scrape Elm Collection'")
        sys.exit(1)

    if sys.argv[1] == "--agent" and len(sys.argv) >= 4:
        builder = sys.argv[2]
        task = " ".join(sys.argv[3:])
        print(f"🔧 Calling {builder} subagent...")
        result = call_subagent(builder, task)
    else:
        task = " ".join(sys.argv[1:])
        print("🔧 Calling Claude with critical rules injected...")
        result = call_claude(task)

    print("\n" + "=" * 60)
    print(result)
