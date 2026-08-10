/**
 * PrincipalStore — "tabela principals" do Passo 3 (IAM).
 *
 * Componente do passo: armazenamento de principals (usuarios e contas de
 * servico). A interface `PrincipalStore` permite trocar a implementacao em
 * memoria por Postgres depois sem tocar no restante da plataforma. A
 * implementacao default (`InMemoryPrincipalStore`) persiste em JSON em disco
 * quando um caminho e informado.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

export type PrincipalKind = 'user' | 'service';

export interface NotificationHandles {
  email?: string | undefined;
  sms?: string | undefined;
}

export interface Principal {
  id: string;
  kind: PrincipalKind;
  name: string;
  email?: string;
  groups: string[];
  roles: string[];
  disabled: boolean;
  createdAt: string; // ISO 8601
  /** Somente contas de servico: hash (sha256) da API key — a chave em claro nunca e armazenada. */
  apiKeyHash?: string;
  /** Somente usuarios: hash scrypt com salt, formato scrypt$N$r$p$saltHex$hashHex. */
  passwordHash?: string;
  notificationHandles: NotificationHandles;
}

export type NewPrincipal = Omit<Principal, 'id' | 'createdAt'> & { id?: string };

export interface PrincipalStore {
  create(principal: NewPrincipal): Principal;
  getById(id: string): Principal | undefined;
  getByEmail(email: string): Principal | undefined;
  getByApiKeyHash(apiKeyHash: string): Principal | undefined;
  update(id: string, patch: Partial<Omit<Principal, 'id' | 'createdAt'>>): Principal | undefined;
  list(): Principal[];
}

interface StoreFileShape {
  principals: Principal[];
}

export class InMemoryPrincipalStore implements PrincipalStore {
  private readonly byId = new Map<string, Principal>();
  private readonly filePath?: string;

  constructor(options: { filePath?: string } = {}) {
    if (options.filePath !== undefined) {
      this.filePath = options.filePath;
      this.loadFromDisk();
    }
  }

  create(principal: NewPrincipal): Principal {
    if (principal.email !== undefined && this.getByEmail(principal.email) !== undefined) {
      throw new Error(`email ja cadastrado: ${principal.email}`);
    }
    const { id: inputId, ...rest } = principal;
    const record: Principal = {
      ...rest,
      id: inputId ?? randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.byId.set(record.id, record);
    this.persist();
    return record;
  }

  getById(id: string): Principal | undefined {
    return this.byId.get(id);
  }

  getByEmail(email: string): Principal | undefined {
    const normalized = email.toLowerCase();
    for (const p of this.byId.values()) {
      if (p.email !== undefined && p.email.toLowerCase() === normalized) return p;
    }
    return undefined;
  }

  getByApiKeyHash(apiKeyHash: string): Principal | undefined {
    for (const p of this.byId.values()) {
      if (p.apiKeyHash === apiKeyHash) return p;
    }
    return undefined;
  }

  update(id: string, patch: Partial<Omit<Principal, 'id' | 'createdAt'>>): Principal | undefined {
    const current = this.byId.get(id);
    if (current === undefined) return undefined;
    const next: Principal = { ...current, ...patch, id: current.id, createdAt: current.createdAt };
    this.byId.set(id, next);
    this.persist();
    return next;
  }

  list(): Principal[] {
    return [...this.byId.values()];
  }

  private loadFromDisk(): void {
    if (this.filePath === undefined || !existsSync(this.filePath)) return;
    const raw = readFileSync(this.filePath, 'utf8');
    if (raw.trim().length === 0) return;
    const parsed = JSON.parse(raw) as StoreFileShape;
    for (const p of parsed.principals) this.byId.set(p.id, p);
  }

  private persist(): void {
    if (this.filePath === undefined) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const payload: StoreFileShape = { principals: this.list() };
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2));
    renameSync(tmp, this.filePath);
  }
}
