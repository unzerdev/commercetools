import type { MethodLogoBytes } from '../../../domain';

/** The per-method artwork the provider ships; `has` answers without touching the disk. */
export interface MethodLogos {
  has(code: string): boolean;
  read(code: string): Promise<MethodLogoBytes | undefined>;
}
