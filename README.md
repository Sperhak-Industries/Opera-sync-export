# Opera sync export

A userscript that exports your bookmarks from [sync.opera.com](https://sync.opera.com) — the web page where Opera shows your synchronized data. It walks through your bookmark folders, lists them (with dates and bookmark counts), and lets you download exactly the folders you want as JSON, HTML, CSV or TXT.

Made by **Sperhak** ([Sperhak Industries](https://github.com/Sperhak-Industries/)).

## Features

- One click to load all bookmark folders — no need to open them manually.
- Folders are listed with checkboxes, the bookmark count, and a date parsed from the folder name (newest first).
- Folders showing a count of `0` are skipped, which makes scanning much faster.
- Export formats:
  - **JSON** — flat array of `{ title, url, path }`
  - **HTML** — standard Netscape bookmark file (UTF-8), importable into Opera, Chrome, Firefox, Edge, etc.
  - **CSV** — `title,url,path` (UTF-8 with BOM, opens correctly in Excel)
  - **TXT** — URLs only, one per line
- Download each selected folder as its own file, or merge the selection into a single file.
- Files are named by the date found in the folder name, e.g. `opera_bookmarks_2026-11-13.json`.
- Collapsible dark panel, a **Stop** button during scanning, and a status line with progress.
- Runs entirely in your browser. The script makes no network requests and sends your data nowhere (`@grant none`).

## Installation

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/) (Violentmonkey should work too).
2. Create a new script, paste the contents of [`opera-sync-export.user.js`](opera-sync-export.user.js), and save it.
3. Open [sync.opera.com](https://sync.opera.com) and log in.

## Usage

1. Open the **Bookmarks** section on sync.opera.com. The panel **Opera sync export** appears in the bottom-right corner.
2. Click **Load folders** and wait. The page will visibly jump between folders while the script scans — don't click anything until it finishes (use **Stop** to abort).
3. Tick the folders you want in the list (everything is selected by default).
4. Choose a **format**, optionally tick **Merge selected into one file**, and click **Download**.

Tip: when downloading several files at once, the browser may ask for permission to allow multiple downloads.

## How it works

sync.opera.com keeps only the currently opened folder in memory, so all bookmarks cannot be read at once. The script therefore automates what you would do by hand:

1. Goes to the root of the bookmark tree using the breadcrumb.
2. Clicks into each folder, waits until the list stops changing, reads the bookmark rows (title and URL) from the page, and goes back through the breadcrumb.
3. Repeats recursively for sub-folders.

Folders whose item counter shows `0` are not opened. If a scan with skipping finds nothing at all, the script automatically retries without skipping. The status line lists which folders were skipped, so you can verify nothing important was missed.

## Limitations

- **Bookmarks only.** History, passwords, open tabs and speed dials are not exported.
- **Depends on the page's markup.** The script locates elements by class-name fragments (`_clickable_`, `_breadcrumbsContainer_`, `_itemsCount_`, `_title_`, `_url_`). If Opera changes its page structure, the script may need an update.
- **Dates come from folder names.** A date is recognised in `D. M. YYYY` or `YYYY-MM-DD` form. Folders without a date are named after the folder title.
- **Item counters.** Skipping relies on the counter shown next to a folder. If you suspect a skipped folder had content, check the "Skipped" list in the status line.
- The result is not stored between page reloads — export before refreshing.

## Privacy

The exported files contain your bookmark titles and URLs. Keep them private, and don't share them (or screenshots of the panel) publicly unless you've reviewed the content.

## Troubleshooting

| Problem | What to try |
| --- | --- |
| The panel doesn't appear | Make sure the script is enabled in your userscript manager and reload the page (F5). |
| `Error: View did not change (...)` | The page didn't react to a click in time. Reload and run the scan again, without touching the page during the scan. |
| `Error: Breadcrumb ... not found` | Opera's page markup has probably changed. Open an issue with the breadcrumb HTML (remove any personal data first). |
| A folder you expected is missing | Check the "Skipped (count 0)" list in the status line.
## Author

**Sperhak** — Sperhak Industries
