# USPS Address CSV Formatter

A premium dark-mode glassmorphism web application that cleans and standardizes mailing addresses to USPS Publication 28 standards using Gemini 2.5 Flash and JSON structured outputs.

## Features
- **Modern UI**: Fully responsive, dark-mode glassmorphism design.
- **USPS Standard Formatting**: Clean and format recipient name, street address, city, state, and ZIP code.
- **Gemini 2.5 Flash Integration**: Uses root-level system instructions and structured JSON response schemas for perfect data parsing.
- **Safe CSV Handling**: Streams input files via PapaParse and packages results securely with double-quote escaping.

## Getting Started

1. Clone this repository.
2. Start a local HTTP server inside the project directory:
   ```bash
   python3 -m http.server 8000
   ```
3. Open `http://localhost:8000` in your web browser.
4. Input your Google AI Studio API Key, select your uncleaned CSV file, and click **Process CSV**.
5. Download the formatted CSV once processing is complete.
