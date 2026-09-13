/**
 * ONE shared codebase, TWO app identities -- selected entirely by the
 * `APP_VARIANT` environment variable (read here, and by app.config.ts for
 * the Expo name/bundle-id/package-id). Never inferred from anything else
 * (not a build flag baked into a screen, not a runtime toggle) so the same
 * bundle can never accidentally serve the wrong variant's routes.
 */
export type AppVariant = 'staff' | 'agency';

const RAW_VARIANT = process.env.APP_VARIANT ?? process.env.EXPO_PUBLIC_APP_VARIANT ?? 'staff';

export const APP_VARIANT: AppVariant = RAW_VARIANT === 'agency' ? 'agency' : 'staff';

export interface VariantIdentity {
  variant: AppVariant;
  displayName: string;
  /** Conceptual bundle id (iOS) / application id (Android). Not yet registered with Apple/Google. */
  applicationId: string;
  slug: string;
}

const IDENTITIES: Record<AppVariant, VariantIdentity> = {
  staff: {
    variant: 'staff',
    displayName: 'Vilu Staff',
    applicationId: 'com.viluresidence.staff',
    slug: 'vilu-staff',
  },
  agency: {
    variant: 'agency',
    displayName: 'Vilu Agency',
    applicationId: 'com.viluresidence.agency',
    slug: 'vilu-agency',
  },
};

export function getVariantIdentity(variant: AppVariant = APP_VARIANT): VariantIdentity {
  return IDENTITIES[variant];
}
