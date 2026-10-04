## ADDED Requirements

### Requirement: Native glass material

The application SHALL provide glass material using macOS Vibrancy and Windows Acrylic on supported systems when background blur is enabled. Native effects SHALL be managed independently of frontend background opacity and SHALL NOT be reconfigured for slider movement or terminal output.

#### Scenario: Glass on macOS
- **WHEN** the user selects glass with background blur enabled on a supported macOS desktop
- **THEN** the application applies a native behind-window Vibrancy material and permits the frontend default background to reveal it

#### Scenario: Glass on Windows
- **WHEN** the user selects glass with background blur enabled on a supported Windows desktop
- **THEN** the application applies Acrylic and permits the frontend default background to reveal the system material

#### Scenario: Opacity changes without native recreation
- **WHEN** the user changes glass background opacity while the material remains glass
- **THEN** only background composition changes and the existing native effect is not recreated

### Requirement: Optional background blur

Glass mode SHALL let the user disable the native frost. Requesting glass with blur disabled SHALL clear any existing native material, SHALL keep the effective surface glass so the frontend tint still composites over the transparent window, and SHALL report the no-material state. Re-enabling blur SHALL reapply the native material without touching terminal instances, PTYs or layout. Unsupported platforms SHALL still fall back to solid regardless of the blur flag.

#### Scenario: Glass without frost
- **WHEN** the user disables background blur while glass is effective
- **THEN** the native material is removed, the desktop shows through the window unblurred, and shell and terminal tints remain at the chosen opacity

#### Scenario: Re-enabling the frost
- **WHEN** the user enables background blur again after using clear glass
- **THEN** the native material is reapplied exactly once and terminal instances, output history and layout are unchanged

#### Scenario: Clear glass preference persists
- **WHEN** the application restarts with glass and background blur disabled
- **THEN** the window composes with the frontend tint alone and no native material is applied

### Requirement: Material cleanup and idempotence

The application SHALL apply and clear native materials on the platform UI thread, SHALL avoid stacking duplicate native effects, and SHALL clear an existing effect when selecting solid. Repeated application of an already configured material SHALL be idempotent.

#### Scenario: Return to solid
- **WHEN** the user switches from glass to solid
- **THEN** the adapter clears the native glass effect and the frontend displays a fully opaque background

#### Scenario: Repeated selection
- **WHEN** glass is requested repeatedly for the same window
- **THEN** no additional native effect layers or window instances are created

### Requirement: Explicit solid fallback

The application SHALL distinguish requested material from effective material. Unsupported platforms, failed native application and initialization timeout SHALL use an opaque solid surface and a concise status. A successful API call SHALL NOT be represented as proof of independently verified visible blur.

#### Scenario: Unsupported environment
- **WHEN** glass is requested on Linux or in an ordinary browser preview
- **THEN** the effective appearance is solid, the glass preference remains saved, and the settings explain that native glass is unavailable in the current environment

#### Scenario: Native failure
- **WHEN** applying glass fails
- **THEN** the effective appearance becomes solid, the application remains usable, and settings show a readable failure state with a manual retry through the glass control

#### Scenario: Initialization timeout
- **WHEN** a startup native request has not completed within 3 seconds
- **THEN** the visible window remains usable with opaque solid surfaces and the frontend stops waiting to reveal usable content

#### Scenario: Cleanup failure
- **WHEN** clearing a native effect fails while solid is selected
- **THEN** frontend surfaces remain fully opaque and the adapter reports the cleanup failure rather than claiming successful cleanup

### Requirement: Latest requested mode wins

The application SHALL serialize native material operations, ignore obsolete frontend results, and reconcile the native material with the latest request after a delayed response. Invalid mode input SHALL leave the last valid native state unchanged.

#### Scenario: Rapid toggles
- **WHEN** the user selects glass and then solid before the first native operation completes
- **THEN** the final native configuration and effective frontend appearance both correspond to solid and the earlier glass result does not override them

#### Scenario: Late response after timeout
- **WHEN** a timed-out native request completes after the user has selected a different mode
- **THEN** the stale response does not update effective frontend tokens and the latest requested mode is reapplied as needed

#### Scenario: Invalid mode
- **WHEN** the native command receives an unknown material mode
- **THEN** it returns a parameter error without modifying the current valid native configuration
