[🇰🇷 한국어](vision.md) · 🇬🇧 English

# Vision · Where this is going

> This is **not a committed roadmap.** It's the maker's *I'd like to head this way* picture. Shape is determined by community feedback.

## Where we are

**v0.1.0 — an honest local tray app.**
Visualises a day of coding as a universe. All data stays local. Source is open. No ads. No telemetry.

## Next — v0.x short term

- **Weekly digest**: export the week's universe as a PNG. Share to whatever SNS you like.
- **More providers**: Cursor · Gemini Code · etc.
- **Time-of-day achievements**: Night Owl, Early Bird (keys are already reserved in the engine).
- **macOS Developer ID + Windows EV signing**: drops the OS scary-dialog on first run.

## Mid — v1.0 ~ v1.x

### 1. Community (opt-in only)

A companion web page where you can **optionally** share your universe:

- **Gallery sharing**: post a constellation or universe you're proud of. Browse others'.
- **Stats comparison**: compare against anonymised averages ("you're in the top 20% of token spend this week" etc.).
- **Developer coffee chat**: a relaxed space — Discord or self-hosted — where you can look at someone's work universe and just talk.

**Hard rules:**
- **Sharing is 100% opt-in.** Default = nothing leaves your machine. Only explicitly toggled universes are uploaded.
- **Anonymous-capable.** Nickname + universe only. Real name / email never required.
- **Raw token data never leaves.** Only the *visual outcomes* — star counts, planet species — are shared. The code you wrote stays local forever.

### 2. Seasons — cosmetic options

A new visual theme each quarter, available optionally:

- **Spring**: cherry blossom stars, soft pink palette
- **Halloween**: pumpkin-toned stars, jack-o'-lantern planets
- **Winter**: snowflake star shapes, crystalline planets
- **Cyberpunk**: neon cyan/magenta, glitch-style star effects

**Hard rules:**
- The app stays **free forever**. Season packs are an **optional cosmetic** layer.
- Users without season packs still have **100% of features** — no core gating.
- Cosmetics apply only to your own universe. On the shared community page everyone's universe normalises to the default look.
- GitHub Sponsors get **every season pack forever**.

This is a way to keep the side project going. *"I'm building this on evenings after my day job — if season packs let me keep building, that'd be great"* — being honest.

**Not committed yet — which seasons resonate, what price feels natural, will be decided with community feedback.**

## Long term — v2.0+

- **Mobile companion (read-only)**: revisit yesterday's universe on the train, browse the gallery.
- **Team universes (optional)**: aggregate anonymised universes for a company/study group — "our team's universe this week". Individual universes stay separate.
- **API**: programmatic access to your own token data (e.g., auto-embed today's universe in Obsidian/Notion).

## Principles at this point

What's clear right now (the model may evolve over time):

- **Local-first data.** Raw token logs leave your machine only if you explicitly opt in — see [Privacy](privacy.en.md).
- **Core features in the current build are free + open source.** Stars, planets, codex, gallery, constellations, auto-update, i18n.
- **Seasonal cosmetics are an optional side layer.** No impact on core features, opt-in. Price/format will be shaped by community feedback.
- **Transparency**: any model change will be announced in release notes / in-app, and existing features will be preserved.

> This section reflects current-build commitments and may change as the business model evolves. Changes will be clearly communicated through release notes and in-app notices.

## How you can help

- **Issues / Discussions**: weigh in on the ideas above — which sound good, which don't.
- **PRs**: more providers, new planet species, visual effect improvements, i18n.
- **Sponsor**: GitHub Sponsors will be enabled around v1.0.0.
- **Just use it and report back**: "this worked / this didn't" — most valuable contribution.

## Honest stance from the maker

This is an evening side project after my day job. I also don't think it can survive purely on free volunteer time forever. So the current direction is:

- **Current build's core stays free / open** — FSL licence + auto-converts to Apache 2.0 after 2 years.
- **Explore seasonal cosmetics and an opt-in community first** — light models that let the project cover some of its own costs.
- **User trust comes first** — any model change is announced ahead of time, and existing features are preserved.

The long-term shape will be decided together with the community. Opinions welcome.
