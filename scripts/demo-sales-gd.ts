/**
 * scripts/demo-sales-gd.ts
 * Teste com export real: Gd_Clientes + Gd_Fat → objects + knowledge graph.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createOntologyRegistry,
  createDeterministicClock as ontoClock,
  createIdGenerator as ontoIds,
} from 'ontology-registry';
import {
  createObjectPlatform,
  createDeterministicClock as objClock,
  createIdGenerator as objIds,
} from 'object-platform';
import {
  createKnowledgeGraph,
  createDeterministicClock as kgClock,
  createIdGenerator as kgIds,
} from 'knowledge-graph';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(root, 'datasets/sales-gd');
const clientesPath = resolve(dataDir, 'clientes.sample.csv');
const fatPath = resolve(dataDir, 'faturamento.sample.csv');

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]!);
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]!] = cols[i] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQ = !inQ;
      }
      continue;
    }
    if (ch === ',' && !inQ) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

async function main(): Promise<number> {
  const log = console.log;
  if (!existsSync(clientesPath) || !existsSync(fatPath)) {
    console.error(`CSVs não encontrados em ${dataDir}`);
    console.error('Esperado: clientes.sample.csv + faturamento.sample.csv');
    return 1;
  }

  const clientes = parseCsv(readFileSync(clientesPath, 'utf8'));
  const faturas = parseCsv(readFileSync(fatPath, 'utf8'));
  log(`== sales-gd: ${clientes.length} clientes, ${faturas.length} faturas ==`);

  const onto = createOntologyRegistry({
    clock: ontoClock('2024-06-01T12:00:00.000Z'),
    nextId: ontoIds(),
  });
  const o = await onto.createOntology({ name: 'sales-gd', createdBy: 'demo' });
  await onto.addPropertyType(o.id, { id: 'pt.name', displayName: 'Name', baseType: 'string' });
  await onto.addPropertyType(o.id, { id: 'pt.email', displayName: 'Email', baseType: 'string' });
  await onto.addPropertyType(o.id, { id: 'pt.status', displayName: 'Status', baseType: 'string' });
  await onto.addPropertyType(o.id, { id: 'pt.state', displayName: 'State', baseType: 'string' });
  await onto.addPropertyType(o.id, { id: 'pt.amount', displayName: 'Amount', baseType: 'number' });
  await onto.addPropertyType(o.id, { id: 'pt.qty', displayName: 'Qty', baseType: 'number' });
  await onto.addPropertyType(o.id, { id: 'pt.order_no', displayName: 'OrderNo', baseType: 'string' });
  await onto.addObjectType(o.id, {
    id: 'ot.customer',
    displayName: 'Customer',
    propertyTypeIds: ['pt.name', 'pt.email', 'pt.status', 'pt.state'],
  });
  await onto.addObjectType(o.id, {
    id: 'ot.invoice',
    displayName: 'Invoice',
    propertyTypeIds: ['pt.name', 'pt.amount', 'pt.qty', 'pt.order_no', 'pt.state'],
  });
  await onto.addLinkType(o.id, {
    id: 'lt.invoice_of',
    displayName: 'invoice_of',
    sourceObjectTypeId: 'ot.invoice',
    targetObjectTypeId: 'ot.customer',
    cardinality: 'N:1',
  });
  const ov = await onto.commit({ ontologyId: o.id });
  log(`  ontology ${ov.id} customer+invoice+link`);

  const platform = createObjectPlatform({
    clock: objClock('2024-06-01T12:00:00.000Z'),
    nextId: objIds(),
  });

  const mapCust = platform.createMapping({
    name: 'gd-clientes',
    datasetId: 'ds-gd-clientes',
    objectTypeId: 'ot.customer',
    ontologyVersionId: ov.id,
    primaryKeyFields: ['Código'],
    propertyMappings: [
      { sourceField: 'Nome', propertyTypeId: 'pt.name', transform: 'string' },
      { sourceField: 'E-mail', propertyTypeId: 'pt.email', transform: 'string' },
      { sourceField: 'Status', propertyTypeId: 'pt.status', transform: 'string' },
      { sourceField: 'Estado', propertyTypeId: 'pt.state', transform: 'string' },
    ],
    createdBy: 'demo',
  });
  const mvCust = platform.getLatestMappingVersion(mapCust.id)!;

  const mapFat = platform.createMapping({
    name: 'gd-fat',
    datasetId: 'ds-gd-fat',
    objectTypeId: 'ot.invoice',
    ontologyVersionId: ov.id,
    primaryKeyFields: ['Ordem'],
    propertyMappings: [
      { sourceField: 'Cliente', propertyTypeId: 'pt.name', transform: 'string' },
      { sourceField: 'Valor Total', propertyTypeId: 'pt.amount', transform: 'number' },
      { sourceField: 'Quantidade', propertyTypeId: 'pt.qty', transform: 'number' },
      { sourceField: 'Pedido', propertyTypeId: 'pt.order_no', transform: 'string' },
      { sourceField: 'UF', propertyTypeId: 'pt.state', transform: 'string' },
    ],
    linkMappings: [
      {
        linkTypeId: 'lt.invoice_of',
        sourceField: 'Cód.Cli',
        targetObjectTypeId: 'ot.customer',
      },
    ],
    createdBy: 'demo',
  });
  const mvFat = platform.getLatestMappingVersion(mapFat.id)!;

  const custRows = clientes.map((r) => ({ fields: r as Record<string, unknown> }));
  const fatRows = faturas.map((r) => ({ fields: r as Record<string, unknown> }));

  const p1 = platform.project({
    mappingVersionId: mvCust.id,
    datasetVersionId: 'dv-clientes-sample',
    rows: custRows,
  });
  const p2 = platform.project({
    mappingVersionId: mvFat.id,
    datasetVersionId: 'dv-fat-sample',
    rows: fatRows,
  });
  log(`  projected customers=${p1.upserted} invoices=${p2.upserted} links=${p2.linksUpserted}`);

  const customers = platform.queryObjects('demo', { objectTypeId: 'ot.customer' });
  const invoices = platform.queryObjects('demo', { objectTypeId: 'ot.invoice' });
  log(`  api customers=${customers.length} invoices=${invoices.length}`);

  const kg = createKnowledgeGraph({
    clock: kgClock('2024-06-01T12:00:00.000Z'),
    nextId: kgIds(),
  });
  for (const c of customers) {
    kg.upsertObject({
      id: c.id,
      objectTypeId: c.objectTypeId,
      primaryKey: c.primaryKey,
      properties: c.properties as Record<string, unknown>,
    });
  }
  for (const inv of invoices) {
    kg.upsertObject({
      id: inv.id,
      objectTypeId: inv.objectTypeId,
      primaryKey: inv.primaryKey,
      properties: inv.properties as Record<string, unknown>,
    });
  }

  const byCustPk = new Map(customers.map((c) => [c.primaryKey, c.id]));
  let linked = 0;
  let dangling = 0;
  for (const inv of invoices) {
    const raw = fatRows.find((r) => String(r.fields['Ordem'] ?? '') === inv.primaryKey);
    const cod = String(raw?.fields['Cód.Cli'] ?? '').replace(/\.0$/, '');
    const targetId = byCustPk.get(cod);
    if (!targetId) {
      dangling += 1;
      continue;
    }
    kg.upsertLink({
      linkTypeId: 'lt.invoice_of',
      sourceObjectId: inv.id,
      targetObjectId: targetId,
      mappingVersionId: mvFat.id,
      datasetVersionId: 'dv-fat-sample',
      sourceDatasetId: 'ds-gd-fat',
      targetDatasetId: 'ds-gd-clientes',
    });
    linked += 1;
  }
  const integrity = kg.checkIntegrity();
  log(`  kg links=${linked} dangling_skipped=${dangling} integrity.ok=${integrity.ok}`);

  const sampleInv = invoices[0];
  if (!sampleInv) {
    log('demo FAIL: sem faturas');
    return 1;
  }
  const trav = kg.traverseLinks({
    startObjectId: sampleInv.id,
    linkTypeIds: ['lt.invoice_of'],
    maxHops: 1,
  });
  const custNode = trav.nodes.find((n) => n.objectTypeId === 'ot.customer');
  const ref = kg.createRemoteReference(sampleInv.id);
  const amount = kg.accessRemote(ref.ticketId, 'pt.amount');

  log(`  exemplo fatura Ordem=${sampleInv.primaryKey} → cliente=${custNode?.primaryKey ?? '?'}`);
  log(`  remote ref amount=${String(amount)}`);

  // Grava resultado no disco (antes só ficava na memória e sumia).
  const outDir = resolve(dataDir, 'resultado');
  mkdirSync(outDir, { recursive: true });

  const ontologyOut = {
    ontologyId: o.id,
    versionId: ov.id,
    objectTypes: Object.keys(ov.objectTypes),
    linkTypes: Object.keys(ov.linkTypes),
  };

  const customersOut = customers.map((c) => ({
    id: c.id,
    tipo: 'Customer',
    codigo: c.primaryKey,
    nome: c.properties['pt.name'],
    email: c.properties['pt.email'],
    status: c.properties['pt.status'],
    estado: c.properties['pt.state'],
  }));

  const invoicesOut = invoices.map((inv) => {
    const raw = fatRows.find((r) => String(r.fields['Ordem'] ?? '') === inv.primaryKey);
    const codCli = String(raw?.fields['Cód.Cli'] ?? '').replace(/\.0$/, '');
    return {
      id: inv.id,
      tipo: 'Invoice',
      ordem: inv.primaryKey,
      pedido: inv.properties['pt.order_no'],
      clienteCodigo: codCli,
      clienteNome: inv.properties['pt.name'],
      quantidade: inv.properties['pt.qty'],
      valorTotal: inv.properties['pt.amount'],
      uf: inv.properties['pt.state'],
    };
  });

  const linksOut = kg.listLinks({ linkTypeId: 'lt.invoice_of' }).map((l) => {
    const inv = invoices.find((i) => i.id === l.sourceObjectId);
    const cust = customers.find((c) => c.id === l.targetObjectId);
    return {
      tipoLink: 'invoice_of',
      de: { tipo: 'Invoice', ordem: inv?.primaryKey, id: l.sourceObjectId },
      para: { tipo: 'Customer', codigo: cust?.primaryKey, nome: cust?.properties['pt.name'], id: l.targetObjectId },
    };
  });

  // Visão por cliente: cliente → lista de faturas (o “mapa” montado)
  const porCliente = customersOut.map((c) => {
    const fats = invoicesOut.filter((i) => i.clienteCodigo === c.codigo);
    return {
      cliente: c,
      qtdFaturas: fats.length,
      valorTotal: fats.reduce((s, f) => s + (Number(f.valorTotal) || 0), 0),
      faturas: fats,
    };
  });

  const resumo = {
    geradoEm: new Date().toISOString(),
    origem: {
      clientes: 'datasets/sales-gd/clientes.sample.csv',
      faturamento: 'datasets/sales-gd/faturamento.sample.csv',
    },
    contagens: {
      customers: customersOut.length,
      invoices: invoicesOut.length,
      links: linksOut.length,
      integrityOk: integrity.ok,
    },
    exemplo: {
      faturaOrdem: sampleInv.primaryKey,
      clienteCodigo: custNode?.primaryKey ?? null,
      valor: amount,
    },
    ondeEstavaAntes: 'só na memória do processo (sumia ao terminar)',
    ondeEstaAgora: 'datasets/sales-gd/resultado/*.json',
  };

  writeFileSync(resolve(outDir, '00-resumo.json'), JSON.stringify(resumo, null, 2), 'utf8');
  writeFileSync(resolve(outDir, '01-ontologia.json'), JSON.stringify(ontologyOut, null, 2), 'utf8');
  writeFileSync(resolve(outDir, '02-customers.json'), JSON.stringify(customersOut, null, 2), 'utf8');
  writeFileSync(resolve(outDir, '03-invoices.json'), JSON.stringify(invoicesOut, null, 2), 'utf8');
  writeFileSync(resolve(outDir, '04-links.json'), JSON.stringify(linksOut, null, 2), 'utf8');
  writeFileSync(resolve(outDir, '05-por-cliente.json'), JSON.stringify(porCliente, null, 2), 'utf8');

  log(`  resultado gravado em: ${outDir}`);
  log('    00-resumo.json');
  log('    01-ontologia.json');
  log('    02-customers.json');
  log('    03-invoices.json');
  log('    04-links.json');
  log('    05-por-cliente.json  ← cliente com suas faturas');

  const ok =
    customers.length > 0 &&
    invoices.length > 0 &&
    linked > 0 &&
    integrity.ok &&
    trav.maxDepthReached === 1 &&
    !!custNode;

  log(ok ? 'demo:sales ok' : 'demo:sales FAIL');
  return ok ? 0 : 1;
}

void main().then((code) => {
  process.exitCode = code;
});
