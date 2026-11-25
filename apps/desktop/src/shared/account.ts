/**
 * The Zinarix account (optional): people register on the website's server, and the app signs
 * in to pick up the license keys linked to the account. The same server carries the owner's
 * messages for every installed app. Shared by the main process and the renderer.
 */

/** Where the account server lives (website/api). */
export const ACCOUNT_URL = 'https://zinarix-studio.vercel.app';

export interface AccountUser {
  id: string;
  email: string;
  name: string;
  /** ms */
  createdAt: number;
}

export interface AccountLicense {
  id: string;
  /** ZX1.… */
  key: string;
  plan: 'pro' | 'ai' | 'proai';
  name: string;
  createdAt: number;
  /** ms; null: never. */
  expiresAt: number | null;
}

/** A message from the owner to every installed app. */
export interface FeedMessage {
  id: string;
  text: string;
  url?: string;
  /** ms */
  at: number;
}

export interface AccountStatus {
  signedIn: boolean;
  user?: AccountUser;
  /** Keys linked to the account (valid ones). */
  licenses: AccountLicense[];
  /** The owner's latest messages (also shown without an account). */
  messages: FeedMessage[];
}

export interface AccountCredentials {
  email: string;
  password: string;
  /** Registration only. */
  name?: string;
}
