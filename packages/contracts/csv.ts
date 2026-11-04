export function parseCsv(text: string) {
  if (text.length > 262144) throw new Error("CSV_TOO_LARGE");
  text = text.replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/, 1)[0];
  const separator = first.includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === separator && !quoted) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" && !quoted) {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((s) => s.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (quoted) throw new Error("CSV_QUOTING_INVALID");
  row.push(cell.replace(/\r$/, ""));
  if (row.some((s) => s.trim())) rows.push(row);
  if (rows.length < 2 || rows.length > 101)
    throw new Error("CSV_ROWS_1_TO_100");
  const header = rows.shift()!.map((s) => s.trim());
  const required = [
    "reference",
    "origin",
    "destination",
    "pickup_at",
    "appointment_at",
    "passengers",
  ];
  if (
    required.some((k) => !header.includes(k)) ||
    new Set(header).size !== header.length
  )
    throw new Error("CSV_HEADERS_INVALID");
  return rows.map((row) => {
    if (row.length !== header.length) throw new Error("CSV_COLUMNS_INVALID");
    const o = Object.fromEntries(header.map((h, i) => [h, row[i].trim()]));
    const flag = o.accessible || "false";
    if (!["false", "true", "0", "1"].includes(flag))
      throw new Error("CSV_BOOLEAN_INVALID");
    return {
      reference: o.reference,
      origin: o.origin,
      destination: o.destination,
      pickup_at: o.pickup_at,
      appointment_at: o.appointment_at,
      arrival_buffer: Number(o.arrival_buffer || 15),
      passengers: Number(o.passengers),
      accessible: ["true", "1"].includes(flag),
    };
  });
}
export function encodeCsv(rows: unknown[][]) {
  return (
    "\uFEFF" +
    rows
      .map((r) =>
        r.map((v) => '"' + String(v ?? "").replace(/"/g, '""') + '"').join(";"),
      )
      .join("\r\n")
  );
}
