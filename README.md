# InDesign CSV Cleaner Prompt

A premium dark-mode web application that provides a copy-ready ChatGPT cleaning prompt, previews pasted ChatGPT JSON output, and exports an InDesign-ready CSV.

## Features
- **Modern UI**: Fully responsive, dark-mode glassmorphism design.
- **Prompt First**: Shows the ChatGPT cleaning prompt directly on the page for easy copy/paste.
- **InDesign CSV Output**: Exports `Envelope Names`, `Address`, `apt`, `City`, `State`, `Zipcode`, and `Country` columns as a UTF-8 CSV with CRLF line endings.
- **Output Review**: Shows the cleaned rows in a preview table before downloading.
- **Normal Capitalization**: Keeps names and addresses readable for invitations instead of forcing all caps.
- **ChatGPT Handoff**: Accepts ChatGPT's JSON result back in the app.
- **Multi-Chunk Paste**: Combines multiple complete ChatGPT JSON batches in order.
- **Output Validation**: Blocks empty or unrecognized rows before CSV export.
- **Save Picker**: Uses the browser's save dialog when available so the CSV can be renamed and saved to a chosen folder.
- **Safe CSV Handling**: Packages results with double-quote escaping for CSV compatibility.
- **Static Friendly**: Runs as static files with no API key or backend required.

## Getting Started

1. Clone this repository.
2. Start a local HTTP server inside the project directory:
   ```bash
   python3 -m http.server 8000
   ```
3. Open `http://localhost:8000` in your web browser.
4. Copy the prompt into ChatGPT with the customer's address list.
5. Paste one or more complete ChatGPT JSON outputs back into the app.
6. Review the cleaned rows, then save the formatted CSV for InDesign.
