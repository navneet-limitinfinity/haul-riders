import fs from "node:fs/promises";
import zlib from "node:zlib";

function decodePdfString(str) {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = str[i + 1] ?? "";
    if (next === "n") {
      out += "\n";
      i += 1;
      continue;
    }
    if (next === "r") {
      out += "\r";
      i += 1;
      continue;
    }
    if (next === "t") {
      out += "\t";
      i += 1;
      continue;
    }
    if (next === "b") {
      out += "\b";
      i += 1;
      continue;
    }
    if (next === "f") {
      out += "\f";
      i += 1;
      continue;
    }
    if (next === "(" || next === ")" || next === "\\") {
      out += next;
      i += 1;
      continue;
    }
    const rest = str.slice(i + 1, i + 4);
    const oct = rest.match(/^[0-7]{1,3}/)?.[0] ?? "";
    if (oct) {
      out += String.fromCharCode(Number.parseInt(oct, 8));
      i += oct.length;
      continue;
    }
    out += next;
    i += 1;
  }
  return out;
}

function extractObjectText(pdfText, objNum, genNum = 0) {
  const header = `${objNum} ${genNum} obj`;
  const start = pdfText.indexOf(header);
  if (start === -1) return null;
  const end = pdfText.indexOf("endobj", start);
  if (end === -1) return null;
  return pdfText.slice(start, end + "endobj".length);
}

function extractFlateStreamUtf8(pdfBytes, pdfText, objNum) {
  const header = `${objNum} 0 obj`;
  const start = pdfText.indexOf(header);
  if (start === -1) return null;
  const streamPos = pdfText.indexOf("stream", start);
  if (streamPos === -1) return null;
  let dataStart = streamPos + "stream".length;
  if (pdfText[dataStart] === "\r" && pdfText[dataStart + 1] === "\n") dataStart += 2;
  else if (pdfText[dataStart] === "\n") dataStart += 1;
  const endstream = pdfText.indexOf("endstream", dataStart);
  if (endstream === -1) return null;
  const raw = pdfBytes.subarray(dataStart, endstream);
  return zlib.inflateSync(raw).toString("utf8");
}

