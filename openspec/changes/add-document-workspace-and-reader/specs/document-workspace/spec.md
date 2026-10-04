## ADDED Requirements

### Requirement: Mixed workspace tabs

The application SHALL provide one ordered workspace navigation containing terminal tabs and document tabs. Each tab MUST display its type and title, support activation, closing and reordering, and participate in workspace cycling and numeric shortcuts. Document tabs MUST NOT appear as terminals in Agent dashboards, broadcast targets or worktree operations.

#### Scenario: Navigate mixed tabs
- **WHEN** a workspace contains terminal A, document B and terminal C
- **THEN** tab cycling and numeric navigation follow that order and activating B displays the document
- **AND** B is absent from Agent and broadcast projections

#### Scenario: Reorder a document
- **WHEN** the user drags B before A
- **THEN** navigation reflects the new order without creating or closing a PTY

### Requirement: Terminal lifetime during document navigation

The application SHALL preserve mounted terminal instances, PTY identities, shell processes and scrollback while activating documents, attaching or resizing readers, changing reader appearance or returning to a terminal. Only an explicit terminal close or application teardown MUST invoke the existing terminal disposal behavior.

#### Scenario: Read while a command runs
- **WHEN** the user opens and closes a document while a terminal command is running
- **THEN** the same terminal session continues producing output and its earlier scrollback remains available
- **AND** document navigation emits no extra PTY spawn or kill

### Requirement: Companion reader beside a terminal

The application SHALL allow one document to be attached to the right of a terminal workspace tab with a draggable divider. Closing the companion MUST preserve the document tab and terminal; closing the document tab MUST detach its companion references; closing a terminal MUST preserve independently open document tabs. Terminal pane zoom MUST operate within the terminal region.

#### Scenario: Resize and dismiss companion
- **WHEN** the user attaches a document, resizes its reading region and dismisses it
- **THEN** terminal dimensions update without restarting the session and the document remains in workspace navigation

#### Scenario: Close the attached document
- **WHEN** the user closes a document tab referenced by a terminal companion
- **THEN** that companion disappears and the terminal remains alive

### Requirement: Focus-aware command targets

The application SHALL distinguish document focus from terminal focus. Terminal-only input, paste, clear, scrollback search, prompt navigation, split, broadcast, asset insertion, Shift-drop and finder insert/cd actions MUST NOT act on a hidden or unfocused terminal. Close commands MUST target the focused document tab, companion or terminal pane as appropriate. Overlay dismissal MUST restore the previous surface focus.

#### Scenario: Reader does not target the last terminal
- **WHEN** a standalone document has focus and the user invokes a terminal-only command or clicks a clipboard asset to insert it
- **THEN** no data or terminal-only action is sent to the previously active terminal
- **AND** the unavailable action is disabled, omitted or explained in the current UI

#### Scenario: Close a focused companion
- **WHEN** a companion reader is focused and the user presses the existing close shortcut
- **THEN** only the companion region closes and the terminal pane is not killed

#### Scenario: Return focus after an overlay
- **WHEN** the user opens and dismisses the command palette from a document
- **THEN** focus returns to that document without focusing a background xterm

### Requirement: Explicit terminal creation and navigation

The application SHALL keep explicit terminal creation and Agent launch available from documents, using the document source directory when available and the last terminal context otherwise. Launchers, fleet/worktree opening, attention routing and dashboard jumps MUST activate their destination terminal workspace tab, including an already existing tab.

#### Scenario: Launch beside a file context
- **WHEN** the user explicitly creates a terminal while reading a local Markdown file
- **THEN** the new terminal starts in that file's directory and becomes the active workspace tab

#### Scenario: Jump to an existing Agent
- **WHEN** a document is active and the user selects an existing Agent pane in the dashboard
- **THEN** its terminal workspace tab is displayed and that pane gains focus

### Requirement: Explicit document opening and reuse

The application SHALL expose document reading actions in the file tree, finder, Review panel and command palette without replacing existing reveal, insert, cd or attachment actions. Opening the same canonical file through aliases MUST reuse its document record. Promoting an unsaved Review draft or Math scratch MUST create a labeled immutable snapshot, preserve the original draft and perform no file write.

#### Scenario: Open the same file twice
- **WHEN** two supported opening actions refer to the same canonical Markdown file
- **THEN** the application activates the existing file document rather than creating duplicate records

#### Scenario: Promote an unsaved draft
- **WHEN** a Review draft differs from disk and the user opens it in the main reader
- **THEN** the displayed text matches the draft and is marked as an unsaved draft snapshot
- **AND** the file and Review editor contents are unchanged

### Requirement: Manual terminal text capture

The application SHALL open terminal text in a reader only after an explicit capture action, preferring a nonempty selection and otherwise using the existing last-command output markers. The snapshot MUST retain captured text, source label, capture time and capture-time directory. Without usable text, the application MUST explain how to select text and MUST NOT create an empty document or claim a complete AI answer.

#### Scenario: Capture a terminal selection
- **WHEN** the user captures selected Markdown from a terminal
- **THEN** a read-only snapshot opens with the selected text and its source directory
- **AND** later terminal output or cwd changes do not modify the snapshot

#### Scenario: Last output is unavailable
- **WHEN** the user requests capture without a selection and no last-output markers are available
- **THEN** the application offers a select-and-retry message without guessing terminal content

### Requirement: Workspace restoration and legacy compatibility

The application SHALL persist mixed ordering, active selection, file document paths, preview mode and file companion layouts in a versioned workspace snapshot. Restoration MUST create fresh shells from terminal directory/layout snapshots, exclude temporary text snapshots and PTY/Agent execution state, and accept the existing legacy terminal snapshot. It MUST cap restored terminals at nine with existing pane limits, and restored file documents at twelve. Invalid new data MUST fall back to the valid legacy layout; missing files MUST not block other tabs. The legacy terminal key MUST remain usable for rollback.

#### Scenario: Restore mixed layout
- **WHEN** the application restarts after a terminal with a file companion and a file document tab were saved
- **THEN** it restores their ordering and companion geometry, loads the file document and creates fresh shells
- **AND** it does not restart any previously launched Agent command

#### Scenario: Migrate a legacy snapshot
- **WHEN** only the old directory/pane snapshot is available
- **THEN** the application reconstructs equivalent terminal workspace tabs without duplicate shells

#### Scenario: Exclude temporary and invalid references
- **WHEN** a saved layout contains temporary snapshot companions or the new workspace snapshot is malformed
- **THEN** temporary companions are omitted and malformed workspace data falls back to the valid legacy terminal layout

#### Scenario: Restore a missing document
- **WHEN** a persisted Markdown file no longer exists
- **THEN** its tab shows a closable retryable error and other document and terminal tabs remain usable
