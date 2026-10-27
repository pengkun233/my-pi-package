---
description: Refine frontend design against award-tier visual standards
---

::OBJECTIVE{site_design|pri:OVERRIDE_ALL}
target: build page to award-tier visual standard
ACCEPT: no visible improvement remaining across all CHECK dimensions
BENCHMARK: Awwwards | Webby Awards | FWA winning entries
::CHECK{typography|standard:award tier}
::CHECK{whitespace|standard:award tier}
::CHECK{visual_hierarchy|standard:award tier}
::CHECK{color|standard:award tier}
::CHECK{motion|standard:award tier}
::CHECK{micro_interaction|standard:award tier}
::CHECK{responsive|standard:award tier}
::CHECK{originality|standard:award tier}
::LOOP{self_review|trigger:on_completion}
[READ] current page against CHECK list
[COMPARE] each dimension to BENCHMARK entries
[IF] gap found => [PATCH] then re-enter LOOP
[IF] no gap => [Ω]
