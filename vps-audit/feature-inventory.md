# Product feature inventory and verification map

Reviewed 30 October 2026. This inventories the implemented capability groups, not every possible user input or device. Automated API tests use disposable data, fake mail/SMS/AI endpoints and local/fake-S3 assets. Passing them does not establish real provider delivery or production capacity. Exact test names and route definitions are in evidence/feature-test-index.txt and evidence/feature-route-index.txt.

Legend: A = automated behavior covered in the current passing suite; B = current browser check; H = earlier browser evidence retained; M = manual or infrastructure verification still needed. Coverage is partial within each broad group.

| Feature group | Implemented capabilities | Verification / remaining checks |
|---|---|---|
| Accounts | Personal sign-in, team-code signup, first-admin bootstrap, session cookies, logout, session refresh | A: auth/API suite; M: production HTTPS cookies and live login |
| Passwords | Scrypt hashing, forgot password, one-use reset link, password change, other-session invalidation | A: API/reset races/malformed hashes; M: real email and PostgreSQL execution |
| Team administration | List, promote/demote, last-admin guard, reset links, delete account | A: API; PostgreSQL concurrency drill prepared, not run |
| Project access | Owner/member visibility, sharing/removal, legacy claim, client staff permissions | A: ownership and role isolation API tests |
| Project lifecycle | Create, rename, delete/detach spaces, progress/delivered/archive status, feature flags | A: API; M: complete GUI lifecycle with representative customer projects |
| Branding | Name, logo upload, extracted accent, 10 current/3 legacy fonts, venue info and contact details | A: persistence/validation/color helpers; H: font isolation and 195 design/font/viewport combinations |
| Studio home | Project cards, waiting counts, activity, readiness information, links to editing/reporting | A: API/count rules; M: every dashboard state visually |
| Scene editing | Save/reload scene documents, revision conflicts, spawn, scale, transform, lighting/look settings | A: scene store/API; M: each control with real scans |
| History and recovery | Undo/redo, reload draft recovery, restore/download/discard recovered edits | A: recovery parser/revision guards; H: recovery fixture; M: all undo combinations and crash scenarios |
| Camera authoring | Viewpoints, paths/tracks, waypoint positions, timings, narration/captions, preview playback | A: document persistence; M: complete GUI playback/recording and real audio |
| Placement and collision | Model transform, collision boxes, placement on scanned surfaces, floor detection, up-axis correction | A: client geometry/collision tests; M: every uploaded scan and GPU tier |
| Hotspots | Text, image, video, audio, URL, portal, table, room, hall; reveal distance, layout, localization, copying | A: layout, safe URLs, published references, booking routing; M: all interactive media/cards on touch devices |
| Upload pipeline | Chunked/resumable uploads, ownership, quota/expiry, finalize, archive extraction limits | A: API/local/fake S3, duplicate chunks, access and quota regressions |
| Model formats | LCC splats, converted GLB meshes/point clouds, 360 MP4, conversion worker | A: format/header checks, file serving, collision helpers; M: large real conversions and memory pressure |
| Media | Photos, thumbnails, floor-plan images, audio, private event documents, byte-range streaming | A: format/size/range/permission tests; M: all actual venue assets and playback |
| Publishing | Readiness warnings, immutable numbered snapshots, unpublish/republish, restore versions | A: API, monotonic history, ownership preservation; M: GUI publish checklist |
| Tour navigation | Start/loading screen, Walk/Fly/Orbit/Viewpoints, keyboard/touch controls, arrival transitions | A: relevant pure geometry; M: real GPU/mobile interaction and first-frame performance |
| Multi-space tours | Lazy scene loading, portals, day/night variants, building/floor groups, quality adaptation | A: grouping and quality rules, build/types; M: slow/failing model downloads and measured device performance |
| Tour floor map | Position indicator, floors/buildings, space navigation, generated/annotated plans | A: floor-plan extraction/mark persistence; M: map accuracy against real venue plans |
| Tour access and sharing | Embeds, allowed-host checks, key rotation, share metadata, QR codes, branded hub | A: embed authorization and safe host tests; M: real third-party iframe/fullscreen/share previews |
| Languages/accessibility | English/Nepali/Chinese strings, localized hotspots, reduced motion, no-WebGL enquiry fallback | A: translation completeness; H: keyboard booking tabs/motion; M: screen reader, contrast, touch and fallback audit |
| GUI website authoring | Sections, hero/story/facts, room descriptions, menu/outlets, gallery, reviews, FAQ, offers/contact | A: save/publish normalization and project isolation; M: each GUI field and extreme content |
| Website presentation | Five presets, brand fonts, light/dark, calm/expressive/no motion, guidance text, mobile spacing | A: presentation round trip; B: sample desktop/mobile; H: 195 combinations, no fresh full matrix in this pass |
| Website publication | Draft preview, publish, scheduled snapshot/cancel, private client review link/comments/approval | A: API isolation/scheduling/review; M: browser review collaboration and real scheduled wall-clock run |
| Website navigation | Mobile menu, room/space pages, chapter links, tour embed, booking tabs, primary CTAs | B: sample render, no overflow/broken loaded images/uncaught exceptions, booking header clearance; H: keyboard tabs |
| Early room search | Date/guest shortcut into existing room booking, venue date, stay length limits | A: room-clock regression; H: search-to-desk browser fixture |
| Table booking | Sitting hours/duration, capacity, table selection, any-table allocation, multiple dining outlets | A: availability, collisions, validation, outlet isolation; M: real business rules and live notifications |
| Room booking | Room types/units/capacity, nights, multi-room parties, checkout exclusivity, calendar/site plan | A: availability, overlap, capacity and request lifecycle; M: reconciled real inventory |
| Events | Halls, seated/standing capacity, day/evening/whole-day, event request and attachment | A: overlap/capacity/attachment retry/access; M: document viewing and approved venue policy |
| Hotspot bookings | Independent table/room/hall requests, mapped website resource links, external engine links | A: published-only checks, conflicts/channel guard, URL parameters; M: real engine contracts |
| Reservations inbox | Kind/status tabs, search/contact/reference, date range, list/month calendar, selected-day view | A: filter/calendar rules; B: desktop/mobile filter and calendar fixture |
| Reservation review | Open floor plan, see requested resource, availability recheck, confirm/decline, stale-status conflicts | A: authorization/conflicts/review API; H: review-dialog fixture; M: real guest receipt |
| Manual blocks | Staff room/hall/table blocks, availability subtraction, cancellation | A: API and >366-night rejection; M: reconciliation with external bookings |
| Waitlist | Room/table/event wait requests, notification when availability may return, delivery status | A: fake provider/API tests; M: real SMS/WhatsApp/email and restart durability |
| Enquiries | Tour/property/company forms, published scene validation, spam/rate limits, staff inbox and CSV | A: reference validation/access/export/fake mail; M: real recipient routing and delivery |
| Notifications | Email, SMS, WhatsApp, status outcomes, sender test, retry-friendly attachment behavior | A: provider mocks/phone normalization; M: sender DNS/templates/provider outages/durable retry queue |
| Analytics | Visits, dwell time, referrers/hotspots, enquiry counts, monthly reporting and print report | A: aggregation/API access; M: production traffic correctness and reporting at volume |
| AI tools | Published-information concierge, grounded navigation, studio translation/suggestions | A: mocked provider and context tests; M: real model quality, costs, quota and vendor failure behavior |
| Company website | Marketing/content routes, gallery, contact/planner/early access, FAQ, blog, account menu | A: shared form API; build routes; M: full marketing browser/content/link/policy review |
| SEO/discovery | Metadata, canonical URLs, robots, sitemap, RSS, llms.txt, public scene previews | Build/type checks; M: production canonical/domain, crawler and social-preview verification |
| Data integrity | Atomic file writes, mutation queues, corrupt-record handling, revision conflict rejection | A: read/write races, fail-closed bookings/sites, history, single writer |
| Storage and delivery | Local disk, S3-compatible storage, immutable assets, range requests, quotas/cleanup | A: fake S3/local storage, API and quota tests; M: real bucket permissions/cache/failures |
| PostgreSQL accounts | Pool, transactions, migrations, account adapter/import, environment credentials | A: config/driver parsing and import decisions; real SQL/concurrency/restore NOT run |
| Backups | JSON, external local assets, optional pg_dump, manifest, retention, optional bucket upload | A: local backup/restore; M: PostgreSQL restore, consistent stopped-writer backup and off-VPS disaster drill |
| Operations/security | Production secret checks, loopback bind, single writer, rate limits, engine SSRF bounds | A: production startup, second-writer refusal, bounds/permissions; M: VPS firewall/TLS/nginx/monitoring/load |

## Important boundaries

- Existing tests exercise many features, but there is no automated end-to-end test for every studio GUI control. This inventory explicitly records those gaps.
- Current file stores require one API writer. PostgreSQL account support is not a platform-wide database migration or a scaling certificate.
- Website and independent hotspot room/hall inventory are guarded against simultaneous use; unified physical inventory remains future work.
- Provider calls in tests are fake. No real guest messages, bookings or live configuration were changed during this pass.
- Fonts and client layouts remain GUI driven. This pass does not impose Inter on client sites or tours.
