---
name: fincake-design
description: "Use for Fincake mobile UI/UX, screen layout, styling, navigation and accessibility changes; dizajn aplikacie."
---

# Focused UI change

1. Establish the target screen and observable acceptance criteria. Ask only when
   an unresolved design choice materially changes behavior or scope.
2. Read `portfolio-mobile/AGENTS.md`, the screen and only its relevant shared
   components, theme and localization. Search existing UI patterns before adding
   one; do not read unrelated screens or financial datasets.
3. Implement with existing primitives. Keep helpers outside `src/app/`; preserve
   calculations, storage, navigation outcomes and interactions unless requested.
4. Check small screens, safe areas, keyboard, touch targets, accessibility,
   supported themes/languages and relevant loading/empty/error states.
5. Run required local lint/typecheck and only tests covering changed behavior.
   Do not add lint dependencies/configuration automatically; report missing setup.
6. If browser/device access exists, verify the affected screen and interactions,
   using non-private sample data. Reuse the page; capture only useful evidence.
   Web preview does not verify native layout or device behavior.

Stop when the requested UI and affected interactions are verified; report any
unavailable visual/device checks. No store edits, release builds or publishing.
