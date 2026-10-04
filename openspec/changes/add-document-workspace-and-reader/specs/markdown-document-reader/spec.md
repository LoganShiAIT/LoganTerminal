## ADDED Requirements

### Requirement: Read-only document surfaces

The reader SHALL display local Markdown files and immutable text snapshots in rendered preview and read-only source modes. Switching modes MUST preserve text and reading state. File documents MUST expose explicit reload, show their source path, and leave editing/saving to the existing Review workflow.

#### Scenario: Switch preview and source
- **WHEN** the user switches a document to source mode and back
- **THEN** the source text is unchanged and the preview returns to its previous reading position
- **AND** no file write occurs

#### Scenario: Reload an externally changed file
- **WHEN** the file changes on disk and the user requests reload
- **THEN** the reader updates its content, outline and media together to the newly loaded revision

### Requirement: Shared Markdown and math rendering

The reader SHALL use the existing marked and KaTeX stack and provide one parsed document result for rendered content, heading navigation and code/formula actions. It MUST preserve headings, lists, tables, blockquotes, fenced code and supported math delimiters, keep shell variables inside code literal, preserve raw HTML as text and retain existing OS-routed link behavior. Existing Math/Review preview and terminal math awareness MUST remain compatible with their current rendering contracts.

#### Scenario: Mixed Chinese Markdown and formulas
- **WHEN** a document contains Chinese prose, a table, a matrix formula and code containing $PATH
- **THEN** prose/table/formula render appropriately and $PATH inside the code remains literal
- **AND** the Math sidebar can still render the same formula

#### Scenario: Unsupported formula or raw HTML
- **WHEN** a document contains an invalid formula and a raw HTML element
- **THEN** the invalid formula remains readable as source and the HTML is displayed as text without breaking surrounding content

### Requirement: Outline from document headings

The reader SHALL expose a collapsible outline derived from the same document structure as its preview. Heading targets MUST be unique and stable for unchanged content, including duplicate and Chinese headings. Selecting an outline entry MUST scroll the current preview to its matching heading; heading-like content inside fenced code MUST not enter the outline.

#### Scenario: Duplicate Chinese headings
- **WHEN** a document contains two headings named 结果
- **THEN** the outline contains separate entries and each selects its own heading

#### Scenario: Code contains heading syntax
- **WHEN** a code fence contains a line beginning with a Markdown heading marker
- **THEN** that line remains code and is absent from the document outline

### Requirement: Source-relative local images

The reader SHALL display supported local images referenced by Markdown using absolute paths, file URIs or paths relative to the document's immutable base directory. File documents MUST use their file parent directory; snapshots MUST use their capture-time directory. Image resolution MUST NOT depend on the currently focused terminal cwd. Image failure MUST show an informative placeholder while preserving the rest of the document. Remote images MUST remain explicit external links/placeholders without automatic fetching.

#### Scenario: Resolve a file-relative image
- **WHEN** /project/reports/result.md references ../figures/result.png
- **THEN** the image resolves under /project/figures regardless of the active shell directory

#### Scenario: Keep snapshot media context
- **WHEN** a terminal snapshot captured in directory A references a relative image and the terminal later changes to B
- **THEN** the reader continues resolving the image from A

#### Scenario: Missing or remote image
- **WHEN** a referenced image is missing, relative with no base directory, or remote
- **THEN** an explanatory placeholder appears and other Markdown remains readable
- **AND** a remote image causes no automatic network request

### Requirement: Reading actions preserve source

The reader SHALL provide code-block copy, block-formula TeX copy and local image enlargement through explicit controls. Copies MUST preserve the original code or TeX content rather than rendered text, and feedback MUST not change document state.

#### Scenario: Copy code and math
- **WHEN** the user copies a multiline code block or a block formula
- **THEN** the clipboard receives its original code or TeX body with internal whitespace preserved
- **AND** the document source remains unchanged

#### Scenario: Enlarge a local image
- **WHEN** the user activates a rendered local image
- **THEN** the existing image preview/lightbox opens for that image and can be dismissed back to the document

### Requirement: Bounded revision-aware loading

The reader SHALL refuse file or snapshot input larger than 1 MiB UTF-8 before parsing, preserve the existing text/binary restrictions, and perform file I/O outside the UI thread. Text and media responses MUST apply only to their current document revision. Reload failure MUST preserve the previously loaded content with an error indication; initial failure MUST show a retryable document error.

#### Scenario: Reject oversized input
- **WHEN** a file or captured snapshot exceeds 1 MiB UTF-8
- **THEN** the reader explains the size limit without rendering silently truncated content

#### Scenario: Ignore stale asynchronous results
- **WHEN** an old image or text request completes after the document closes or a newer reload completes
- **THEN** the stale response does not recreate the closed document or overwrite the current revision

#### Scenario: Failed reload keeps readable content
- **WHEN** a readable file document is reloaded after its file becomes unavailable
- **THEN** the earlier content stays visible with a reload error and retry remains available

### Requirement: Content-based rendering work

The reader SHALL reuse parsing results while its source revision and render-relevant context are unchanged. Terminal output in other panes, focus changes and window resizing MUST NOT repeatedly reparse an unchanged full document. All content accepted by the current size limit MUST remain reachable; this release MUST NOT promise unmeasured virtualized-document performance.

#### Scenario: Agent output during reading
- **WHEN** a background Agent emits repeated output while an unchanged document is open
- **THEN** the document remains interactive and its full Markdown parsing is not repeated solely because of that output
