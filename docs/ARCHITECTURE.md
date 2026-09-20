# Architecture boundaries

```text
Web / Telegram webhook / GPT-Live client
              |
     authenticated application API
              |
 domain services + transaction repositories
        |                    |
Private Supabase Storage    events/outbox/pgmq
                                 |
                              Worker
                    /        |         \
             bounded AI   monitoring   execution gateway
                                             |
                                 isolated Playwright browser
                                             |
                                    external/reference portal
```

Only the execution gateway may perform a stored, approved external action. It never accepts model-selected owner IDs, raw browser scripts, secrets, or arbitrary destinations.

The UI design source is [PaperTrail’s design system](../design-system/papertrail/MASTER.md), with the product specification taking precedence where they differ. The application will self-host Source Sans 3 and Noto Sans Malayalam rather than import hosted fonts.
