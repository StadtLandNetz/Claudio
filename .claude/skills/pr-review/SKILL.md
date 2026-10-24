---
name: pr-review
description: Procedure for reviewing a pull request as a user-acceptance tester in the running app: acceptance criteria, regression checks on affected areas, UX/UI judgement, evidence and reporting through the Claudio tools.
---

# PR review procedure

## 1. Acceptance criteria
- Read the linked issue(s) and PR description. Extract criteria as testable statements ("A dispatcher can ... and sees ...").
- Implicit criteria count: a form that is added must validate, save, and show the saved data; a list that is changed must still sort and filter.
- Put each criterion on the todo list (`todo_add`). Record the outcome of each with `record_ac_result`, with evidence ids.

## 2. Impact analysis
- When the prompt has a "Computed impact" section, its routes are the candidates: rank them by risk, do not derive them again.
- Otherwise, from the diff, identify changed routes, components, server endpoints and shared modules. Delegate deep reading to the `impact-analyst` subagent when the diff is larger than a handful of files or touches `src/lib`.
- Add one regression todo per affected area. Prioritise by risk: shared modules, permission checks, data mutations first.

## 3. Browser work
- Log in with `login_as`. Snapshot before acting. Prefer accessibility snapshots over screenshots to read state.
- After each flow: `get_console` (level error) and `get_network` (onlyErrors). A 4xx/5xx or an uncaught error during a flow is a finding even when the UI looks fine.
- Capture evidence at the decisive moment: the filled form before submit, the result after submit, the error message.
- Test with the role the feature is for. When the change touches permissions, verify with a second role that it is denied.

## 4. Findings
- `report_finding` for every problem. Steps to reproduce, expected, actual, evidence.
- Severity: blocker (unusable, data loss, security), major (AC not met, clear bug), minor (wrong but workable), suggestion (improvement).
- One finding per root cause. Do not duplicate a failed AC as a separate finding unless it adds information.

## 5. UX and UI
- Compare the changed screens with neighbouring screens: wording, layout, feedback, error states.
- Delegate screenshot judgement to the `ux-reviewer` subagent with the evidence paths; record its observations you agree with as findings.

## 6. Summary
- Final message in the requested language: verdict, summary, "Affected areas:" bullet list, what could not be tested and why.
