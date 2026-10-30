/**
 * Zinarix Studio plans. The free plan is the full editor with any AI, including everything
 * the agents do (tools, browser, approvals, delegation between AIs); Pro adds room to run
 * many of them at once (more chats, side by side, more windows). Shared by the main process
 * (which enforces) and the renderer (which explains and offers the upgrade).
 */

/** open: charging is off (set from the website), everyone has everything. */
export type PlanId = 'open' | 'free' | 'trial' | 'pro' | 'owner';

export interface PlanFeatures {
  /** Chats open at the same time (each one can be working). */
  maxChats: number;
  /** Two chats side by side. */
  split: boolean;
  /** More than one window. */
  windows: boolean;
  /** One AI handing work to another (delegate_to_ai): part of the agents, every plan. */
  delegation: boolean;
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
