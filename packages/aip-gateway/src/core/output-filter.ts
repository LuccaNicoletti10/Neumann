/**
 * aip-gateway — permission propagation on LLM output (US20240403396A1 / ADR-0022).
 */

import type { ObjectCitation } from 'contracts';

import { citationKey, uniqueCitations } from './citations.js';

const SECRETISH =
  /\b(Bearer\s+[A-Za-z0-9._\-]+|sk-[A-Za-z0-9]+|eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)/gi;

export interface OutputFilterInput {
  answer: string;
  allowedCitations: ObjectCitation[];
  /** Property values the principal must not see echoed in free text. */
  forbiddenSubstrings: string[];
}

export interface OutputFilterResult {
  answer: string;
  citations: ObjectCitation[];
}

export function filterAipOutput(input: OutputFilterInput): OutputFilterResult {
  let answer = input.answer.replace(SECRETISH, '[REDACTED]');
  for (const needle of input.forbiddenSubstrings) {
    if (!needle || needle.length < 2) continue;
    answer = answer.split(needle).join('[REDACTED]');
  }

  const allowed = new Set(input.allowedCitations.map(citationKey));
  const citedFromText = extractCitationMentions(answer, input.allowedCitations);
  const citations = uniqueCitations(
    [...input.allowedCitations, ...citedFromText].filter((c) => allowed.has(citationKey(c))),
  );

  // WHY: grounded answers must reference tool-fetched objects when tools ran.
  if (input.allowedCitations.length > 0 && citations.length === 0) {
    return {
      answer: `${answer}\n\n(Sources unavailable: no resolvable citations from tools.)`,
      citations: [],
    };
  }

  return { answer, citations };
}

function extractCitationMentions(
  answer: string,
  allowed: ObjectCitation[],
): ObjectCitation[] {
  const hits: ObjectCitation[] = [];
  for (const c of allowed) {
    if (answer.includes(c.primaryKey) || answer.includes(`${c.objectTypeId}/${c.primaryKey}`)) {
      hits.push(c);
    }
  }
  return hits;
}
