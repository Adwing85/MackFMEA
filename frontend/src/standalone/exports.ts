/**
 * Excel- und PDF-Export im Browser – gleicher Aufbau wie backend/app/services/export_{excel,pdf}.py.
 * ExcelJS und jsPDF werden beim ersten Export von cdnjs nachgeladen.
 */

import type { FmeaRec, FmeaRowRec, Store, UserRec } from "./model";
import { loadRuleset } from "./engine";

/* eslint-disable @typescript-eslint/no-explicit-any */
const LIBS = {
  exceljs: "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js",
  jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  autotable: "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
};
const loaded = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  if (!loaded.has(src)) {
    loaded.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.crossOrigin = "anonymous";
        s.onload = () => resolve();
        s.onerror = () => {
          loaded.delete(src);
          reject(new Error("Export-Bibliothek konnte nicht geladen werden (Internetverbindung erforderlich)."));
        };
        document.head.appendChild(s);
      }),
    );
  }
  return loaded.get(src)!;
}

const STATUS_LABELS: Record<string, string> = {
  entwurf: "Entwurf",
  in_pruefung: "In Prüfung",
  freigegeben: "Freigegeben",
  abgelehnt: "Abgelehnt",
  ersetzt: "Ersetzt",
};

function fmt(value: string | null | undefined): string {
  if (!value) return "–";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "–" : d.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

const userName = (store: Store, id: number | null) => (id ? (store.users.find((u: UserRec) => u.id === id)?.username ?? "–") : "–");

type Accessor = keyof FmeaRowRec | ((r: FmeaRowRec) => unknown) | null;
const COLUMNS: [string, string, number, Accessor][] = [
  ["", "Nr.", 5, null],
  ["struktur", "1. Nächsthöhere Ebene", 22, "higher_level"],
  ["struktur", "2. Betrachtetes Element", 24, "focus_element"],
  ["struktur", "3. Nächstniedrigere Ebene / Merkmal", 24, "lower_level"],
  ["funktion", "1. Funktion nächsthöhere Ebene", 26, "function_higher"],
  ["funktion", "2. Funktion betrachtetes Element", 26, "function_focus"],
  ["funktion", "3. Funktion / Anforderung nächstniedrigere Ebene", 24, "function_lower"],
  ["fehler", "1. Fehlerfolge (FE)", 30, "failure_effect"],
  ["fehler", "B", 5, "severity"],
  ["fehler", "2. Fehlerart (FM)", 20, "failure_mode"],
  ["fehler", "3. Fehlerursache (FC)", 30, "failure_cause"],
  ["risiko", "Aktuelle Vermeidungsmaßnahmen (PC)", 42, "prevention_controls"],
  ["risiko", "A", 5, "occurrence"],
  ["risiko", "Aktuelle Entdeckungsmaßnahmen (DC)", 42, "detection_controls"],
  ["risiko", "E", 5, "detection"],
  ["risiko", "AP", 5, "action_priority"],
  ["risiko", "Besondere Merkmale", 9, "special_characteristic"],
  ["risiko", "RPZ (informativ)", 8, (r) => r.severity * r.occurrence * r.detection],
  ["risiko", "Schlüssel", 18, (r) => r.key_codes.join("\n")],
  ["optimierung", "Vermeidungsmaßnahme", 34, "opt_prevention"],
  ["optimierung", "Entdeckungsmaßnahme", 34, "opt_detection"],
  ["optimierung", "Verantwortlich", 14, "opt_responsible"],
  ["optimierung", "Zieltermin", 11, "opt_target_date"],
  ["optimierung", "Status", 11, "opt_status"],
  ["optimierung", "A (neu)", 6, "opt_occurrence"],
  ["optimierung", "E (neu)", 6, "opt_detection_rating"],
  ["optimierung", "AP (neu)", 6, "opt_action_priority"],
  ["optimierung", "Bemerkungen", 30, "remarks"],
];
const GROUP_TITLES: Record<string, string> = {
  struktur: "Strukturanalyse (Schritt 2)",
  funktion: "Funktionsanalyse (Schritt 3)",
  fehler: "Fehleranalyse (Schritt 4)",
  risiko: "Risikoanalyse (Schritt 5)",
  optimierung: "Optimierung (Schritt 6)",
};
const GROUP_FILLS: Record<string, string> = {
  struktur: "FFDCE6F1",
  funktion: "FFE2EFDA",
  fehler: "FFFDE9D9",
  risiko: "FFFFF2CC",
  optimierung: "FFEDE7F6",
};
const AP_FILL: Record<string, string> = { H: "FFF8B4B4", M: "FFFCE7A2", L: "FFBBE5C3" };
const CENTERED = new Set(["Nr.", "B", "A", "E", "AP", "RPZ (informativ)", "A (neu)", "E (neu)", "AP (neu)", "Besondere Merkmale"]);
const thin = { style: "thin", color: { argb: "FF9CA3AF" } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const solid = (argb: string) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

export async function buildWorkbook(store: Store, doc: FmeaRec): Promise<Blob> {
  await loadScript(LIBS.exceljs);
  const ExcelJS = (window as any).ExcelJS;
  const wb = new ExcelJS.Workbook();
  wb.creator = "MackFMEA";
  const assembly = store.assemblies.find((a) => a.id === doc.assembly_id);

  // Blatt DFMEA
  const ws = wb.addWorksheet("DFMEA", {
    pageSetup: { orientation: "landscape", paperSize: 8, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const last = COLUMNS.length;
  ws.mergeCells(1, 1, 1, last);
  const title = ws.getCell(1, 1);
  title.value = `Design-FMEA (DFMEA) nach AIAG & VDA – ${doc.title}`;
  title.font = { size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  title.fill = solid("FF1F3A5F");
  title.alignment = { vertical: "middle" };
  ws.getRow(1).height = 24;
  const fields: [string, string][][] = [
    [
      ["Unternehmen", "–"],
      ["Betrachtungsgegenstand", `${assembly?.drawing_number ?? ""} ${assembly?.name ?? ""} (Rev. ${assembly?.revision || "–"})`],
      ["Konstruktionsverantwortung", doc.responsible || "–"],
      ["Vertraulichkeitsstufe", doc.confidentiality || "–"],
    ],
    [
      ["DFMEA-Nr.", doc.fmea_number],
      ["Version", String(doc.version)],
      ["Status", STATUS_LABELS[doc.status] ?? doc.status],
      ["Erstellt", `${fmt(doc.created_at)} (${userName(store, doc.created_by_id)})`],
    ],
    [
      ["Funktionsübergreifendes Team", doc.team || "–"],
      ["Geprüft / freigegeben", doc.reviewed_by_id ? `${userName(store, doc.reviewed_by_id)} ${fmt(doc.reviewed_at)}` : "–"],
      ["Prüfkommentar", doc.review_comment || "–"],
      ["Inhalts-Hash (SHA-256)", doc.content_hash ? `${doc.content_hash.slice(0, 32)}…` : "–"],
    ],
  ];
  const blocks = [
    [1, 3, 4, 8],
    [9, 11, 12, 15],
    [16, 19, 20, last],
  ];
  fields.forEach((block, b) => {
    const [ls, le, vs, ve] = blocks[b];
    block.forEach(([label, value], offset) => {
      const row = 2 + offset;
      ws.mergeCells(row, ls, row, le);
      ws.mergeCells(row, vs, row, ve);
      const lc = ws.getCell(row, ls);
      lc.value = label;
      lc.font = { bold: true, size: 9 };
      lc.fill = solid("FFF3F4F6");
      const vc = ws.getCell(row, vs);
      vc.value = value;
      vc.font = { size: 9 };
      vc.alignment = { wrapText: true, vertical: "middle" };
    });
  });
  const groupRow = 7;
  const headRow = 8;
  let col = 1;
  while (col <= last) {
    const group = COLUMNS[col - 1][0];
    let end = col;
    while (end < last && COLUMNS[end][0] === group) end++;
    if (group) {
      ws.mergeCells(groupRow, col, groupRow, end);
      const cell = ws.getCell(groupRow, col);
      cell.value = GROUP_TITLES[group];
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.fill = solid(GROUP_FILLS[group]);
    }
    col = end + 1;
  }
  COLUMNS.forEach(([group, heading, width], i) => {
    const cell = ws.getCell(headRow, i + 1);
    cell.value = heading;
    cell.font = { bold: true, size: 9 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = BORDER;
    if (group) cell.fill = solid(GROUP_FILLS[group]);
    ws.getColumn(i + 1).width = width;
  });
  ws.getRow(headRow).height = 42;
  doc.rows.forEach((row, n) => {
    const r = headRow + n + 1;
    COLUMNS.forEach(([, heading, , accessor], i) => {
      const value = accessor === null ? n + 1 : typeof accessor === "function" ? accessor(row) : row[accessor];
      const cell = ws.getCell(r, i + 1);
      cell.value = value === "" || value === null || value === undefined ? null : (value as string | number);
      cell.border = BORDER;
      cell.font = { size: 9 };
      cell.alignment = CENTERED.has(heading) ? { horizontal: "center", vertical: "middle", wrapText: true } : { wrapText: true, vertical: "top" };
      if ((heading === "AP" || heading === "AP (neu)") && typeof value === "string" && AP_FILL[value]) {
        cell.fill = solid(AP_FILL[value]);
        cell.font = { size: 9, bold: true };
      }
    });
  });
  ws.views = [{ state: "frozen", xSplit: 3, ySplit: headRow }];
  ws.autoFilter = { from: { row: headRow, column: 1 }, to: { row: headRow + Math.max(doc.rows.length, 1), column: last } };

  const table = (name: string, headers: [string, number][], rows: unknown[][]) => {
    const sheet = wb.addWorksheet(name);
    headers.forEach(([h, w], i) => {
      const cell = sheet.getCell(1, i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = solid("FF1F3A5F");
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = BORDER;
      sheet.getColumn(i + 1).width = w;
    });
    rows.forEach((values, r) =>
      values.forEach((v, c) => {
        const cell = sheet.getCell(r + 2, c + 1);
        cell.value = v === undefined ? null : (v as string | number | null);
        cell.alignment = { wrapText: true, vertical: "top" };
        cell.border = BORDER;
      }),
    );
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    if (rows.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: headers.length } };
  };

  table(
    "Anforderungen",
    [
      ["Bauteil", 32],
      ["SC", 6],
      ["Bereich", 11],
      ["Kategorie", 22],
      ["Code", 11],
      ["Norm", 13],
      ["Anforderung", 90],
    ],
    doc.requirements.map((r) => [
      r.component_label,
      `SC${r.sc_level}`,
      r.scope === "halbzeug" ? "Halbzeug" : "Bauteil",
      r.category,
      r.requirement_code,
      r.standard_code,
      r.text,
    ]),
  );

  const rs = loadRuleset(store);
  const snapshot = doc.snapshot as any;
  const headers: [string, number][] = [
    ["Pos.", 7],
    ["Zeichnungsnr.", 14],
    ["Bezeichnung", 26],
    ["Bezeichnung 2", 22],
    ["Funktion", 36],
    ["SC", 6],
    ...rs.attributes.map((a) => [`${a.name} (Liste ${a.list_no})`, 24] as [string, number]),
    ["Kl.-Version", 9],
    ["Schlüssel", 40],
    ["Maßnahmen", 40],
    ["Anforderungen", 30],
  ];
  table(
    "Klassifikation",
    headers,
    (snapshot.components ?? []).map((c: any) => {
      const values = { ...c.liste1, ...c.liste2 };
      return [
        c.position,
        c.drawing_number,
        values.bezeichnung,
        values.bezeichnung2,
        values.funktion,
        `SC${c.sc_level}`,
        ...rs.attributes.map((a) =>
          ((values[a.code] as string[]) ?? []).map((code) => a.options.find((o) => o.code === code)?.label ?? code).join(", "),
        ),
        c.classification_version,
        (c.keys ?? []).join("\n"),
        (c.measures ?? []).join(", "),
        (c.requirements ?? []).join(", "),
      ];
    }),
  );
  table(
    "Rückverfolgbarkeit",
    [
      ["Merkmal", 42],
      ["Wert", 100],
    ],
    [
      ["FMEA-Nummer", doc.fmea_number],
      ["Version", doc.version],
      ["Status", STATUS_LABELS[doc.status] ?? doc.status],
      ["Generiert am", snapshot.generated_at ?? ""],
      ["Generiert von", snapshot.generated_by ?? ""],
      ["Generator-Version", snapshot.generator_version ?? ""],
      ["Regelwerksstand (Fingerprint)", snapshot.ruleset_fingerprint ?? ""],
      ["Inhalts-Hash", doc.content_hash],
      ["Quelle Baugruppe", snapshot.assembly?.source ?? ""],
      ["PDM-Referenz", doc.pdm_ref || snapshot.assembly?.pdm_ref || ""],
      ...(snapshot.process ?? []).map((p: any) => [`Schritt ${p.step}: ${p.name}`, p.result]),
      ...doc.warnings.map((w) => ["Hinweis", w]),
    ],
  );
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// Zeichen außerhalb der PDF-Standardschrift ersetzen
const PDF_MAP: Record<string, string> = { "→": "->", "≤": "<=", "≥": ">=", "⁴": "^4", "⁶": "^6", "⁸": "^8", "…": "..." };
const pdfText = (v: unknown) => String(v ?? "").replace(/[→≤≥⁴⁶⁸…]/g, (c) => PDF_MAP[c] ?? c);

export async function buildPdf(store: Store, doc: FmeaRec): Promise<Blob> {
  await loadScript(LIBS.jspdf);
  await loadScript(LIBS.autotable);
  const { jsPDF } = (window as any).jspdf;
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const assembly = store.assemblies.find((a) => a.id === doc.assembly_id);
  const status = STATUS_LABELS[doc.status] ?? doc.status;
  pdf.setProperties({ title: `${doc.fmea_number} V${doc.version}` });
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(15);
  pdf.text(pdfText(`Design-FMEA (DFMEA) nach AIAG & VDA – ${doc.title}`), 10, 16);

  const head = { fillColor: [31, 58, 95], textColor: 255, fontStyle: "bold", fontSize: 6.5 };
  pdf.autoTable({
    startY: 21,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 1.5, lineColor: [156, 163, 175], lineWidth: 0.2 },
    columnStyles: { 0: { fillColor: [243, 244, 246], cellWidth: 40 }, 2: { fillColor: [243, 244, 246], cellWidth: 32 }, 4: { fillColor: [243, 244, 246], cellWidth: 30 } },
    body: [
      ["Unternehmen", "–", "DFMEA-Nr.", doc.fmea_number, "Team", doc.team || "–"],
      ["Betrachtungsgegenstand", `${assembly?.drawing_number ?? ""} ${assembly?.name ?? ""}`, "Version / Status", `${doc.version} / ${status}`, "Verantwortlich", doc.responsible || "–"],
      [
        "Erstellt",
        `${fmt(doc.created_at)} (${userName(store, doc.created_by_id)})`,
        "Geprüft",
        doc.reviewed_by_id ? `${userName(store, doc.reviewed_by_id)} ${fmt(doc.reviewed_at)}` : "–",
        "Vertraulichkeit",
        doc.confidentiality || "–",
      ],
    ].map((r) => r.map(pdfText)),
  });

  const headers = [
    "Nr.",
    "Betrachtetes Element",
    "Merkmal (nächstniedr. Ebene)",
    "Funktion",
    "Fehlerfolge (FE)",
    "B",
    "Fehlerart (FM)",
    "Fehlerursache (FC)",
    "Vermeidungsmaßnahmen (PC)",
    "A",
    "Entdeckungsmaßnahmen (DC)",
    "E",
    "AP",
    "SC",
    "Optimierung",
    "Verantw. / Termin / Status",
  ];
  const widths = [9, 30, 28, 30, 34, 9, 24, 36, 48, 9, 48, 9, 9, 10, 39, 28];
  const AP_RGB: Record<string, number[]> = { H: [248, 180, 180], M: [252, 231, 162], L: [187, 229, 195] };
  pdf.autoTable({
    startY: (pdf as any).lastAutoTable.finalY + 5,
    theme: "grid",
    head: [headers],
    headStyles: head,
    styles: { fontSize: 6.5, cellPadding: 1, lineColor: [156, 163, 175], lineWidth: 0.15, valign: "top", overflow: "linebreak" },
    columnStyles: Object.fromEntries(widths.map((w, i) => [i, { cellWidth: w, halign: [5, 9, 11, 12].includes(i) ? "center" : "left" }])),
    body: doc.rows.map((r, i) => {
      let optimization = [r.opt_prevention, r.opt_detection].filter(Boolean).join("\n");
      if (r.opt_action_priority) optimization += `\nAP neu: ${r.opt_action_priority}`;
      return [
        i + 1,
        r.focus_element,
        r.lower_level,
        r.function_focus,
        r.failure_effect,
        r.severity,
        r.failure_mode,
        r.failure_cause,
        r.prevention_controls,
        r.occurrence,
        r.detection_controls,
        r.detection,
        r.action_priority,
        r.special_characteristic,
        optimization.trim(),
        [r.opt_responsible, r.opt_target_date, r.opt_status].filter(Boolean).join(" / "),
      ].map(pdfText);
    }),
    didParseCell: (data: any) => {
      if (data.section === "body" && data.column.index === 12 && AP_RGB[data.cell.raw]) {
        data.cell.styles.fillColor = AP_RGB[data.cell.raw];
        data.cell.styles.fontStyle = "bold";
      }
      if (data.section === "body" && [5, 9, 11].includes(data.column.index)) data.cell.styles.fontStyle = "bold";
    },
  });

  if (doc.requirements.length) {
    pdf.addPage();
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.text("Abgeleitete Anforderungen an Halbzeug und Bauteil", 10, 16);
    pdf.autoTable({
      startY: 20,
      theme: "grid",
      head: [["Bauteil", "SC", "Bereich", "Kategorie", "Code", "Norm", "Anforderung"]],
      headStyles: head,
      styles: { fontSize: 6.5, cellPadding: 1, lineColor: [156, 163, 175], lineWidth: 0.15, valign: "top" },
      columnStyles: Object.fromEntries([60, 12, 20, 40, 20, 24, 224].map((w, i) => [i, { cellWidth: w }])),
      body: doc.requirements.map((r) =>
        [r.component_label, `SC${r.sc_level}`, r.scope === "halbzeug" ? "Halbzeug" : "Bauteil", r.category, r.requirement_code, r.standard_code, r.text].map(
          pdfText,
        ),
      ),
    });
  }
  if (doc.warnings.length) {
    let y = (pdf as any).lastAutoTable.finalY + 8;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.text("Hinweise der Generierung", 10, y);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    for (const w of doc.warnings) {
      y += 5;
      pdf.text(pdfText(`• ${w}`), 10, y);
    }
  }
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.text(pdfText(`${doc.fmea_number} · Version ${doc.version} · Status: ${status} · Hash ${doc.content_hash.slice(0, 16)}`), 10, 291);
    pdf.text(`Seite ${p} von ${pages}`, 410, 291, { align: "right" });
  }
  return pdf.output("blob") as Blob;
}
