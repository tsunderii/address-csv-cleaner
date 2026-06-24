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

Clean the customer address list I paste below.`;

let latestCsvContent = "";
let latestRows = [];

const statusDiv = document.getElementById("status");
const downloadLink = document.getElementById("downloadLink");
const downloadBtn = document.getElementById("downloadBtn");
const outputPanel = document.getElementById("outputPanel");
const outputSummary = document.getElementById("outputSummary");
const outputBody = document.getElementById("outputBody");
const generatedPrompt = document.getElementById("generatedPrompt");
const copyGeneratedPromptBtn = document.getElementById("copyGeneratedPromptBtn");
const pastedJsonInput = document.getElementById("pastedJsonInput");
const previewPastedBtn = document.getElementById("previewPastedBtn");
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

function normalizeOutputRow(row) {
  const normalized = {};
  OUTPUT_COLUMNS.forEach(column => {
    const value = column === "Address" ? row?.Address ?? row?.Adress : row?.[column];
    normalized[column] = String(value ?? "").trim();
  });
  return normalized;
}

function parseCleanedRows(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Paste the JSON output from ChatGPT first.");
  }

  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(withoutFence);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.rows)) return parsed.rows;
  } catch (err) {
    const startObject = withoutFence.indexOf("{");
    const endObject = withoutFence.lastIndexOf("}");
    if (startObject !== -1 && endObject !== -1 && endObject > startObject) {
      const parsed = JSON.parse(withoutFence.slice(startObject, endObject + 1));
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed.rows)) return parsed.rows;
    }

    const startArray = withoutFence.indexOf("[");
    const endArray = withoutFence.lastIndexOf("]");
    if (startArray !== -1 && endArray !== -1 && endArray > startArray) {
      const parsed = JSON.parse(withoutFence.slice(startArray, endArray + 1));
      if (Array.isArray(parsed)) return parsed;
    }
  }

  throw new Error('That does not look like JSON. It should start with {"rows":[...]} or [...].');
}

function buildCSV(rows) {
  const header = OUTPUT_COLUMNS.map(csvEscape).join(",");
  const lines = rows.map(row => OUTPUT_COLUMNS.map(column => csvEscape(row[column])).join(","));
  return `\uFEFF${[header, ...lines].join("\r\n")}`;
}

function resetOutput() {
  latestCsvContent = "";
  latestRows = [];
  downloadLink.removeAttribute("href");
  downloadLink.hidden = true;
  downloadBtn.disabled = true;
  outputPanel.hidden = true;
  outputBody.replaceChildren();
  outputSummary.textContent = "";
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
  if (!latestCsvContent) {
    setStatus("Preview the cleaned output before saving.");
    return;
  }

  const suggestedName = "indesign_addresses.csv";
  const blob = new Blob([latestCsvContent], { type: "text/csv;charset=utf-8" });

  if (window.showSaveFilePicker) {
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
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      setStatus("Saved. The CSV is ready for InDesign.");
      showToast("Saved CSV successfully.");
      return;
    } catch (err) {
      if (err.name === "AbortError") {
        setStatus("Save canceled.");
        return;
      }
      console.error("Save picker failed", err);
    }
  }

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
    const rows = parseCleanedRows(pastedJsonInput.value).map(normalizeOutputRow);
    latestRows = rows;
    latestCsvContent = buildCSV(latestRows);
    renderOutputPreview(latestRows);
    setStatus("Pasted output ready. Review it, then save the InDesign CSV.");
  } catch (err) {
    console.error("Pasted output error", err);
    setStatus(err.message || "Could not read the pasted output.");
  }
});
