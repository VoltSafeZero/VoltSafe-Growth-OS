---
name: Ask Cortex retrieval grounding
description: Why gpt-4o-mini ignored the RAG context and answered with generic base-model boilerplate, and how the fix avoids it.
---

`/api/cortex/ask` (server/routes.ts) retrieves real rows from `cortex_email_intel` and puts them in
the system prompt, but a system prompt phrased as "answer based ONLY on the knowledge that has been
ingested... if you don't have relevant information, say so" is not enough — gpt-4o-mini will still
default to its "I don't learn in real-time, training data current up to October 2023" canned
disclaimer, even with real context present. This is a compliance problem, not a retrieval bug —
reproduced by calling the OpenAI SDK directly with the exact same prompt/context outside the app.

**Why:** the model treats "based on ingested knowledge" as a soft preference, and the phrase "what did
you learn" triggers a strong prior toward the model's self-referential "I don't learn in real time"
disclaimer regardless of context.

**How to apply:** frame retrieved context as the model's own first-person memory ("treat these as
things you personally learned/researched — they ARE your knowledge base, not external documents"),
explicitly forbid the disclaimer phrases in the system prompt, and add a regex-based
post-generation guard (BOILERPLATE_PATTERNS in server/routes.ts) that swaps in a controlled
Cortex-specific message if the model still slips into boilerplate. Also scope "today" questions to
`created_at >= CURRENT_DATE` with a fallback to the general top-N query so date-window mismatches
never cause a false "no knowledge" response.
