const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function makeElement() {
  return {
    value: "",
    textContent: "",
    className: "",
    hidden: false,
    disabled: false,
    children: [],
    listeners: {},
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    },
    append(...children) {
      this.children.push(...children);
    },
    appendChild(child) {
      this.children.push(child);
    },
    removeAttribute() {},
    replaceChildren(...children) {
      this.children = children;
    },
    focus() {},
    select() {},
    click() {},
    remove() {}
  };
}

function loadApp() {
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  let savedContent = null;

  const context = vm.createContext({
    Blob,
    URL: {
      createObjectURL() {
        return "blob:test";
      },
      revokeObjectURL() {}
    },
    console,
    document: {
      body: makeElement(),
      createElement: makeElement,
      getElementById: getElement
    },
    navigator: {
      clipboard: {
        async writeText() {}
      }
    },
    setTimeout,
    clearTimeout,
    window: {
      clearTimeout,
      setTimeout,
      async showSaveFilePicker() {
        return {
          async createWritable() {
            return {
              async write(content) {
                savedContent = content;
              },
              async close() {}
            };
          }
        };
      }
    }
  });

  const scriptPath = path.join(__dirname, "..", "script.js");
  vm.runInContext(fs.readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });

  return {
    context,
    evaluate(code) {
      return vm.runInContext(code, context);
    },
    get savedContent() {
      return savedContent;
    }
  };
}

function row(number, overrides = {}) {
  return {
    "Envelope Names": `Guest ${number}`,
    Address: `${number} Main Street`,
    apt: "",
    City: "Jacksonville",
    State: "FL",
    Zipcode: `32${String(number).padStart(3, "0")}`,
    Country: "",
    ...overrides
  };
}

test("parses one 25-row response", () => {
  const app = loadApp();
  app.context.input = JSON.stringify({ rows: Array.from({ length: 25 }, (_, index) => row(index + 1)) });
  const result = app.evaluate("parseCleanedOutput(input)");

  assert.equal(result.rows.length, 25);
  assert.equal(result.chunkCount, 1);
});

test("combines fenced 40 + 40 + 2 row chunks in order", () => {
  const app = loadApp();
  const chunks = [
    Array.from({ length: 40 }, (_, index) => row(index + 1)),
    Array.from({ length: 40 }, (_, index) => row(index + 41)),
    Array.from({ length: 2 }, (_, index) => row(index + 81))
  ];
  app.context.input = chunks
    .map((rows, index) => `Batch ${index + 1}\n\`\`\`json\n${JSON.stringify({ rows })}\n\`\`\``)
    .join("\n\n");
  const result = app.evaluate("parseCleanedOutput(input)");

  assert.equal(result.rows.length, 82);
  assert.equal(result.chunkCount, 3);
  assert.equal(result.rows[0]["Envelope Names"], "Guest 1");
  assert.equal(result.rows[81]["Envelope Names"], "Guest 82");
});

test("accepts a top-level row array and mixed-case JSON fence", () => {
  const app = loadApp();
  app.context.input = `\`\`\`JSON\n${JSON.stringify([row(1), row(2)])}\n\`\`\``;
  const result = app.evaluate("parseCleanedOutput(input)");

  assert.equal(result.rows.length, 2);
  assert.equal(result.chunkCount, 1);
});

test("reports an incomplete final chunk", () => {
  const app = loadApp();
  app.context.input = `${JSON.stringify({ rows: [row(1)] })}\n{"rows":[`;

  assert.throws(
    () => app.evaluate("parseCleanedOutput(input)"),
    /last JSON chunk is incomplete/i
  );
});

test("ignores brackets and unmatched quotes in surrounding prose", () => {
  const app = loadApp();
  app.context.input = `Batch [1] isn't called "finished yet\n${JSON.stringify({ rows: [row(1)] })}`;
  const result = app.evaluate("parseCleanedOutput(input)");

  assert.equal(result.rows.length, 1);
  assert.equal(result.chunkCount, 1);
});

test("keeps braces and brackets inside quoted address values", () => {
  const app = loadApp();
  app.context.input = JSON.stringify({
    rows: [row(1, { Address: '10 Main Street [Rear], Building "A" {East}' })]
  });
  const result = app.evaluate("parseCleanedOutput(input)");

  assert.equal(result.rows[0].Address, '10 Main Street [Rear], Building "A" {East}');
});

test("normalizes common alternate field names", () => {
  const app = loadApp();
  app.context.input = {
    envelope_name: "Mr. and Mrs. Pace",
    street_address: "10 Oak Road",
    Apartment: "Unit 2",
    CITY: "Orlando",
    province: "FL",
    postal_code: "32801",
    COUNTRY: ""
  };
  const normalized = app.evaluate("normalizeOutputRow(input)");

  assert.deepEqual(
    JSON.parse(JSON.stringify(normalized)),
    {
      "Envelope Names": "Mr. and Mrs. Pace",
      Address: "10 Oak Road",
      apt: "Unit 2",
      City: "Orlando",
      State: "FL",
      Zipcode: "32801",
      Country: ""
    }
  );
});

test("escapes commas, quotes, and line breaks without losing leading-zero ZIP codes", () => {
  const app = loadApp();
  app.context.rowsForCsv = [
    {
      "Envelope Names": 'O\'Connor, "Pace" Family',
      Address: "10 Main Street\nRear Entrance",
      apt: "",
      City: "Boston",
      State: "MA",
      Zipcode: "02108",
      Country: ""
    }
  ];
  const csv = app.evaluate("buildCSV(rowsForCsv)");

  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /\"O'Connor, \"\"Pace\"\" Family\"/);
  assert.match(csv, /\"10 Main Street\nRear Entrance\"/);
  assert.match(csv, /\"02108\"/);
});

test("rejects zero rows and unrecognized blank rows", () => {
  const app = loadApp();
  app.context.emptyInput = JSON.stringify({ rows: [] });
  app.context.badRow = { unexpected: "value" };
  app.context.noCoreFields = { State: "FL", Country: "USA" };

  assert.throws(
    () => app.evaluate("parseCleanedOutput(emptyInput)"),
    /contains zero rows/i
  );
  assert.throws(
    () => app.evaluate("normalizeOutputRow(badRow)"),
    /no recognized address fields/i
  );
  assert.throws(
    () => app.evaluate("normalizeOutputRow(noCoreFields)"),
    /neither an envelope name nor a street address/i
  );
});

test("builds and writes a nonblank CSV from previewed rows", async () => {
  const app = loadApp();
  app.context.rowsForSave = [row(1), row(2)];
  app.evaluate("latestRows = rowsForSave.map(normalizeOutputRow)");

  await app.evaluate("saveCsv()");

  assert.equal(typeof app.savedContent, "string");
  assert.match(app.savedContent, /"Envelope Names","Address"/);
  assert.match(app.savedContent, /"Guest 1","1 Main Street"/);
  assert.match(app.savedContent, /"Guest 2","2 Main Street"/);
});
