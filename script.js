// script.js - InDesign CSV Cleaner prompt workflow

const OUTPUT_COLUMNS = [
  "Envelope Names",
  "Address",
  "apt",
  "City",
  "State",
  "Zipcode",
  "Country"
];

const CLEANING_PROMPT = `You are cleaning a customer guest/address list for an InDesign CSV import.

Return only a valid JSON object. Do not include markdown, explanations, or extra fields.

The object must have one property named "rows". "rows" must be an array.

Use exactly these fields for every row object:
- "Envelope Names"
- "Address"
- "apt"
- "City"
- "State"
- "Zipcode"
- "Country"

Formatting rules:
- Use normal human capitalization, not all caps.
- Preserve titles and family wording when present, such as "Mr. and Mrs.", "Dr.", "Ms.", "& Family", and "and Guest".
- Correct title typos. For example, change "Mr.s" or "MRS" to "Mrs.".
- Street addresses should look natural, such as "2816 61st Avenue SE", "145 Sailors Landing Ct", or "11018 Old St. Augustine Rd".
- Check that the street, city, state, and ZIP/postal code combination appears plausible and real. Correct obvious misspellings only when you are confident. Do not invent a new address when uncertain; preserve the customer's address text as closely as possible.
- Put apartment, suite, unit, floor, or similar secondary info in "apt". Keep it readable, such as "Apartment 32" or "Suite 102-335".
- Put city only in "City", with normal capitalization, such as "San Francisco" or "St. Augustine".
- Put state/province only in "State". Always convert US state names to the 2-letter postal abbreviation, such as "Florida" to "FL" or "California" to "CA". Keep Canadian provinces readable if present.
- Put postal code only in "Zipcode".
- Put country in "Country" only when it is outside the United States or explicitly provided.
- Leave a field as an empty string when the information is missing.
- Fix obvious spacing, punctuation, and capitalization issues.
- Keep every input row in the same order.
- Ignore completely blank rows, hidden formatting-only rows, and unused Excel rows after the last guest or address.
- Do not create output rows just because cells are formatted or included in Excel's used range.

If the complete result is too long for one response:
- Split it into numbered batches of no more than 40 rows.
- Make every batch a complete, independent JSON object in the same {"rows":[...]} format.
- Do not repeat or skip rows between batches.
- The user will paste all batch objects into the app one after another, so do not try to connect the JSON objects.

Clean the customer address list I paste below.`;

let latestCsvContent = "";
let latestRows = [];

const statusDiv = document.getElementById("status");
const downloadBtn = document.getElementById("downloadBtn");
const outputPanel = document.getElementById("outputPanel");
const outputSummary = document.getElementById("outputSummary");
const outputBody = document.getElementById("outputBody");
const generatedPrompt = document.getElementById("generatedPrompt");
const copyGeneratedPromptBtn = document.getElementById("copyGeneratedPromptBtn");
const pastedJsonInput = document.getElementById("pastedJsonInput");
const previewPastedBtn = document.getElementById("previewPastedBtn");
const pasteFeedback = document.getElementById("pasteFeedback");
const toast = document.getElementById("toast");

generatedPrompt.value = CLEANING_PROMPT;

function setStatus(message) {
  statusDiv.textContent = message;
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3500);
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function normalizedKey(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

const COLUMN_ALIASES = {
  "Envelope Names": ["envelopenames", "envelopename", "name", "names", "guestnames", "guestname"],
  "Address": ["address", "adress", "streetaddress", "street"],
  "apt": ["apt", "apartment", "unit", "suite", "address2", "secondaryaddress"],
  "City": ["city", "town"],
  "State": ["state", "province", "stateprovince"],
  "Zipcode": ["zipcode", "zip", "postalcode", "postcode"],
  "Country": ["country"]
};

function normalizeOutputRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Every row must be a JSON object with address fields.");
  }

  const valuesByKey = new Map(
    Object.entries(row).map(([key, value]) => [normalizedKey(key), value])
  );
  const normalized = {};

  OUTPUT_COLUMNS.forEach(column => {
    const alias = COLUMN_ALIASES[column].find(key => valuesByKey.has(key));
    const value = alias ? valuesByKey.get(alias) : "";
    normalized[column] = String(value ?? "").trim();
  });

  if (!OUTPUT_COLUMNS.some(column => normalized[column])) {
    throw new Error("A pasted row had no recognized address fields. Check the ChatGPT output and try again.");
  }
  if (!normalized["Envelope Names"] && !normalized.Address) {
    throw new Error("A pasted row has neither an envelope name nor a street address. Check the ChatGPT output and try again.");
  }

  return normalized;
}

function extractJsonDocuments(text) {
  const source = text
    .replace(/```json/gi, "")
    .replace(/```/g, "");
  const documents = [];
  const stack = [];
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (stack.length === 0) {
      if (char === "{" || char === "[") {
        start = index;
        stack.push(char);
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }

    if (char === "}" || char === "]") {
      const expected = char === "}" ? "{" : "[";
      if (stack.pop() !== expected) {
        const candidate = source.slice(start, index + 1);
        if (/"rows"\s*:/i.test(candidate)) {
          throw new Error("One JSON chunk has mismatched brackets. Copy that complete chunk from ChatGPT again.");
        }
        stack.length = 0;
        start = -1;
        inString = false;
        escaped = false;
        continue;
      }
      if (stack.length === 0 && start !== -1) {
        documents.push(source.slice(start, index + 1));
        start = -1;
      }
    }
  }

  if (stack.length > 0 || inString) {
    const candidate = start === -1 ? "" : source.slice(start);
    if (/"rows"\s*:/i.test(candidate)) {
      throw new Error("The last JSON chunk is incomplete. Paste the rest of that ChatGPT response and try again.");
    }
  }

  return documents;
}

