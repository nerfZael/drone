import * as fs from 'fs';
import * as path from 'path';
import { dvmRootPath } from '../hostPaths';

export interface BaseConfig {
  containerName?: string;
  image?: string;
}

export class BaseConfigManager {
  private configPath: string;

  constructor() {
    const dvmDir = dvmRootPath();
    this.configPath = path.join(dvmDir, 'base.json');

    // Ensure dvm storage directory exists
    if (!fs.existsSync(dvmDir)) {
      fs.mkdirSync(dvmDir, { recursive: true });
    }
  }

  async getBase(): Promise<BaseConfig | null> {
    if (!fs.existsSync(this.configPath)) {
      return null;
    }

    try {
      const content = await fs.promises.readFile(this.configPath, 'utf-8');
      return JSON.parse(content) as BaseConfig;
    } catch (error) {
      // If file is corrupted or empty, return null
      return null;
    }
  }

  async setBase(containerName: string, image?: string): Promise<void> {
    const config: BaseConfig = {
      containerName,
      image,
    };
    await fs.promises.writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  async resetBase(): Promise<void> {
    if (fs.existsSync(this.configPath)) {
      await fs.promises.unlink(this.configPath);
    }
  }

  async hasBase(): Promise<boolean> {
    const config = await this.getBase();
    return config !== null && (config.containerName !== undefined || config.image !== undefined);
  }
}
