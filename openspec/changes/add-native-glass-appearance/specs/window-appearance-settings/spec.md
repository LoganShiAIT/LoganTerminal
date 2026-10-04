## ADDED Requirements

### Requirement: Material and opacity controls

The appearance settings SHALL offer solid and glass modes, a background blur control for glass mode, and a background opacity control from 10% through 100% in whole-percent increments. The default glass opacity SHALL be 75% and background blur SHALL default to enabled. Solid mode SHALL render fully opaque while retaining the saved glass opacity and blur values; the opacity control SHALL be disabled when effective appearance is solid, and the blur control SHALL be disabled while the material preference is not glass.

#### Scenario: Configure glass
- **WHEN** glass is effective and the user sets background opacity to 60%
- **THEN** shell and terminal default backgrounds update live to 0.60 base alpha without reducing foreground opacity

#### Scenario: Toggle background blur
- **WHEN** the user turns background blur off in glass mode
- **THEN** the native frost is removed immediately, the saved material and opacity values are retained, and turning it back on restores the frosted glass without re-creating terminals

#### Scenario: Return from solid
- **WHEN** the user configures glass at 60%, switches to solid and later enables glass successfully
- **THEN** solid is fully opaque and glass restores the saved 60% value

#### Scenario: Unavailable glass
- **WHEN** requested glass falls back to solid
- **THEN** the material control retains the user preference with a concise fallback status and the opacity control is disabled because the visible surface is solid

### Requirement: Validated persistent preferences

The application SHALL persist material, background opacity and background blur independently of theme, accent, reader appearance, decorative settings and workspace snapshots. Missing or invalid material SHALL default to solid; missing, invalid or non-finite opacity SHALL default to 0.75, and finite out-of-range opacity SHALL be clamped to 0.10–1.00. Missing blur SHALL default to enabled.

#### Scenario: First launch or upgrade
- **WHEN** no new material, opacity or blur keys exist
- **THEN** the application retains the existing solid appearance with a saved glass default of 75% and blur enabled, without changing prior theme or workspace preferences

#### Scenario: Restart with glass
- **WHEN** the application restarts with a saved glass preference and opacity 0.60
- **THEN** it applies that preference after native initialization, or uses solid fallback with the preference retained if native material is unavailable

#### Scenario: Corrupt stored values
- **WHEN** stored mode is unknown or opacity is malformed or non-finite
- **THEN** the application uses the specified defaults and remains usable

#### Scenario: Finite out-of-range values
- **WHEN** stored opacity is below 0.10 or above 1.00
- **THEN** it is normalized to the corresponding range boundary

### Requirement: Localized accessible feedback

Material labels, opacity labels and native fallback states SHALL be available in Chinese and English through the existing translation system. Controls SHALL expose keyboard interaction, accessible names, current values and disabled states. Implementation details SHALL NOT appear in normal user-facing status text.

#### Scenario: Locale switch
- **WHEN** the user switches the UI between Chinese and English with appearance settings open
- **THEN** controls and status text update through the current locale without changing appearance preferences or terminal focus

#### Scenario: Keyboard operation
- **WHEN** the user reaches the material controls and opacity slider by keyboard
- **THEN** the user can select a mode and adjust an enabled slider, with an accessible name and announced current percentage

### Requirement: Native outcome remains runtime state

The application SHALL retain pending, effective-material and fallback outcomes as runtime state, SHALL NOT persist them as user preferences, and SHALL initialize usable opaque content before asynchronous material application completes.

#### Scenario: Transient failure does not replace preference
- **WHEN** saved glass fails on the current startup
- **THEN** only the effective runtime state falls back to solid and the saved glass preference remains available for retry or a subsequent startup

#### Scenario: Startup readiness
- **WHEN** the frontend begins before native initialization is complete
- **THEN** it displays usable opaque content and applies glass composition only after a current successful native result
