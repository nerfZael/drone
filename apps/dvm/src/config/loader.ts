import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { PortMapping, VolumeMount, PersistenceConfig, ContainerConfig } from '../docker/client';

export interface DvmConfig {
  name: string;
  image: string;
  network?: string;
  ports?: (number | string | { container: number; host?: number })[];
  environment?: string[];
  volumes?: (string | { source: string; target: string; type?: 'bind' | 'volume' })[];
  persistence?: {
    enabled?: boolean;
    path?: string;
  };
}

export class ConfigLoader {
  private static ensureRecord(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Invalid ${field}: expected object`);
    }
    return value as Record<string, unknown>;
  }

  private static requireNonEmptyString(value: unknown, field: string): string {
    const s = typeof value === 'string' ? value.trim() : '';
    if (!s) throw new Error(`Invalid ${field}: expected non-empty string`);
    return s;
  }

  private static optionalString(value: unknown, field: string): string | undefined {
    if (value == null) return undefined;
    const s = this.requireNonEmptyString(value, field);
    return s;
  }

  private static parsePort(value: unknown, field: string): number {
    const raw = typeof value === 'string' ? value.trim() : value;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0 || n > 65535) {
      throw new Error(`Invalid ${field}: expected integer 1-65535`);
    }
    return n;
  }

  private static parsePortSpec(value: unknown, index: number): PortMapping {
    if (typeof value === 'number' || typeof value === 'string') {
      const raw = String(value).trim();
      if (!raw) throw new Error(`Invalid ports[${index}]: expected port or host:container`);
      if (raw.includes(':')) {
        const parts = raw.split(':');
        if (parts.length !== 2) throw new Error(`Invalid ports[${index}]: expected host:container`);
        return {
          hostPort: this.parsePort(parts[0], `ports[${index}].hostPort`),
          containerPort: this.parsePort(parts[1], `ports[${index}].containerPort`),
        };
      }
      return { containerPort: this.parsePort(raw, `ports[${index}]`) };
    }

    const obj = this.ensureRecord(value, `ports[${index}]`);
    return {
      containerPort: this.parsePort(obj.container, `ports[${index}].container`),
      hostPort: obj.host == null ? undefined : this.parsePort(obj.host, `ports[${index}].host`),
    };
  }

  private static parseVolumeSpec(value: unknown, index: number): VolumeMount {
    if (typeof value === 'string') {
      const raw = value.trim();
      if (!raw) throw new Error(`Invalid volumes[${index}]: expected source:target`);
      const colon = raw.indexOf(':');
      if (colon <= 0 || colon === raw.length - 1) {
        throw new Error(`Invalid volumes[${index}]: expected source:target`);
      }
      const source = raw.slice(0, colon).trim();
      const target = raw.slice(colon + 1).trim();
      if (!source || !target) throw new Error(`Invalid volumes[${index}]: expected source:target`);
      return { source, target, type: 'bind' };
    }

    const obj = this.ensureRecord(value, `volumes[${index}]`);
    const source = this.requireNonEmptyString(obj.source, `volumes[${index}].source`);
    const target = this.requireNonEmptyString(obj.target, `volumes[${index}].target`);
    const typeRaw = obj.type == null ? 'bind' : String(obj.type).trim();
    if (typeRaw !== 'bind' && typeRaw !== 'volume') {
      throw new Error(`Invalid volumes[${index}].type: expected "bind" or "volume"`);
    }
    return { source, target, type: typeRaw };
  }

  static async loadFromFile(filePath: string): Promise<ContainerConfig> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const ext = path.extname(filePath).toLowerCase();

    let configRaw: unknown;
    if (ext === '.yaml' || ext === '.yml') {
      configRaw = yaml.load(content);
    } else if (ext === '.json') {
      configRaw = JSON.parse(content);
    } else {
      throw new Error(`Unsupported config file format: ${ext}`);
    }

    return this.normalizeConfig(configRaw);
  }

  static normalizeConfig(config: unknown): ContainerConfig {
    const cfg = this.ensureRecord(config, 'config');
    const name = this.requireNonEmptyString(cfg.name, 'name');
    const image = this.requireNonEmptyString(cfg.image, 'image');
    const network = this.optionalString(cfg.network, 'network');

    const ports: PortMapping[] = [];
    const portsRaw = cfg.ports;
    if (portsRaw != null) {
      if (!Array.isArray(portsRaw)) throw new Error('Invalid ports: expected array');
      for (let i = 0; i < portsRaw.length; i++) {
        ports.push(this.parsePortSpec(portsRaw[i], i));
      }
    }

    const volumes: VolumeMount[] = [];
    const volumesRaw = cfg.volumes;
    if (volumesRaw != null) {
      if (!Array.isArray(volumesRaw)) throw new Error('Invalid volumes: expected array');
      for (let i = 0; i < volumesRaw.length; i++) {
        volumes.push(this.parseVolumeSpec(volumesRaw[i], i));
      }
    }

    const environmentRaw = cfg.environment;
    if (environmentRaw != null && !Array.isArray(environmentRaw)) {
      throw new Error('Invalid environment: expected array of strings');
    }
    const environment =
      environmentRaw?.map((v, i) => {
        if (typeof v !== 'string' || !v.trim()) throw new Error(`Invalid environment[${i}]: expected non-empty string`);
        return v;
      }) ?? undefined;

    const persistenceRaw = cfg.persistence;
    if (persistenceRaw != null && (typeof persistenceRaw !== 'object' || Array.isArray(persistenceRaw))) {
      throw new Error('Invalid persistence: expected object');
    }
    const persistenceObj = persistenceRaw == null ? {} : this.ensureRecord(persistenceRaw, 'persistence');
    if (persistenceObj.enabled != null && typeof persistenceObj.enabled !== 'boolean') {
      throw new Error('Invalid persistence.enabled: expected boolean');
    }
    const persistencePathRaw =
      persistenceObj.path == null ? '/dvm-data' : this.requireNonEmptyString(persistenceObj.path, 'persistence.path');
    const persistence: PersistenceConfig = {
      enabled: persistenceObj.enabled !== false,
      path: persistencePathRaw,
    };

    return {
      name,
      image,
      network,
      ports,
      environment,
      volumes,
      persistence,
    };
  }

  static createDefaultConfig(name: string, image: string): ContainerConfig {
    return {
      name,
      image,
      ports: [],
      persistence: {
        enabled: true,
        path: '/dvm-data',
      },
    };
  }
}
