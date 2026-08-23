"""Privacy helpers for LLM prompt sanitization.

Assignee names are replaced with per-call pseudonyms (dev-01, dev-02...)
before any payload leaves for the LLM provider; real names are restored
locally where they must appear in generated text. A fresh mapping per
call prevents providers from correlating individuals across requests.

Pure stdlib so validate_rubric.py can test it without the genai SDK.
"""

import re

# Matches bare email addresses in free-text issue fields.
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def scrub_emails(value):
    return EMAIL_RE.sub("[email]", value) if isinstance(value, str) else value


def pseudonymize_assignee(name, mapping):
    name = (name or "").strip() or "Unassigned"
    if name == "Unassigned":
        return name
    if name not in mapping:
        mapping[name] = f"dev-{len(mapping) + 1:02d}"
    return mapping[name]


def sanitize_issue_for_prompt(issue, mapping):
    row = dict(issue)
    row["assignee"] = pseudonymize_assignee(issue.get("assignee"), mapping)
    for field in ("summary", "description", "acceptance_criteria"):
        row[field] = scrub_emails(row.get(field))
    return row


def scrub_names_in_text(value, mapping):
    """Replace every mapped real name with its alias inside free text."""
    if not isinstance(value, str) or not mapping:
        return value
    # Longest names first so "Ravi Patel" is replaced before "Ravi".
    for real in sorted(mapping, key=len, reverse=True):
        if real:
            value = re.sub(rf"\b{re.escape(real)}\b", mapping[real], value)
    return value


def deep_scrub_text(obj, mapping):
    """Apply email + name scrubbing to every string in a nested structure."""
    if isinstance(obj, dict):
        return {k: deep_scrub_text(v, mapping) for k, v in obj.items()}
    if isinstance(obj, list):
        return [deep_scrub_text(v, mapping) for v in obj]
    if isinstance(obj, str):
        return scrub_names_in_text(scrub_emails(obj), mapping)
    return obj


def restore_aliases(text, mapping):
    """Inverse of pseudonymization: dev-NN aliases -> real names."""
    if not isinstance(text, str) or not mapping:
        return text
    for real, alias in mapping.items():
        if alias:
            text = re.sub(rf"\b{re.escape(alias)}\b", real, text, flags=re.IGNORECASE)
    return text


def deep_pseudonymize(obj, mapping):
    """Recursively replace 'assignee' values in nested dicts/lists (report payloads)."""
    if isinstance(obj, dict):
        return {
            k: (pseudonymize_assignee(v, mapping) if k == "assignee" else deep_pseudonymize(v, mapping))
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [deep_pseudonymize(x, mapping) for x in obj]
    return scrub_emails(obj)
