// Captured from agy /usage: no model turn or tokens.
export const AGY_USAGE = {
  "conversation_id": "",
  "status": "SUCCESS",
  "duration_seconds": 0,
  "num_turns": 0,
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0,
    "thinking_tokens": 0,
    "cache_read_tokens": 0,
    "total_tokens": 0
  },
  "command": {
    "name": "usage",
    "data": {
      "description": "Within each group, models share a weekly limit and a 5-hour limit. Quota is consumed proportionally to the cost of the tokens. Thus, limits will last longer with shorter tasks or using more cost-effective models. The 5-hour limit smooths out aggregate demand to fairly distribute global capacity across all users, while your weekly limit is tied directly to your individual tier.",
      "groups": [
        {
          "name": "Gemini Models",
          "description": "Models within this group: Gemini Flash, Gemini Pro",
          "buckets": [
            {
              "id": "gemini-weekly",
              "name": "Weekly Limit Remaining",
              "description": "You have used some of your weekly limit, it will fully refresh in 2 days, 2 hours.",
              "window": "weekly",
              "remaining_fraction": 0.9536621570587158,
              "reset_time": "2026-10-24T11:28:02Z"
            },
            {
              "id": "gemini-5h",
              "name": "Five Hour Limit Remaining",
              "description": "You have used some of your 5-hour limit, it will fully refresh in 4 hours, 36 minutes.",
              "window": "5h",
              "remaining_fraction": 0.9900830388069153,
              "reset_time": "2026-10-22T13:35:47Z"
            }
          ]
        },
        {
          "name": "Claude and GPT models",
          "description": "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
          "buckets": [
            {
              "id": "3p-weekly",
              "name": "Weekly Limit Remaining",
              "window": "weekly",
              "remaining_fraction": 1,
              "reset_time": "2026-10-29T08:58:51Z"
            },
            {
              "id": "3p-5h",
              "name": "Five Hour Limit Remaining",
              "window": "5h",
              "remaining_fraction": 1,
              "reset_time": "2026-10-22T13:58:51Z"
            }
          ]
        },
        {
          "name": "Gemini 4 Argon",
          "description": "For paid Pro plans, Argon quota is separate. Higher Argon quota (included as part of the larger Gemini quota bucket) is available on Ultra plans.",
          "buckets": [
            {
              "id": "gemini-argon-wtu-weekly",
              "name": "Gemini 4 Argon Weekly Limit",
              "description": "You have used some of your weekly limit, it will fully refresh in 4 days, 6 hours.",
              "window": "weekly",
              "remaining_fraction": 0.686157763004303,
              "reset_time": "2026-10-26T15:41:55Z"
            }
          ]
        }
      ]
    }
  }
}
