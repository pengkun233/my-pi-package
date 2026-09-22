---
name: loop
description: Schedule and control session-scoped background monitoring. Use when the user wants checks run on an interval, asks for the active Loop's status, or asks to stop future checks.
---

# Loop

Route the request to start, status, or stop.

## Start

1. Resolve what to monitor, the interval, and the completion condition (or intentional open-endedness). Ask one focused question if a required part is ambiguous.
2. Convert the interval to whole minutes from 1 through 10080. Pass `maxRuns` or `timeoutMinutes` only when the user supplies that limit.
3. Write a self-contained prompt for an independent patrol model: include the target, concrete file paths or other observations, completion condition, and when the main conversation should intervene. It has no main-conversation history and can use `read`, `grep`, `find`, and `ls`. For command-based observations, pass a read-only `probeCommand`; its output and exit code are supplied before each check.
4. Call `loop_start`. Use configured model defaults unless the user requests a `patrolModel` or `patrolThinking` override. Report the cadence and any limit, then finish the turn.

The patrol model decides whether to continue, finish, or request attention. The plugin stops and notifies the main conversation automatically; normal continuing checks remain silent. Loop monitors work rather than periodically performing write actions.

## Result notification

Report the result to the user. The Loop has already stopped; another `loop_stop` call is unnecessary. A check/time limit or monitoring error does not mean the monitored task completed.

## Status or stop

- For status, call `loop_status` and report its result.
- For cancellation, call `loop_stop` with the user's reason when available. This also cancels a check already in progress.
