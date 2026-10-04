## ADDED Requirements

### Requirement: Single base background per region

The application SHALL derive glass shell and terminal base surfaces from the current theme and one background opacity value. Each visible region SHALL receive its base tint once; transparent layout ancestors SHALL NOT add a second full-region tint. Foreground text and icons SHALL remain opaque.

#### Scenario: Unified glass background
- **WHEN** glass is effective with background opacity 0.75
- **THEN** shell regions and terminal default regions use a single base tint with alpha 0.75 without an overlapping ancestor tint, while text and icons retain their existing foreground colors

#### Scenario: Fully opaque setting
- **WHEN** glass background opacity is 1.00
- **THEN** the base surfaces are opaque and may conceal the native blur without reporting material failure

#### Scenario: Solid or fallback mode
- **WHEN** solid is effective through user selection or native fallback
- **THEN** shell and terminal backgrounds are opaque and use their current theme colors

### Requirement: Transparent terminal defaults with preserved ANSI content

The terminal SHALL support default background transparency from its initial creation, SHALL draw the terminal base tint only once, and SHALL preserve the existing foreground palette, explicit ANSI background colors, cursor and selection behavior in both solid and glass modes.

#### Scenario: Ordinary terminal output
- **WHEN** ordinary text without explicit ANSI background colors is printed in glass mode
- **THEN** the default background reveals the pane tint and system material while the text remains clear

#### Scenario: Colored TUI output
- **WHEN** a terminal application prints explicit ANSI background colors or the user selects text
- **THEN** those colors, cursor and selection feedback remain readable and are not faded by container opacity or a blur filter

#### Scenario: Rendering fallback
- **WHEN** WebGL is unavailable or its context is lost
- **THEN** the existing renderer fallback retains the same background policy and terminal functionality

### Requirement: Appearance changes preserve terminal lifecycle

Changes to material, opacity, theme or accent SHALL update existing terminal instances without disposing, reopening or replacing them, killing or creating PTYs, clearing scrollback, or changing workspace focus, layouts and reader associations. Hidden panes SHALL receive the same appearance updates.

#### Scenario: Live terminal changes
- **WHEN** the user changes appearance while a terminal command is running
- **THEN** the same PTY and terminal instance continue receiving output, scrollback and selection are preserved, and pane layout and focus remain unchanged

#### Scenario: Background panes
- **WHEN** appearance changes while another tab or a zoomed-away pane is hidden
- **THEN** showing that pane reveals the latest appearance with its existing session and output history

#### Scenario: Companion document
- **WHEN** the user switches glass appearance with a document attached beside a terminal
- **THEN** the companion association, divider ratio, reader scroll position and terminal process remain intact

### Requirement: Readable document and overlay surfaces

Glass material SHALL NOT make document reading surfaces transparent. Reader appearances including follow-theme SHALL retain opaque reading backgrounds. Settings and interactive overlays SHALL have background opacity of at least 0.92 and SHALL preserve their existing focus and dismissal behavior.

#### Scenario: Reader appearances
- **WHEN** paper, dark or follow-theme reading is displayed while glass is effective
- **THEN** the document body, outline, code and formulas remain on their reading backgrounds and reader colors do not change with the glass opacity slider

#### Scenario: Interactive overlay
- **WHEN** the user opens settings, command palette, file search, Agent overview or worktree controls at minimum glass opacity
- **THEN** the overlay remains readable with at least 0.92 background opacity and keyboard focus returns through the existing workspace routing when dismissed

### Requirement: Quiet glass decoration

Glass mode SHALL reduce grid and ambient glow strength and use consistent pane radius, subtle borders and shadows. Switching material SHALL NOT rewrite ambient motion, CRT, animation speed or reduced-motion preferences. The application SHALL NOT add a full-pane backdrop blur to every terminal.

#### Scenario: Glass decoration
- **WHEN** glass becomes effective
- **THEN** grid and ambient glow are visibly quieter than solid mode and pane borders remain distinguishable without blurring terminal contents

#### Scenario: Preference restoration
- **WHEN** the user toggles glass and returns to solid
- **THEN** the prior ambient, CRT and animation settings remain saved and solid decoration strength is restored

#### Scenario: Ambient disabled or motion reduced
- **WHEN** ambient motion is disabled or the system requests reduced motion
- **THEN** glass mode does not enable decorative motion contrary to those settings
