# Opera sync export

A userscript that exports your bookmarks from [sync.opera.com](https://sync.opera.com) — the web page where Opera shows your synchronized data. It walks through your bookmark folders, lists them (with dates and bookmark counts), and lets you download exactly the folders you want as JSON, HTML, CSV or TXT. The **Import** tab does the reverse: it opens the pages from exported files one by one, each in a new tab.

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
- Runs entirely in your browser. The script makes no network requests and sends your data nowhere. The only Tampermonkey functions it uses are `GM_openInTab` (to open tabs during import) and `unsafeWindow`.
- The panel has two tabs: **Export** and **Import**. It also works on `auth.opera.com`.

### Import tab

- **Open pages from exported files.** Pick one or more files and the script opens their URLs one after another in new tabs.
- **All export formats are supported:** JSON, HTML (Netscape bookmarks), CSV (`title,url,path`) and TXT (one URL per line). The format is detected from the file content, not from the extension, so you can mix formats in one selection. JSON can also be a plain array of URLs or nested `{ path, items: [...] }` nodes. Only `http(s)` links are used.
- **Multiple files at once.** All selected files are merged in the order you picked them, and duplicates are checked across all of them together.
- **Report after loading.** Each file is listed on its own line with its URL count, followed by a combined total, e.g.:

  ```
  • a.json: 120 URLs
  • b.csv: 95 URLs
  Total: 215 URLs from 2 files, 18 duplicates removed → 197 to open.
  ```

  Duplicates are counted only in the total, because per file they depend on the order of the files.
- **Skip duplicate URLs** (on by default). Switching it changes the list right away.
- **Open in background tabs** (on by default). New tabs open in the background, so the page with the panel stays in front.
- **Start / Pause.** Start opens the pages automatically, one after another, without a delay. Pause stops it, and Start continues from the same place.
- **Open next.** Opens a single page per click.
- **Start from #** sets the item to continue from, and **Reset** goes back to the beginning.
- **Progress line.** The status shows `Opened X of Y…`. Under it, one line shows the URL that was just opened (`Opened: …`), or the next one (`Next: …`) when nothing is running. A long URL is cut with `…`; hold or hover over it to see it all.

## Installation

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/) (Violentmonkey should work too).
2. Create a new script, paste the contents of [`opera-sync-export.user.js`](opera-sync-export.user.js), and save it.
3. Confirm the permission Tampermonkey asks for (`GM_openInTab`, needed for the Import tab).
4. Open [sync.opera.com](https://sync.opera.com) and log in.

If you have an older version installed, disable or delete it first, otherwise two copies of the script will run.

## Usage

1. Open the **Bookmarks** section on sync.opera.com. The panel **Opera sync export** appears in the bottom-right corner.
2. Click **Load folders** and wait. The page will visibly jump between folders while the script scans — don't click anything until it finishes (use **Stop** to abort).
3. Tick the folders you want in the list (everything is selected by default).
4. Choose a **format**, optionally tick **Merge selected into one file**, and click **Download**.

Tip: when downloading several files at once, the browser may ask for permission to allow multiple downloads.

### Importing

1. Open the **Import** tab in the panel (on `sync.opera.com` or `auth.opera.com`).
2. Choose one or more exported files (JSON, HTML, CSV, TXT). Read the report: it shows each file and the combined total.
3. Optionally change **Skip duplicate URLs**, **Open in background tabs** and **Start from #**.
4. Click **Start** to open the pages automatically, or **Open next** to open them one by one. Use **Pause** to stop and **Reset** to start again from the first item.

Tip: with a long list, open it in parts using **Start from #**. Opening many tabs at once can slow the browser down.

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
- **Export works only on `sync.opera.com`.** The Import tab does not depend on the page, but the panel is shown only on `sync.opera.com` and `auth.opera.com`.
- **Import position is not saved.** After a page reload you need to choose the files again and continue with **Start from #**.
- **TXT has no titles or folders.** Only URLs are stored in it. Use JSON, HTML or CSV if you want to keep titles and folder names.

## Privacy

The exported files contain your bookmark titles and URLs. Keep them private, and don't share them (or screenshots of the panel) publicly unless you've reviewed the content.

## Troubleshooting

| Problem | What to try |
| --- | --- |
| The panel doesn't appear | Make sure the script is enabled in your userscript manager and reload the page (F5). |
| `Error: View did not change (...)` | The page didn't react to a click in time. Reload and run the scan again, without touching the page during the scan. |
| `Error: Breadcrumb ... not found` | Opera's page markup has probably changed. Open an issue with the breadcrumb HTML (remove any personal data first). |
| A folder you expected is missing | Check the "Skipped (count 0)" list in the status line. |
| Import opens only one tab | Update to the latest version of the script. Tabs are opened with `GM_openInTab`, so make sure you confirmed that permission (reinstall the script if you didn't). |
| `skipped, unreadable file` in the Import report | The file looks like JSON but is not valid, or it could not be read. The other files are still loaded. A file with no `http(s)` links is listed with `0 URLs` instead. |

## Author

**Sperhak** — Sperhak Industries
