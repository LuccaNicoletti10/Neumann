/**
 * aip-gateway — profile-based prompt context (US20240419658A1 / ADR-0022).
 * Profiles are data; policy remains PolicyRuntime.
 */

import type { AipProfile } from 'contracts';

export const DEFAULT_AIP_PROFILE: AipProfile = {
  id: 'default',
  name: 'Ontology Reader',
  role: 'reader',
  systemTemplate: [
    'You are a read-only assistant over a versioned Ontology.',
    'Use only the provided tools to fetch objects. Do not invent primary keys.',
    'Answer in plain language. Cite objects you used via tool results.',
    'Never propose mutations, deletes, or Action execution.',
    'Profile role: {role}. Ontology: {ontologyId}. Principal: {principal}.',
  ].join(' '),
};

export function resolveProfile(
  profiles: readonly AipProfile[],
  profileId: string | undefined,
): AipProfile {
  if (profileId) {
    const hit = profiles.find((p) => p.id === profileId);
    if (!hit) throw new Error(`AIP profile not found: ${profileId}`);
    return hit;
  }
  return profiles[0] ?? DEFAULT_AIP_PROFILE;
}

export function renderSystemPrompt(
  profile: AipProfile,
  opts: { ontologyId: string; principal: string },
): string {
  return profile.systemTemplate
    .replaceAll('{role}', profile.role)
    .replaceAll('{ontologyId}', opts.ontologyId)
    .replaceAll('{principal}', opts.principal)
    .replaceAll('{profile_name}', profile.name);
}
