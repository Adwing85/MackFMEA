// Bettet JS und CSS des Standalone-Builds in eine einzige HTML-Datei ein.
//   dist-standalone/mackfmea.html           vollständiges Dokument (lokal im Browser öffnen)
//   dist-standalone/mackfmea.artifact.html  nur Seiteninhalt (Veröffentlichung als claude.ai-Artifact)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist-standalone");
const html = readFileSync(join(dist, "index.html"), "utf8");

const scriptMatch = html.match(/<script type="module"[^>]*src="\/?([^"]+)"[^>]*><\/script>/);
const styleMatch = html.match(/<link rel="stylesheet"[^>]*href="\/?([^"]+)"[^>]*>/);
if (!scriptMatch || !styleMatch) throw new Error("Script- oder Stylesheet-Verweis im Build nicht gefunden");

// "</script" und "<!--" dürfen im eingebetteten Skript nicht vorkommen
const js = readFileSync(join(dist, scriptMatch[1]), "utf8").replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
const css = readFileSync(join(dist, styleMatch[1]), "utf8");
const title = "<title>MackFMEA</title>";
const body = `<div id="root"></div>\n<script type="module">\n${js}\n</script>`;

const full = `<!doctype html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
${title}
<style>
${css}
</style>
</head>
<body>
${body}
</body>
</html>
`;
writeFileSync(join(dist, "mackfmea.html"), full);

// Artifact-Seite: Titel zuerst, kein eigenes Grundgerüst (wird beim Veröffentlichen ergänzt)
writeFileSync(join(dist, "mackfmea.artifact.html"), `${title}\n<style>\n${css}\n</style>\n${body}\n`);

console.log(`mackfmea.html: ${(full.length / 1024).toFixed(0)} KB`);
