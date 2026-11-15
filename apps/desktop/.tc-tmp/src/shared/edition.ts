import type { PaidPlan, PlanFeatures } from './plans.js';
import { AI_FEATURES, PRO_AI_FEATURES, PRO_FEATURES } from './plans.js';

/**
 * Editions: one installable app per plan. `standard` is "Zinarix Studio", the free download
 * that any key unlocks; `pro`, `ai` and `proai` are their own apps (own name, installer and
 * update channel), built with ZINARIX_EDITION (scripts/build-editions.mjs). An edition never
 * grants more than its plan, and its paid features still need that plan's key.
 */
export type EditionId = 'standard' | Exclude<PaidPlan, 'free'>;

export interface Edition {
  id: EditionId;
  /** Window and menu name. */
  productName: string;
  /** Installer and package names (no spaces). */
  slug: string;
  appId: string;
  /** Update channel (electron-builder `publish.channel`): `latest` for the standard app. */
  channel: string;
  /** The most this app can grant; undefined: no ceiling (whatever the key gives). */
  ceiling?: PlanFeatures;
  /** Plans whose key fits this app. */
  plans: PaidPlan[];
}

export const EDITIONS: Record<EditionId, Edition> = {
  standard: {
    id: 'standard',
    productName: 'Zinarix Studio',
    slug: 'zinarix-studio',
    appId: 'dev.zinarix.studio',
    channel: 'latest',
    plans: ['free', 'pro', 'ai', 'proai'],
  },
  pro: {
    id: 'pro',
    productName: 'Zinarix Studio Pro',
    slug: 'zinarix-studio-pro',
    appId: 'dev.zinarix.studio.pro',
    channel: 'pro',
    ceiling: PRO_FEATURES,
    plans: ['pro', 'proai'],
  },
  ai: {
    id: 'ai',
    productName: 'Zinarix Studio AI',
    slug: 'zinarix-studio-ai',
    appId: 'dev.zinarix.studio.ai',
    channel: 'ai',
    ceiling: AI_FEATURES,
    plans: ['ai', 'proai'],
  },
  proai: {
    id: 'proai',
    productName: 'Zinarix Studio Pro + AI',
    slug: 'zinarix-studio-proai',
    appId: 'dev.zinarix.studio.proai',
    channel: 'proai',
    ceiling: PRO_AI_FEATURES,
    plans: ['proai'],
  },
};

export function editionOf(id: string | undefined): Edition {
  return id && id in EDITIONS ? EDITIONS[id as EditionId] : EDITIONS.standard;
}

/** What two feature sets have in common (a key's plan inside an edition's ceiling). */
export function clampFeatures(f: PlanFeatures, ceiling?: PlanFeatures): PlanFeatures {
  if (!ceiling) return f;
  const out: PlanFeatures = {
    maxChats: Math.min(f.maxChats, ceiling.maxChats),
    split: f.split && ceiling.split,
    windows: f.windows && ceiling.windows,
    delegation: f.delegation && ceiling.delegation,
  };
  if (f.ai && ceiling.ai) out.ai = true;
  return out;
}
