/**
 * Wraps the EXISTING getMyAgencyApplicationStatus Cloud Function
 * (functions-core/index.js) — the same callable the web Agency Portal's
 * showStatusScreenIfApplicant() already uses. No new backend endpoint, no
 * second application-status model.
 */
import { getFunctions } from '../firebase/firebase';
import type { ApplicationStatus } from '../../types/profile';

export interface MyApplicationStatusResult {
  status: ApplicationStatus;
  agencyName?: string;
  submittedAt?: string | null;
}

export async function getMyApplicationStatus(): Promise<MyApplicationStatusResult> {
  const callable = getFunctions().httpsCallable('getMyAgencyApplicationStatus');
  const result = await callable();
  const data = (result.data ?? {}) as Partial<MyApplicationStatusResult>;
  return {
    status: (data.status as ApplicationStatus) ?? 'NONE',
    agencyName: data.agencyName,
    submittedAt: data.submittedAt ?? null,
  };
}