function parseCleanedOutput(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Paste the JSON output from ChatGPT first.");
  }

  const documents = extractJsonDocuments(trimmed);
  if (documents.length === 0) {
    throw new Error('No complete JSON was found. It should contain {"rows":[...]} or [...].');
  }

  const rows = [];
  let chunkCount = 0;
  documents.forEach((document, index) => {
    let parsed;
    try {
      parsed = JSON.parse(document);
    } catch (err) {
      if (/"rows"\s*:/i.test(document)) {
        throw new Error(`JSON chunk ${index + 1} is not valid. Copy that complete chunk from ChatGPT again.`);
      }
      return;
    }

    if (Array.isArray(parsed) && parsed.every(row => row && typeof row === "object" && !Array.isArray(row))) {
      rows.push(...parsed);
      chunkCount += 1;
      return;
    }
    if (parsed && Array.isArray(parsed.rows)) {
      rows.push(...parsed.rows);
      chunkCount += 1;
      return;
    }
  });

  if (chunkCount === 0) {
    throw new Error('No complete address JSON was found. It should contain {"rows":[...]} or an array of row objects.');
  }
  if (rows.length === 0) {
    throw new Error('The JSON contains zero rows. Ask ChatGPT to return the cleaned addresses inside "rows".');
  }

  return { rows, chunkCount };
}

function buildCSV(rows) {
  const header = OUTPUT_COLUMNS.map(csvEscape).join(",");
  const lines = rows.map(row => OUTPUT_COLUMNS.map(column => csvEscape(row[column])).join(","));
  return `\uFEFF${[header, ...lines].join("\r\n")}`;
}

function resetOutput() {
  latestCsvContent = "";
  latestRows = [];
  downloadBtn.disabled = true;
  outputPanel.hidden = true;
  outputBody.replaceChildren();
  outputSummary.textContent = "";
}

function setPasteFeedback(message, type = "") {
  pasteFeedback.textContent = message;
  pasteFeedback.className = `paste-feedback${type ? ` ${type}` : ""}`;
}

function makeCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value || "";
  return cell;
}

function renderOutputPreview(rows) {
  outputBody.replaceChildren();
  rows.forEach(row => {
    const tableRow = document.createElement("tr");
    tableRow.append(
      makeCell(row["Envelope Names"]),
      makeCell(row.Address),
      makeCell(row.apt),
      makeCell(row.City),
      makeCell(row.State),
      makeCell(row.Zipcode),
      makeCell(row.Country)
    );
    outputBody.appendChild(tableRow);
  });

  outputSummary.textContent = `${rows.length} row${rows.length === 1 ? "" : "s"} ready for InDesign.`;
  outputPanel.hidden = false;
  downloadBtn.disabled = false;
}

async function saveCsv() {
  if (!latestRows.length) {
    setStatus("Preview the cleaned output before saving.");
    setPasteFeedback("Preview valid address rows before saving.", "error");
    return;
  }

  latestCsvContent = buildCSV(latestRows);
  const suggestedName = "indesign_addresses.csv";

  if (window.showSaveFilePicker) {
    let writable;
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: "CSV file",
            accept: { "text/csv": [".csv"] }
          }
        ]
      });
      writable = await handle.createWritable();
      await writable.write(latestCsvContent);
      await writable.close();
      setStatus("Saved. The CSV is ready for InDesign.");
      showToast("Saved CSV successfully.");
      return;
    } catch (err) {
      if (err.name === "AbortError") {
        setStatus("Save canceled.");
        return;
      }
      if (writable && typeof writable.abort === "function") {
        await writable.abort().catch(() => {});
      }
      console.error("Save picker failed", err);
      setStatus("The save dialog failed, so a browser download will be used instead.");
    }
  }

  const blob = new Blob([latestCsvContent], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus("Saved. If your browser asked where to put it, choose the folder and filename there.");
  showToast("CSV download started.");
}

copyGeneratedPromptBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(generatedPrompt.value);
    setStatus("Prompt copied. Paste it into ChatGPT with the customer address list.");
    showToast("Prompt copied.");
  } catch (err) {
    generatedPrompt.focus();
    generatedPrompt.select();
    setStatus("Prompt selected. Copy it from the text box.");
  }
});

downloadBtn.addEventListener("click", saveCsv);

previewPastedBtn.addEventListener("click", () => {
  try {
    resetOutput();
    setPasteFeedback("");
    const parsed = parseCleanedOutput(pastedJsonInput.value);
    const rows = parsed.rows.map(normalizeOutputRow);
    latestRows = rows;
    latestCsvContent = buildCSV(latestRows);
    renderOutputPreview(latestRows);
    const chunkLabel = parsed.chunkCount === 1 ? "1 JSON chunk" : `${parsed.chunkCount} JSON chunks`;
    const message = `${rows.length} rows combined from ${chunkLabel}. Review them, then save the CSV.`;
    setPasteFeedback(message, "success");
    setStatus(message);
  } catch (err) {
    console.error("Pasted output error", err);
    const message = err.message || "Could not read the pasted output.";
    setPasteFeedback(message, "error");
    setStatus(message);
    showToast("Could not preview the pasted output.");
  }
});
