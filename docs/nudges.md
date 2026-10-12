# Spontaneous nudges

Desktop idle messages and spontaneous phone messages share the composer in
`electron/nudges.ts`. The character identity stays intact; selected facts, recent
conversation and delivery instructions determine the individual message.

## Selection and delivery

- Human statements from the last 36 hours can supply callbacks. Assistant claims
  do not establish facts. Matching terms also connect her interests to recent chat.
- Her daytime reading, night records and completed manga supply her own subjects.
  A completion needs a recorded take; a timestamp alone is not an opinion.
- Recent message kinds and delivery tones rotate. Dry amusement, curiosity,
  firm opinions, playful challenges and supported grudging praise are available.
- A task marked underway expires as spontaneous material after eight hours.
  Completion is a separate event with the existing task follow-up window.
- Topics normally cool down for 24 hours. A recorded completion or explicitly
  changed opinion can reopen one after at least two hours, when it happened after
  the previous message. Re-publishing the same source revision is blocked.
- Her own updates stand alone. Direct question comparisons and a separate model
  review reject repetition and unsupported premises. The reviewer lists factual
  premises before its verdict, including implied actions, choices and motives
  inside questions. Any unsupported premise blocks the draft even if the final
  verdict says send. Model review is fallible; a deliberate PASS is valid.

## Learning and feedback

The desktop Asides page and phone chat show **More like this**, **Less like this**
and **Already discussed** beneath spontaneous messages. Selecting the active
choice again clears it. Saving feedback never changes her mood or sends a retort.

- More like this increases the weight of matching subjects.
- Less like this pauses the subject for two days, then reduces its weight.
- Already discussed suppresses the subject for 30 days. A genuinely later
  recorded development may reopen it.
- Named replies or replies with identifiable topic overlap teach engagement;
  longer substantive replies count more. An identifiable “already told you”
  response acts as Already discussed. Unrelated messages are not credited.
- Unanswered nudges mildly reduce their topic's weight. Known undelivered messages
  do not count. Silence does not create a debt to answer an unsolicited nudge.

Learning lives in `chat.nudgeLearning`, bounded to 300 records and 90 days.
Feedback also appears on the aside. It survives restart and daily chat rollover,
and is cleared by a full Haru reset. Matching uses bounded keyword overlap rather
than a model trained on the user's conversations.

## Relationship follow-ups

Morning, evening and conversation-pause follow-ups share one opportunity every
three days. They require a recent, explicit offer from the user to tell or show
her something, with no later user message. Future-dated offers are left to the
reminder system. Silent days and unanswered spontaneous messages do not generate
the old morning sulk or evening tally complaint.

Phone delivery continues to respect the existing spontaneous-notification toggle,
quiet hours, sleep state and interruption guards.

## Phone opportunities and timing

The phone uses `electron/nudge-schedule.ts`. A minute scan discovers new material;
it does not owe the user a notification. The old 45–120 minute attempt timer and
two-hour retry floor have been removed.

- Dated reading/takes, completed manga with a recorded take, task changes,
  conversation callbacks and eligible explicit follow-ups create opportunities.
  Undated background memories alone cannot trigger the phone.
- Fresh reading and task developments (under an hour old) draw a **5–25 minute**
  delay. Casual material draws **30–120 minutes**. The existing sharp voice,
  varied tones, standalone observations and supported praise remain in use.
- Each source revision gets one probabilistic chance: normally 70% for a fresh
  development and 40% for casual material, adjusted by preferences, response
  windows and recent unanswered deliveries, capped at 90%. A skipped event,
  model PASS or rejected draft is not retried. Zero-message days are valid.
- Most draws use the existing relevance and variety weights. A 12% wildcard draw
  may pick a lower-priority subject, but only inside the same grounded, unexpired,
  unblocked pool. It cannot bypass explicit feedback or repetition checks.
- There are at most **three spontaneous phone notifications per local calendar
  day**, with **90 minutes between them**, including across midnight. All
  spontaneous senders reserve against one persisted budget before transport.
  Scheduled reminders and requested traffic/download results keep
  their separate delivery behavior and existing notification preferences.
- Identifiable replies within three hours teach the user's actual local response
  window. More/Less/Already discussed feedback also affects timing weights.
  Three-hour windows use smoothed, bounded weights with 30-day decay; four random
  candidate times are weighted within the delay range. Unanswered deliveries
  gently lower future odds, without increasing irritation or creating a chase.
- Reading expires after six hours; callbacks after twelve; underway tasks after
  eight; completed tasks use the existing four-hour follow-up window. Rare
  offered-update follow-ups expire 36 hours after the offer. Timing never extends
  the underlying source's expiry.
- A missing/changed source, a later topical user message, feedback or a previously
  raised subject can cancel a queued opportunity. Facts and interruption gates
  are checked again after generation, immediately before publication. Any user
  message arriving during composition cancels that attempt.
- Quiet hours, Focus, sleep, disabled notifications and missing registered phones
  discard pending opportunities. Restarts establish a fresh baseline, and a scan
  gap over ten minutes or a delivery window missed by ten minutes drops old work.
  Preference changes also clear the queue. Nothing catches up on waking.
- Spontaneous APNs requests have expiration `0`; Web Push has TTL `0`, so carriers
  must not store them for an offline phone. Existing collapse IDs remain. The OS
  can still manage notifications already received on the device.

Desktop conversation starters continue to use the shared composer immediately.
Their asides do not independently buzz the phone; the phone opportunity scheduler
owns spontaneous conversation starters. Goodnight messages and follow-ups Haru
books for herself share the phone budget.

State lives in `chat.phoneNudges`: at most 24 pending opportunities, 1,000 seen
event identifiers retained seven days, and 300 delivery/timing records retained
90 days. First upgrade counts previously accepted spontaneous pushes. Carrier
acceptance is counted conservatively as delivery; it does not prove the user saw
the notification. A reservation left by a crash also counts conservatively, while
known transport failures free the budget. Full Haru reset clears this state.

Deploying the scheduler does not enable the spontaneous-notification toggle.

## Checks

`npm test` covers selection, persistence, timing, learning and the authenticated
feedback endpoint, plus queue expiry, restart/quiet recovery, local-day budgets,
concurrent send reservations, topic changes, wildcards and carrier expiration.
`npm run build` checks both renderers and Electron. Scheduler tests use synthetic
records and injected time/randomness; no phone notifications are sent.

`DISPLAY=:99 node_modules/.bin/electron scripts/check-nudge-ui.cjs --no-sandbox`
uses synthetic data and an isolated browser profile to exercise desktop and phone
feedback, undo, reload, layout and failed saves. It never contacts the live app.

`node scripts/preview-nudges.cjs --run` uses the configured local nudge model with
synthetic examples. `--only=callback` or `--only=completed-task` limits the cases.
Nothing is delivered to the user or stored in Haru's conversation.

`node scripts/preview-nudges.cjs --run --review-checks` checks paired grounding
regressions against the actual local reviewer: a plan cannot imply a completed
change, while open questions and questions about recorded changes remain allowed.
It returns a failing exit status if any expected review decision disagrees.
