# ADR-0001: Split authority by fact type

Status: accepted

Atlas does not use one manually edited status document as universal truth.
Direction comes from versioned doctrine and ADRs; implementation from Git;
database reality from Supabase; deployed reality from Railway fingerprints;
CI from GitHub Actions; active work from the current handoff.

When authorities disagree, Atlas reports drift and blocks completion claims.
It never silently chooses the most convenient answer.
