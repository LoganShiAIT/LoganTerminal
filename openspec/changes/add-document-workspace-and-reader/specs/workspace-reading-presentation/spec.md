## ADDED Requirements

### Requirement: Hierarchical workspace surfaces

The application SHALL present clearly separated navigation, terminal content and document content using consistent spacing, quiet borders and rounded content surfaces. Terminal, file-document and snapshot tabs MUST have distinguishable icons and text labels. Active focus MUST be evident without reducing terminal text readability or changing ANSI colors.

#### Scenario: Compare content types
- **WHEN** terminal, Markdown-file and snapshot tabs are visible
- **THEN** their type and active state are recognizable from icons/text/focus styling without relying only on color

### Requirement: Dedicated reading typography

The reader SHALL use a centered reading column, proportional body typography, Chinese font fallback and clear heading hierarchy. Initial design values MUST be 760 CSS px maximum body width, responsive 16–48px side margins, 16px body text with 1.75 line height, and H1/H2/H3 sizes of 2/1.5/1.25 times body size. Code MUST retain monospace styling. Formula, table and code overflow MUST scroll locally rather than force document-wide horizontal overflow or unreadably shrink content.

#### Scenario: Read a Chinese technical report
- **WHEN** the user opens Chinese prose with headings, matrices, tables and code
- **THEN** headings and sections have distinct visual hierarchy, body text stays in the centered column and code uses a monospace font

#### Scenario: Wide content in a narrow reader
- **WHEN** a matrix, table or code line exceeds the available column width
- **THEN** that content region can scroll horizontally while ordinary paragraphs remain readable without document-wide horizontal scrolling

### Requirement: Independent reader appearance

The application SHALL provide follow-theme, paper and dark reader appearance settings with follow-theme as the default. Appearance MUST apply immediately, persist across restarts and affect only reader surfaces. Changing it MUST NOT alter terminal font size, ANSI palette, the global theme or stored CRT/ambient preferences. Reader content MUST remain free of CRT overlays and obstructing ambient effects.

#### Scenario: Paper reader beside a dark terminal
- **WHEN** the user selects paper while a dark terminal is visible beside the document
- **THEN** the document has a light paper surface with dark text and the terminal keeps its prior appearance and session

#### Scenario: Follow the application theme
- **WHEN** follow-theme is selected and the application changes between light and dark themes
- **THEN** reader colors follow the selected application theme without requiring reopening the document

### Requirement: Responsive companion and outline

The application SHALL remain usable at its existing 800×500 minimum window size. Companion reading MUST temporarily become a full-width document surface when the available main region is below 760 CSS px, expose a return-to-terminal action and restore the saved split on widening. The outline MUST default to collapsed, use a 200px navigation column where space permits, and use a dismissible overlay when that column would leave less than 320 CSS px for body content.

#### Scenario: Shrink and widen a companion workspace
- **WHEN** the user shrinks the main region below the companion threshold and then widens it
- **THEN** the narrow state presents a full-width reader with a terminal return action and the wider state restores the same companion document and divider ratio
- **AND** the terminal process remains alive throughout

#### Scenario: Open outline at minimum width
- **WHEN** opening the outline would leave less than 320 CSS px for the reading column
- **THEN** the outline opens as a dismissible overlay and closing it returns focus to the reader

### Requirement: Keyboard and localized reading controls

The reader SHALL support ordinary text selection/copy, visible keyboard focus, labeled controls and existing Chinese/English internationalization. New reading actions MUST be reachable through the command palette and visible UI without stealing existing terminal shortcut meanings when the terminal is focused. Motion MUST respect the user's reduced-motion setting.

#### Scenario: Keyboard reading in Chinese
- **WHEN** Chinese UI is active and the user navigates reader controls by keyboard
- **THEN** controls have Chinese labels, visible focus and working preview/source, outline and copy actions
- **AND** copying selected document text does not inject data into a terminal

#### Scenario: Preserve terminal shortcuts
- **WHEN** the terminal is focused after the reader has been opened
- **THEN** existing terminal search, pane split and Math preview shortcuts retain their terminal behavior
