# Client website design improvements

Implemented 2026-10-30. Client websites remain generated from the studio GUI. Existing project content, branding choices, photographs, and saved publications were not rewritten.

## GUI controls

- Website → Look → Website motion: Calm (default), Expressive, None. Expressive scrolling is limited to larger screens. Reduced-motion visitors receive the quiet layout.
- Website → Opening → Booking guidance: optional text for the client's actual response/payment policy. The default describes a reservation request without promising a response time.
- Existing Design, Heading font, Opening photo, space photos and room-type photos remain the source of the output.

## Shared changes

- Separate decorative handwriting from headings; allow heading wrapping across all five styles and all 13 supported brand fonts, including legacy faces.
- Make the business-specific reservation action primary and the 3D exploration action secondary.
- Add an early room-date/guest search that fills the existing booking desk and its availability calendar. It does not submit a reservation.
- Improve booking anchor clearance, keyboard tab navigation, and navigation accessible names.
- Show spaces in normal page flow with calm/no motion and on smaller screens. Keep cinematic scrolling available through the GUI.
- Reuse an authored photo of the same space when a room type lacks its own photo. Do not fabricate or select an unrelated photograph.
- Preserve original client fonts; this change adds no global font-family override.

## Validation

- 204 automated tests passed, one skipped. Includes a new test for GUI presentation settings surviving API save/reload, legacy defaults and input bounds.
- Production build and targeted ESLint passed.
- Browser matrix: five designs × 13 supported fonts × 1440/390/320px = 195 combinations. Checked heading width, script/heading separation and navigation overlap using the local sample content.
- Browser interaction checks: early date search across a month boundary, booking header clearance, arrow-key tab navigation and switching motion to None.
- Final actual sample inspection at 1440px and 390px: no horizontal overflow, broken loaded images, or uncaught browser exceptions observed. This is not a full accessibility, performance or conversion assessment.

Evidence: `evidence/client-design-matrix.json`, `evidence/client-design-review.json`, `evidence/client-design-tests.log`, `evidence/client-design-build.log`, and `client-design-390-top.png` / `client-design-390-stay.png`.

The matrix used a temporary read-only harness. Its source was retained as `design-fixture-page.tsx.txt` and `design-fixture-harness.tsx.txt`; the route was removed before the production build. Restore those files under `src/app/design-check` temporarily to rerun `verify-client-design.mjs`, then remove the temporary route and its generated Next route type before the final build.
