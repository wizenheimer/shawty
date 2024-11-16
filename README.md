<h3 align="center"> Shawty </h3>

<p align="center">It makes your screenshots go brrrrrrr</p>

A no-BS screenshot service running on Cloudflare Workers that simply works. Built because we were tired of paying premium for dollar store screenshots. Webhooks included, because obviously.

## Features That Slap

* Actually works in prod (we were surprised too)
* Captures full page screenshots (because who has time to scroll)
* Blocks ads (who needs those anyway)
* Smart enough to handle sticky elements (they're not going anywhere)
* Supports multiple formats (because we're not monsters)
* Configurable quality (because you're a perfectionist)
* Works with most of the websites (because we're not picky)
* Automatically handles those pesky cookie popups (goodbye, GDPR lmao)
* Yeets everything into Cloudflare R2 (because we're all about that edge)
* Sends webhook notifications (because you're too busy to check)

## Quick Start

```typescript
import { ScreenshotService } from 'shawty';

// The bare minimum (like your CI setup)
const screenshot = await screenshotService.takeScreenshot({
  url: 'https://example.com',
});

// The whole shabang 
const fancyScreenshot = await screenshotService.takeScreenshot({
  url: 'https://example.com',
  width: 1920,          // wider than your monitor
  height: 1080,         // taller than your attention span
  fullPage: true,       // capture ALL the things
  format: 'jpeg',       // because pngs are so 2020
  quality: 80,          // good enough for The Gram™
});
```

## Environment Variables (the secret sauce)

```env
R2_BUCKET_NAME=your-bucket-name
WEBHOOK_URL=https://your-webhook.com/endpoint
```

## Installation

```bash
npm install shawty
# you now have commitment issues and a screenshot service
```

## Contributing

Found a bug? Fixed a thing? Made it better? Let's hear it!
* Fork it
* Branch it
* Push it
* PR it

## Release Notes

Built with 🤍 and an unhealthy amount of caffeine.

Part of the "services we built because we had more grit than cash" collection.
