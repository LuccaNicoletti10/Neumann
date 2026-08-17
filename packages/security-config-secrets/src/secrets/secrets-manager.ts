/**
 * Passo 3 / SOPS+age (gestao de secrets):
 * SecretsManager — secrets por ambiente em `secrets/<env>.enc`, cifrados
 * com age real (age-encryption.org/v1). Operacoes set/get/list-keys (list NUNCA
 * imprime valores). O decrypt acontece em memoria, sob demanda.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AgeBackend } from './age-backend.js';

/** Interface de acesso sob demanda: decifra apenas a chave pedida. */
export interface SecretProvider {
  getSecret(key: string): Promise<string>;
  has(key: string): Promise<boolean>;
  keys(): Promise<string[]>;
}

export class SecretsManager {
  /**
   * @param rootDir raiz do layout do repo (secrets ficam em rootDir/secrets).
   * @param secretKey identidade age (AGE-SECRET-KEY-1...).
   * @param recipients chaves publicas age1... para as quais cifrar.
   */
  constructor(
    private readonly rootDir: string,
    private readonly secretKey: string,
    private recipients: string[],
  ) {}

  private async resolvedRecipients(): Promise<string[]> {
    if (this.recipients.length > 0) return this.recipients;
    this.recipients = [await AgeBackend.publicKeyFromSecret(this.secretKey)];
    return this.recipients;
  }

  private get secretsDir(): string {
    return join(this.rootDir, 'secrets');
  }

  private fileFor(env: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(env)) throw new Error(`nome de ambiente invalido: "${env}"`);
    return join(this.secretsDir, `${env}.enc`);
  }

  private async loadMap(env: string): Promise<Map<string, string>> {
    const file = this.fileFor(env);
    if (!existsSync(file)) return new Map();
    const plain = await AgeBackend.decrypt(readFileSync(file, 'utf8'), this.secretKey);
    const obj = JSON.parse(plain.toString('utf8')) as Record<string, string>;
    return new Map(Object.entries(obj));
  }

  private async saveMap(env: string, map: Map<string, string>): Promise<void> {
    mkdirSync(this.secretsDir, { recursive: true });
    const obj = Object.fromEntries(map);
    const encrypted = await AgeBackend.encrypt(JSON.stringify(obj), await this.resolvedRecipients());
    const dest = this.fileFor(env);
    const tmp = `${dest}.tmp`;
    writeFileSync(tmp, encrypted, 'utf8');
    renameSync(tmp, dest);
  }

  async set(env: string, key: string, value: string): Promise<void> {
    if (!key) throw new Error('chave de secret vazia');
    const map = await this.loadMap(env);
    map.set(key, value);
    await this.saveMap(env, map);
  }

  async listKeys(env: string): Promise<string[]> {
    return [...(await this.loadMap(env)).keys()].sort();
  }

  async provider(env: string): Promise<SecretProvider> {
    const manager = this;
    let cache: Map<string, string> | null = null;
    const load = async (): Promise<Map<string, string>> => {
      cache ??= await manager.loadMap(env);
      return cache;
    };
    return {
      async getSecret(key: string): Promise<string> {
        const v = (await load()).get(key);
        if (v === undefined) throw new Error(`secret inexistente: ${env}/${key}`);
        return v;
      },
      async has(key: string): Promise<boolean> {
        return (await load()).has(key);
      },
      async keys(): Promise<string[]> {
        return [...(await load()).keys()].sort();
      },
    };
  }

  async get(env: string, key: string): Promise<string> {
    return (await this.provider(env)).getSecret(key);
  }

  listEnvs(): string[] {
    if (!existsSync(this.secretsDir)) return [];
    return Array.from(readdirSync(this.secretsDir))
      .filter((f) => f.endsWith('.enc'))
      .map((f) => f.slice(0, -'.enc'.length))
      .sort();
  }
}
