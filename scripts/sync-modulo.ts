import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";

const raiz = path.resolve(import.meta.dir, "..");
const verificar = process.argv.includes("--check");

function leer(ruta: string): string {
  return readFileSync(path.join(raiz, ruta), "utf8");
}

function concatenarConocimiento(): string {
  const directorio = path.join(raiz, "src", "knowledge");
  const archivos = readdirSync(directorio, { withFileTypes: true })
    .filter((entrada) => entrada.isFile() && entrada.name.endsWith(".md"))
    .map((entrada) => entrada.name)
    .sort();
  if (archivos.length === 0) throw new Error("No hay archivos Markdown en src/knowledge/.");
  return archivos.map((archivo) => readFileSync(path.join(directorio, archivo), "utf8")).join("\n\n");
}

function generarArchivos(): Readonly<Record<string, string>> {
  const agente = [
    "---",
    'description: "Agente que valida paquetes de compra y crea órdenes de compra en SAP"',
    "mode: primary",
    "permission:",
    "  edit: deny",
    "  bash: deny",
    "---",
    "",
  ].join("\n") + leer("agent/prompt.md");
  const skill = [
    "---",
    "name: ordenes-compra",
    'description: "Conocimiento para validar paquetes de compra y crear órdenes de compra en SAP"',
    "---",
    "",
  ].join("\n") + concatenarConocimiento();
  return {
    "modulo/agent.md": agente,
    "modulo/skill/ordenes-compra/SKILL.md": skill,
    "modulo/tools/oc.ts": 'export * from "../../src/tools/oc";\n',
  };
}

function estaActualizado(ruta: string, esperado: string): boolean {
  const destino = path.join(raiz, ruta);
  return existsSync(destino) && readFileSync(destino, "utf8") === esperado;
}

function escribir(ruta: string, contenido: string): void {
  const destino = path.join(raiz, ruta);
  mkdirSync(path.dirname(destino), { recursive: true });
  writeFileSync(destino, contenido, "utf8");
}

function sincronizar(): void {
  const archivos = Object.entries(generarArchivos());
  const desactualizados = archivos.filter(([ruta, contenido]) => !estaActualizado(ruta, contenido));
  if (verificar) {
    desactualizados.forEach(([ruta]) => console.error(`Desactualizado: ${ruta}`));
    process.exitCode = desactualizados.length === 0 ? 0 : 1;
    return;
  }
  desactualizados.forEach(([ruta, contenido]) => escribir(ruta, contenido));
  console.log(`Módulo sincronizado (${desactualizados.length} archivo(s) actualizado(s)).`);
}

sincronizar();
