/**
 * Certification fixtures — fictional industrial company (Prompt 12).
 * Data only. Never imported from packages/*/src production paths.
 */

export const CERT_ONTOLOGY_NAME = 'acme-industrial';

export const CERT_OBJECT_TYPES = [
  'Customer',
  'Product',
  'SalesOrder',
  'InventoryPosition',
  'Machine',
  'WorkOrder',
] as const;

export const CERT_LINK_TYPES = [
  { id: 'CustomerHasOrder', from: 'Customer', to: 'SalesOrder', cardinality: '1:N' as const },
  { id: 'OrderHasProduct', from: 'SalesOrder', to: 'Product', cardinality: 'N:N' as const },
  { id: 'ProductHasInventory', from: 'Product', to: 'InventoryPosition', cardinality: '1:N' as const },
  { id: 'WorkOrderUsesProduct', from: 'WorkOrder', to: 'Product', cardinality: 'N:N' as const },
  { id: 'WorkOrderUsesMachine', from: 'WorkOrder', to: 'Machine', cardinality: 'N:1' as const },
] as const;

export const CERT_SENSITIVE_FIELDS = [
  'creditLimit',
  'unitCost',
  'margin',
  'internalNotes',
] as const;

export const CERT_ROLES = ['admin', 'sales', 'planner', 'operator', 'auditor'] as const;
