// script.js – USPS Address CSV Formatter logic

// --- Configuration -------------------------------------------------------
// Google AI Studio (Gemini‑2.5‑Flash) endpoint
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const SYSTEM_PROMPT = `You are an expert postal address cleaning and formatting assistant. Your task is to clean and standardize US mailing addresses to USPS standards.

Input: A single raw address string containing elements of name, street, city, state, zip.

Output: A JSON object with the following fields:
- "full_name": Extract and format the recipient's name in Title Case if present (e.g., "John Doe"). If no recipient name is found, output an empty string.
- "delivery_address": Clean and standardize the street address. Follow USPS Publication 28 guidelines:
  * Output all letters in UPPERCASE.
  * Remove all punctuation (no periods after abbreviations, no commas, e.g., "N" instead of "N.", "ST" instead of "St.").
  * Standardize suffixes (e.g., "ST", "AVE", "RD", "DR", "LN", "BLVD").
  * Standardize secondary address units (e.g., "APT 4B", "STE 200", "FL 3", "UNIT A"). Use standard USPS abbreviations.
  * Standardize directional indicators (e.g., "N", "S", "E", "W", "NE", "NW", "SE", "SW").
- "city_state_zip": Standardize city, state, and ZIP code:
  * Format: "[CITY] [STATE] [ZIP]" (e.g., "SAN FRANCISCO CA 94103").
  * City must be in UPPERCASE.
  * State must be the 2-letter postal abbreviation (e.g., "CA", "NY").
  * ZIP code must be a 5-digit number or 9-digit ZIP+4 formatted as "12345-6789".
- "notes": Add a concise comment if any issues were resolved or if key info is missing. If the address is perfect, output "Cleaned".

Guidelines for address parts:
- Do not output markdown or extra fields. Match the schema exactly.`;

// --- UI Elements ----------------------------------------------------------
const apiKeyInput = document.getElementById("apiKey");
const fileInput = document.getElementById("csvFile");
const processBtn = document.getElementById("processBtn");
const statusDiv = document.getElementById("status");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const progressWrapper = document.querySelector(".progress-wrapper");
const downloadLink = document.getElementById("downloadLink");
const dropZone = document.getElementById("dropZone");
const togglePasswordBtn = document.getElementById("togglePasswordBtn");

// --- Helper Functions ------------------------------------------------------
function setStatus(message) {
  statusDiv.textContent = message;
}

function updateProgress(current, total) {
  const percent = Math.round((current / total) * 100);
  progressBar.value = percent;
  progressText.textContent = `${percent}% (${current}/${total})`;
}

async function callGemini(rowData) {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) throw new Error("API key missing");

  const payload = {
    contents: [
      { parts: [{ text: rowData }] }
    ],
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }]
    },
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          full_name: { type: "STRING" },
          delivery_address: { type: "STRING" },
          city_state_zip: { type: "STRING" },
          notes: { type: "STRING" }
        },
        required: ["full_name", "delivery_address", "city_state_zip", "notes"]
      }
    }
  };

  const url = `${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty response from Gemini");
  return text.trim();
}

function buildCSV(rows) {
  const header = "FULL_NAME,DELIVERY_ADDRESS,CITY_STATE_ZIP,NOTES";
  const lines = rows.map(r => {
    const cols = [
      r.full_name || "",
      r.delivery_address || "",
      r.city_state_zip || "",
      r.notes || ""
    ];
    // Escape double quotes and wrap each column in quotes
    const escaped = cols.map(c => `"${c.replace(/"/g, '""')}"`);
    return escaped.join(",");
  });
  return [header, ...lines].join("\n");
}

// --- Main Processing -------------------------------------------------------
processBtn.addEventListener("click", async () => {
  // Reset UI
  downloadLink.hidden = true;
  progressWrapper.hidden = true;
  setStatus("");

  const file = fileInput.files[0];
  if (!file) {
    setStatus("Please select a CSV file.");
    return;
  }
  if (!apiKeyInput.value.trim()) {
    setStatus("Please enter your Google AI Studio API key.");
    return;
  }

  setStatus("Parsing CSV…");
  const rows = [];
  let totalRows = 0;

  // PapaParse streaming to avoid loading huge files into memory
  Papa.parse(file, {
    header: false,
    skipEmptyLines: true,
    chunk: async function (results) {
      for (const row of results.data) {
        const rowString = row.join(", ");
        rows.push({ original: rowString, processed: null });
      }
    },
    complete: async function () {
      totalRows = rows.length;
      if (totalRows === 0) {
        setStatus("CSV appears empty.");
        return;
      }
      setStatus(`Processing ${totalRows} rows…`);
      progressWrapper.hidden = false;
      updateProgress(0, totalRows);

      const processedRows = [];
      for (let i = 0; i < rows.length; i++) {
        const { original } = rows[i];
        try {
          const jsonText = await callGemini(original);
          const parsed = JSON.parse(jsonText);
          processedRows.push(parsed);
        } catch (e) {
          console.error("Gemini error for row", i, e);
          processedRows.push({
            full_name: "",
            delivery_address: original,
            city_state_zip: "",
            notes: `ERROR: ${e.message}`
          });
        }
        updateProgress(i + 1, totalRows);
      }

      const csvContent = buildCSV(processedRows);
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      downloadLink.href = url;
      downloadLink.download = "cleaned_addresses.csv";
      downloadLink.hidden = false;
      setStatus("Processing complete. Click the link to download.");
    },
    error: function (err) {
      console.error("PapaParse error", err);
      setStatus("Failed to read CSV file.");
    }
  });
});

// --- Modern UI Interaction & Drag-and-Drop ---------------------------------
function handleFileSelect(file) {
  const textEl = dropZone.querySelector(".drop-zone-text");
  if (file) {
    textEl.innerHTML = `Selected: <strong>${file.name}</strong> (${(file.size / 1024).toFixed(1)} KB)`;
  } else {
    textEl.innerHTML = `Drag & drop your CSV here or <strong>browse</strong>`;
  }
}

fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) {
    handleFileSelect(fileInput.files[0]);
  } else {
    handleFileSelect(null);
  }
});

// Drag & drop highlight classes
["dragenter", "dragover"].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add("drag-over");
  }, false);
});

["dragleave", "drop"].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove("drag-over");
  }, false);
});

// Drop handler
dropZone.addEventListener("drop", (e) => {
  const dt = e.dataTransfer;
  const files = dt.files;
  if (files.length > 0) {
    fileInput.files = files;
    handleFileSelect(files[0]);
  }
}, false);

// Password visibility toggle
togglePasswordBtn.addEventListener("click", () => {
  const isPassword = apiKeyInput.type === "password";
  apiKeyInput.type = isPassword ? "text" : "password";
  
  const eyeOpen = togglePasswordBtn.querySelector(".eye-open");
  const eyeClosed = togglePasswordBtn.querySelector(".eye-closed");
  
  if (isPassword) {
    eyeOpen.style.display = "none";
    eyeClosed.style.display = "block";
  } else {
    eyeOpen.style.display = "block";
    eyeClosed.style.display = "none";
  }
});

// --------------------------------------------------------------------------
// End of script.js
