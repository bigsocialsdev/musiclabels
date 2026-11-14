import { cache } from 'react';
import { loadSession } from '@/lib/identity/server';

/** The top bar and the home page both ask who is signed in; one Auth round trip per request. */
export const storeSession = cache(loadSession);

/** A display preference only (hides the first-visit band); nothing trusts it. */
export const INTRO_COOKIE = 'mrm_intro';
export const INTRO_DISMISSED = 'dismissed';
