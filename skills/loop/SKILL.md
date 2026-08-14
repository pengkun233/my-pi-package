---
name: loop
description: Schedule and control session-scoped repeated checks. Use when the user wants monitoring or another action run on an interval, asks for the active Loop's status, or asks to stop future checks.
---

# Loop

Route the request to start, status, or stop.

## Start

1. Resolve the repeated action, interval, and either an observable completion condition or intentional open-endedness. Ask one focused question when any required part is ambiguous.
2. Convert the interval to whole minutes from 1 through 10080. Pass `maxRuns` or `timeoutMinutes` only when the user supplies that limit.
3. Write a self-contained check prompt that names the action or state to inspect. For monitored work, add the observable completion condition and `Call loop_stop with the reason when the condition is met; otherwise report the current state.` For intentionally open-ended repetition, state that it continues until the user stops the Loop.
4. Call `loop_start`. A successful tool result completes scheduling; report the cadence and any limit, then finish the turn.

## Check

When a Loop check arrives, perform the stored prompt. If its completion condition is met, call `loop_stop` with the reason before reporting the final result. A “No active Loop” result means it was already stopped, for example by a configured limit or explicit cancellation, so report the final result without guessing which one. Otherwise report the current state; a configured limit may stop the Loop after this check.

The check is complete only after the required inspection ran, the current state was reported, and `loop_stop` was attempted when the completion condition was met.

## Status or stop

- For status, call `loop_status` and report its result.
- For cancellation, call `loop_stop` with the user's reason when available.
