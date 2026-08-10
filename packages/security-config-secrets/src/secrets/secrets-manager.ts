/**
 * Passo 3 / SOPS+age (gestao de secrets):
 * SecretsManager — secrets por ambiente em `secrets/<env>.enc`, cifrados
 * com AgeLikeCrypto. Operacoes set/get/list-keys (list NUNCA imprime
 * valores). O decrypt acontece em memoria, sob demanda, via interface
 * SecretProvider. Nenhum valor em claro toca o disco ou o log.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgeLikeCrypto } from './age-crypto.js';

/** Interface de acesso sob demanda: decifra apenas a chave pedida. */
export interface SecretProvider {
  getSecret(key: string): string;
  has(key: string): boolean;
  keys(): string[];
}

export class SecretsManager {
  /**
   * @param rootDir raiz do layout do repo (secrets ficam em rootDir/secrets).
   * @param secretKey chave secreta age-like usada para decifrar (em memoria).
   * @param recipients chaves publicas age-like para as quais cifrar.
   */
  constructor(
    private readonly rootDir: string,
    private readonly secretKey: string,
    private readonly recipients: string[],
  ) {
    if (recipients.length === 0) {
      // Deriva o destinatario da propria chave secreta por padrao.
      this.recipients = [AgeLikeCrypto.publicKeyFromSecret(secretKey)];
    }
  }

  private get secretsDir(): string {
    return join(this.rootDir, 'secrets');
  }

  private fileFor(env: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(env)) throw new Error(`nome de ambiente invalido: "${env}"`);
    return join(this.secretsDir, `${env}.enc`);
  }

  /** Le e decifra o mapa de secrets do ambiente (em memoria). */
  private loadMap(env: string): Map<string, string> {
    const file = this.fileFor(env);
    if (!existsSync(file)) return new Map();
    const plain = AgeLikeCrypto.decrypt(readFileSync(file, 'utf8'), this.secretKey);
    const obj = JSON.parse(plain.toString('utf8')) as Record<string, string>;
    return new Map(Object.entries(obj));
  }

  private saveMap(env: string, map: Map<string, string>): void {
    mkdirSync(this.secretsDir, { recursive: true });
    const obj = Object.fromEntries(map);
    const encrypted = AgeLikeCrypto.encrypt(JSON.stringify(obj), this.recipients);
    writeFileSync(this.fileFor(env), encrypted, 'utf8');
  }

  set(env: string, key: string, value: string): void {
    if (!key) throw new Error('chave de secret vazia');
    const map = this.loadMap(env);
    map.set(key, value);
    this.saveMap(env, map);
  }

  /** Retorna as chaves (nunca os valores) do ambiente. */
  listKeys(env: string): string[] {
    return [...this.loadMap(env).keys()].sort();
  }

  /** Provider com decrypt em memoria sob demanda. */
  provider(env: string): SecretProvider {
    const manager = this;
    // O mapa decifrado vive apenas nesta closure, em memoria.
    let cache: Map<string, string> | null = null;
    const load = (): Map<string, string> => {
      cache ??= manager.loadMap(env);
      return cache;
    };
    return {
      getSecret(key: string): string {
        const v = load().get(key);
        if (v === undefined) throw new Error(`secret inexistente: ${env}/${key}`);
        return v;
      },
      has(key: string): boolean {
        return load().has(key);
      },
      keys(): string[] {
        return [...load().keys()].sort();
      },
    };
  }

  /** Atalho: getSecret sem criar o provider. */
  get(env: string, key: string): string {
    return this.provider(env).getSecret(key);
  }

  listEnvs(): string[] {
    if (!existsSync(this.secretsDir)) return [];
    return Array.from(readdirSync(this.secretsDir))
      .filter((f) => f.endsWith('.enc'))
      .map((f) => f.slice(0, -'.enc'.length))
      .sort();
  }
}