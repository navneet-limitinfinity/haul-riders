import fs from "node:fs/promises";
import zlib from "node:zlib";

function findAllObjects(pdfText) {
  const re = /(\n|^)(\d+)\s+(\d+)\s+obj\b/g;
  const objects = [];
  let match;
  while ((match = re.exec(pdfText))) {
    const objNum = Number.parseInt(match[2], 10);
    const genNum = Number.parseInt(match[3], 10);
    const start = match.index + (match[1] ? match[1].length : 0);
    const end = pdfText.indexOf("endobj", start);
    if (end === -1) continue;
    const endInclusive = end + "endobj".length;
    objects.push({ objNum, genNum, start, end: endInclusive });
    re.lastIndex = endInclusive;
  }
  return objects.sort((a, b) => a.objNum - b.objNum || a.genNum - b.genNum);
}

function extractStreamBytes(pdfBytes, pdfText, obj) {
  const objText = pdfText.slice(obj.start, obj.end);
  const streamKeywordIndex = objText.indexOf("stream");
  if (streamKeywordIndex === -1) return null;
  const streamAbs = obj.start + streamKeywordIndex;
  let dataStart = streamAbs + "stream".length;
  if (pdfText[dataStart] === "\r" && pdfText[dataStart + 1] === "\n") dataStart += 2;
  else if (pdfText[dataStart] === "\n") dataStart += 1;

  const endstreamAbs = pdfText.indexOf("endstream", dataStart);
  if (endstreamAbs === -1) return null;
  return {
    dataStart,
    dataEnd: endstreamAbs,
    data: pdfBytes.subarray(dataStart, endstreamAbs),
  };
}

function updateLengthInDict(dictText, newLength) {
  // Replace first `/Length <number>` with the new value.
  return dictText.replace(/\/Length\s+\d+/, `/Length ${newLength}`);
}

function makeBlankContentStream(decoded) {
  const withoutText = decoded.replace(/BT[\s\S]*?ET\s*/g, "");
  // Remove barcode form XObjects (keep logo img0).
  const withoutBarcodes = withoutText
    .replace(/\/Xf1\s+Do\s*/g, "")
    .replace(/\/Xf2\s+Do\s*/g, "");
  return withoutBarcodes;
}

async function main() {
  const inputPath = "src/public/Sample Docket.pdf";
  const outputPath = "src/public/Blank Docket.pdf";

  const pdfBytes = await fs.readFile(inputPath);
  const pdfText = pdfBytes.toString("latin1");

  const objects = findAllObjects(pdfText);
  if (objects.length === 0) throw new Error("No PDF objects found");

  // Heuristic: find the page content stream by looking for a flate stream that contains XObjects img0/Xf1/Xf2.
  let targetObj = null;
  let targetDecoded = null;
  let targetStream = null;

  for (const obj of objects) {
    const objText = pdfText.slice(obj.start, obj.end);
    if (!objText.includes("/FlateDecode") || !objText.includes("stream")) continue;
    const stream = extractStreamBytes(pdfBytes, pdfText, obj);
    if (!stream) continue;
    let inflated;
    try {
      inflated = zlib.inflateSync(stream.data).toString("utf8");
    } catch {
      continue;
    }
    if (inflated.includes("/img0") && inflated.includes(" Do")) {
      targetObj = obj;
      targetDecoded = inflated;
      targetStream = stream;
      break;
    }
  }

  if (!targetObj || !targetDecoded || !targetStream) {
    throw new Error("Failed to locate main content stream");
  }

  const blankDecoded = makeBlankContentStream(targetDecoded);
  const blankCompressed = zlib.deflateSync(Buffer.from(blankDecoded, "utf8"));

  // Build new PDF with rebuilt xref to keep it valid.
  const maxObjNum = Math.max(...objects.map((o) => o.objNum));
  const objMap = new Map(objects.map((o) => [o.objNum, o]));

  // Extract trailer Root/Info (best-effort).
  const trailerMatch = pdfText.match(/trailer\s*<<(.*?)>>/s);
  const trailerBody = trailerMatch?.[1] ?? "";
  const rootMatch = trailerBody.match(/\/Root\s+(\d+\s+\d+\s+R)/);
  const infoMatch = trailerBody.match(/\/Info\s+(\d+\s+\d+\s+R)/);
  const rootRef = rootMatch?.[1] ?? "";
  const infoRef = infoMatch?.[1] ?? "";

  const chunks = [];
  const offsets = new Array(maxObjNum + 1).fill(0);

  const header = pdfText.startsWith("%PDF-") ? pdfText.slice(0, pdfText.indexOf("\n") + 1) : "%PDF-1.7\n";
  chunks.push(Buffer.from(header, "latin1"));

  for (let n = 1; n <= maxObjNum; n++) {
    const meta = objMap.get(n);
    if (!meta) continue;
    offsets[n] = chunks.reduce((acc, b) => acc + b.length, 0);
    if (n === targetObj.objNum) {
      const objText = pdfText.slice(meta.start, meta.end);
      const dictStart = objText.indexOf("<<");
      const dictEnd = objText.indexOf(">>", dictStart);
      if (dictStart === -1 || dictEnd === -1) throw new Error("Bad stream dictionary");
      const dictText = objText.slice(dictStart, dictEnd + 2);
      const newDict = updateLengthInDict(dictText, blankCompressed.length);
      const newObjHeader = `${n} ${meta.genNum} obj\n${newDict}\nstream\n`;
      const newObjFooter = `\nendstream\nendobj\n`;
      chunks.push(Buffer.from(newObjHeader, "latin1"));
      chunks.push(blankCompressed);
      chunks.push(Buffer.from(newObjFooter, "latin1"));
      continue;
    }
    chunks.push(Buffer.from(pdfText.slice(meta.start, meta.end) + "\n", "latin1"));
  }

  const xrefOffset = chunks.reduce((acc, b) => acc + b.length, 0);
  const xrefLines = [];
  xrefLines.push("xref\n");
  xrefLines.push(`0 ${maxObjNum + 1}\n`);
  xrefLines.push("0000000000 65535 f \n");
  for (let n = 1; n <= maxObjNum; n++) {
    const off = offsets[n] || 0;
    const gen = objMap.get(n)?.genNum ?? 0;
    xrefLines.push(`${String(off).padStart(10, "0")} ${String(gen).padStart(5, "0")} n \n`);
  }

  const trailerParts = [];
  trailerParts.push("trailer\n<<\n");
  trailerParts.push(`/Size ${maxObjNum + 1}\n`);
  if (rootRef) trailerParts.push(`/Root ${rootRef}\n`);
  if (infoRef) trailerParts.push(`/Info ${infoRef}\n`);
  trailerParts.push(">>\n");
  trailerParts.push("startxref\n");
  trailerParts.push(`${xrefOffset}\n`);
  trailerParts.push("%%EOF\n");

  chunks.push(Buffer.from(xrefLines.join(""), "latin1"));
  chunks.push(Buffer.from(trailerParts.join(""), "latin1"));

  await fs.writeFile(outputPath, Buffer.concat(chunks));
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