function parseTextItemsFromContentStream(content) {
  const items = [];
  let inText = false;
  let font = "";
  let size = 0;
  let x = 0;
  let y = 0;

  const re =
    /(BT|ET)|(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+Tm|(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+Td|\/(F\d+)\s+(\d*\.?\d+)\s+Tf|(\((?:\\.|[^\\)])*\))\s*Tj/g;

  let m;
  while ((m = re.exec(content))) {
    if (m[1] === "BT") {
      inText = true;
      continue;
    }
    if (m[1] === "ET") {
      inText = false;
      continue;
    }
    if (!inText) continue;

    if (m[2]) {
      x = Number.parseFloat(m[6]);
      y = Number.parseFloat(m[7]);
      continue;
    }
    if (m[8]) {
      x += Number.parseFloat(m[8]);
      y += Number.parseFloat(m[9]);
      continue;
    }
    if (m[10]) {
      font = m[10];
      size = Number.parseFloat(m[11]);
      continue;
    }
    if (m[12]) {
      const text = decodePdfString(m[12].slice(1, -1));
      if (text.trim()) items.push({ text, x, y, font, size });
    }
  }

  return items;
}

function extractXObjectMatrices(content) {
  const out = {};
  const re = /q\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+cm\s+\/(\w+)\s+Do\s+Q/g;
  let m;
  while ((m = re.exec(content))) {
    const name = m[7];
    out[name] = {
      a: Number(m[1]),
      b: Number(m[2]),
      c: Number(m[3]),
      d: Number(m[4]),
      e: Number(m[5]),
      f: Number(m[6]),
    };
  }
  return out;
}

function findText(items, needle) {
  return items.find((it) => it.text === needle) ?? null;
}

async function main() {
  const input = "src/public/Sample Docket.pdf";
  const output = "src/shipments/label/docketTemplateMap.json";

  const pdfBytes = await fs.readFile(input);
  const pdfText = pdfBytes.toString("latin1");

  const pageObjText = extractObjectText(pdfText, 4, 0) ?? "";
  const mediaBoxMatch = pageObjText.match(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/);
  const mediaBox = mediaBoxMatch
    ? mediaBoxMatch.slice(1, 5).map((v) => Number.parseFloat(v))
    : [0, 0, 493, 700];

  const content = extractFlateStreamUtf8(pdfBytes, pdfText, 5);
  if (!content) throw new Error("Failed to extract content stream (object 5)");

  const items = parseTextItemsFromContentStream(content);
  const matrices = extractXObjectMatrices(content);

  const fromLabel = findText(items, "FROM:");
  const toLabel = findText(items, "TO:");
  const shipDateLabel = findText(items, "Ship Date :");
  const allDates = items.filter((it) => it.text.match(/^\d{2}-\d{2}-\d{4}$/));
  const shipDateValue =
    shipDateLabel && allDates.length
      ? allDates.reduce((best, cur) =>
          Math.abs(cur.y - shipDateLabel.y) < Math.abs(best.y - shipDateLabel.y) ? cur : best
        )
      : allDates[0] ?? null;
  const shipValueLabel = findText(items, "Ship value :");
  const shipValueValue = findText(items, "1000");
  const awbValue = items.find((it) => it.text.startsWith("Z") && it.text.length >= 8) ?? null;
  const pinBig = items.find((it) => it.text === "421503") ?? null;
  const service = findText(items, "STD EXP-A");
  const paymentFlag = findText(items, "Prepaid");
  const paymentNote = findText(items, "Don't collect money");
  const refNo = findText(items, "Ref. No:");
  const weight = items.find((it) => it.text.startsWith("Weight:")) ?? null;
  const bottomDate = allDates.length ? allDates.reduce((best, cur) => (cur.y < best.y ? cur : best)) : null;
  const bottomTime = items.find((it) => it.text.match(/^\d{2}:\d{2}:\d{2}$/)) ?? null;

  const topBarcode = matrices.Xf2 ?? null;
  const bottomBarcode = matrices.Xf1 ?? null;

  const map = {
    template: {
      samplePdf: input,
      blankPdf: "src/public/Blank Docket.pdf",
      mediaBox,
    },
    fonts: {
      regular: "Helvetica",
      bold: "Helvetica-Bold",
    },
    fields: {
      shipDate: shipDateValue
        ? { x: shipDateValue.x, y: shipDateValue.y, size: shipDateValue.size, bold: true }
        : shipDateLabel
          ? { x: shipDateLabel.x + 60, y: shipDateLabel.y, size: 10, bold: true }
          : null,
      shipValue: shipValueValue
        ? { x: shipValueValue.x, y: shipValueValue.y, size: shipValueValue.size, bold: true }
        : shipValueLabel
          ? { x: shipValueLabel.x + 60, y: shipValueLabel.y, size: 10, bold: true }
          : null,
      fromBlock: fromLabel
        ? {
            x: fromLabel.x,
            yTop: fromLabel.y - 9,
            size: 9,
            lineHeight: 10.5,
            maxWidth: (shipDateLabel?.x ?? 324) - fromLabel.x - 10,
            maxLines: 4,
          }
        : null,
      toBlock: toLabel
        ? {
            x: toLabel.x + 1,
            yTop: toLabel.y - 13,
            size: 11,
            lineHeight: 12.8,
            maxWidth: 250,
            maxLines: 6,
          }
        : null,
      awbText: awbValue
        ? { x: awbValue.x, y: awbValue.y, size: awbValue.size, bold: true }
        : null,
      pinBig: pinBig
        ? { x: pinBig.x, y: pinBig.y, size: pinBig.size, bold: true }
        : null,
      service: service
        ? { x: service.x, y: service.y, size: service.size, bold: true }
        : null,
      paymentFlag: paymentFlag
        ? { x: paymentFlag.x, y: paymentFlag.y, size: paymentFlag.size, bold: false }
        : null,
      paymentNote: paymentNote
        ? { x: paymentNote.x, y: paymentNote.y, size: paymentNote.size, bold: true }
        : null,
      refNoValue: refNo
        ? { x: refNo.x + 55, y: refNo.y, size: refNo.size, bold: false }
        : null,
      weight: weight
        ? { x: weight.x + 55, y: weight.y, size: weight.size, bold: true }
        : null,
      bottomDate: bottomDate
        ? { x: bottomDate.x, y: bottomDate.y, size: bottomDate.size, bold: false }
        : null,
      bottomTime: bottomTime
        ? { x: bottomTime.x, y: bottomTime.y, size: bottomTime.size, bold: false }
        : null,
      topBarcodeRect: topBarcode ? { x: topBarcode.e, y: topBarcode.f, sx: topBarcode.a, sy: topBarcode.d } : null,
      bottomBarcodeRect: bottomBarcode
        ? { x: bottomBarcode.e, y: bottomBarcode.f, sx: bottomBarcode.a, sy: bottomBarcode.d }
        : null,
    },
    xobjects: {
      topBarcodeFormName: "Xf2",
      topBarcodeFormBbox: [0, 0, 121, 18],
      bottomBarcodeFormName: "Xf1",
      bottomBarcodeFormBbox: [0, 0, 264, 40],
    },
  };

  await fs.mkdir("src/shipments/label", { recursive: true });
  await fs.writeFile(output, JSON.stringify(map, null, 2), "utf8");
  console.log(`Wrote ${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
