/**
 * Zinarix Studio plans. The free plan is the full editor with any AI, including everything
 * the agents do (tools, browser, approvals, delegation between AIs); Pro adds room to run
 * many of them at once (more chats, side by side, more windows). Shared by the main process
 * (which enforces) and the renderer (which explains and offers the upgrade).
 */

/**
 * open: charging is off (set from the website), everyone has everything.
 * ai: the free plan plus Zinarix AI (the best AIs without accounts or keys).
 * proai: Pro plus Zinarix AI.
 */
export type PlanId = 'open' | 'free' | 'trial' | 'pro' | 'ai' | 'proai' | 'owner';

/** What a license key or a plan code can grant. */
export type PaidPlan = 'free' | 'pro' | 'ai' | 'proai';

export interface PlanFeatures {
  /** Chats open at the same time (each one can be working). */
  maxChats: number;
  /** Two chats side by side. */
  split: boolean;
  /** More than one window. */
  windows: boolean;
  /** One AI handing work to another (delegate_to_ai): part of the agents, every plan. */
  delegation: boolean;
  /** Zinarix AI: AIs included, without accounts or keys (plans AI and Pro + AI). */
  ai?: boolean;
}

export const FREE_FEATURES: PlanFeatures = {
  maxChats: 2,
  split: false,
  windows: false,
  delegation: true,
};

export const PRO_FEATURES: PlanFeatures = {
  maxChats: 99,
  split: true,
  windows: true,
  delegation: true,
};

export const AI_FEATURES: PlanFeatures = { ...FREE_FEATURES, ai: true };

export const PRO_AI_FEATURES: PlanFeatures = { ...PRO_FEATURES, ai: true };

/** Plans that include Pro (more chats, side by side, windows). */
export const hasPro = (plan: PlanId) => plan === 'pro' || plan === 'proai' || plan === 'owner';

/** Plans that include Zinarix AI. */
export const hasAi = (plan: PlanId) => plan === 'ai' || plan === 'proai' || plan === 'owner';

/** Plans someone activated (a key or a code), which can be removed. */
export const isActivated = (plan: PlanId) =>
  plan === 'pro' || plan === 'ai' || plan === 'proai' || plan === 'owner';

export type ProFeature = 'chats' | 'split' | 'windows';

export interface LicenseStatus {
  plan: PlanId;
  features: PlanFeatures;
  /** Charging is on (plans.json on the website). */
  billing: boolean;
  /** Where "Comprar Pro" leads. */
  buyUrl: string;
  /** What the free plan includes (set from the website). */
  free: PlanFeatures;
  /** Set with a plan code (zinarix at, zinarixpro at…), not a bought key. */
  code?: boolean;
  /** Who the license belongs to (Pro). */
  email?: string;
  name?: string;
  /** End of the license (ms); null or absent: does not expire. */
  expires?: number | null;
  /** Trial: when it ends (ms) and the whole days left. */
  trialEndsAt?: number;
  trialDaysLeft?: number;
  /** Why a saved license is not active (expired, invalid). */
  problem?: string;
}

/** Days of Pro everyone gets on first launch. */
export const TRIAL_DAYS = 14;

/** Where "Comprar Pro" leads. */
export const BUY_URL = 'https://zinarix-studio.vercel.app/#precios';

/**
 * The owner's control file, published with the website (website/app-config.json): every
 * installed copy reads it a few times a day.
 * - billing: while false nobody pays and nothing is limited; set it to true and installed
 *   copies start the trial and then the plans, without reinstalling.
 * - notice: a message shown once in every installed app (a new version, news…).
 * - latestVersion / downloadUrl: announce a version to copies that cannot update themselves.
 */
export const CONFIG_URL = 'https://zinarix-studio.vercel.app/app-config.json';

/** Where people download the app (versions, installers). */
export const DOWNLOAD_URL = 'https://zinarix-studio.vercel.app/#descargar';

export interface RemoteNotice {
  /** Shown once per id: change it to send a new notice. */
  id: string;
  text: string;
  /** Optional "Ver más" link (https). */
  url?: string;
}

export interface PlansConfig {
  billing: boolean;
  trialDays: number;
  /** What the free plan includes once billing is on. */
  free: PlanFeatures;
  buyUrl: string;
}

export const DEFAULT_PLANS: PlansConfig = {
  billing: false,
  trialDays: TRIAL_DAYS,
  free: FREE_FEATURES,
  buyUrl: BUY_URL,
};
