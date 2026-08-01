import { RuleHit } from '../logins/rule-hit.entity';
import { UserFeature } from '../logins/user-feature.entity';
import { UserProfile } from '../users/users.service';

export interface ExplanationInput {
  username: string;
  timestamp: Date;
  ip: string;
  country: string;
  city: string;
  device: string;
  browser: string;
  success: boolean;
  ruleScore: number;
  mlScore: number | null;
  totalScore: number;
  label: string;
  ruleHits: RuleHit[];
  features: UserFeature | null;
  profile: UserProfile;
}

export interface ExplanationResult {
  explanationText: string;
  recommendedAction: string;
}

const RULE_LABELS: Record<string, string> = {
  failed_login_burst: 'a burst of failed login attempts',
  impossible_travel: 'impossible travel',
  blacklisted_ip: 'a blacklisted IP',
  new_device: 'a new device',
  odd_hour: 'a login at an unusual hour',
};

const RECOMMENDED_ACTIONS: Record<string, string> = {
  Critical:
    'Immediately block the source IP, force a password reset for the user, and verify the session. Contact the user out-of-band to confirm this login.',
  High: 'Challenge the session with MFA and require re-authentication. Review recent sessions and consider blocking the source IP if unverified.',
  Medium:
    'Flag the session for review and prompt the user for verification on their next action.',
};

/**
 * Generates a coherent natural-language explanation for a high-risk login.
 *
 * Deterministic template engine (no external LLM key required for the demo).
 * Composes: which rules fired (+ their evidence), the ML anomaly score,
 * and deltas against the user's behavioral profile. The signature mirrors
 * what an LLM provider would consume, so a real provider can be swapped in
 * behind this interface later.
 */
export function generateExplanation(input: ExplanationInput): ExplanationResult {
  const parts: string[] = [];

  const triggered = input.ruleHits.filter((r) => r.triggered);

  const evidence = triggered
    .map((r) => {
      const what = RULE_LABELS[r.ruleName] ?? r.ruleName;
      return r.details ? `${what} (${r.details})` : what;
    })
    .join('; ');

  parts.push(
    `This ${input.label.toLowerCase()}-risk login by ${input.username} on ` +
      `${input.timestamp.toISOString().slice(0, 16).replace('T', ' ')} UTC ` +
      `was scored ${input.totalScore}/100.`,
  );

  if (evidence) {
    parts.push(`It triggered: ${evidence}.`);
  }

  if (input.mlScore !== null && input.mlScore >= 60) {
    parts.push(
      `The ML anomaly model independently scored this login ${input.mlScore}/100, ` +
        `confirming it deviates from ${input.username}'s normal behavior.`,
    );
  } else if (input.mlScore !== null) {
    parts.push(
      `The ML anomaly model scored it ${input.mlScore}/100, ` +
        'suggesting the pattern is unusual but not a strong anomaly.',
    );
  }

  const deltas: string[] = [];
  if (
    input.profile.typicalCountry &&
    input.profile.typicalCountry !== input.country
  ) {
    deltas.push(
      `country ${input.country} (usually ${input.profile.typicalCountry})`,
    );
  }
  if (
    input.profile.typicalDevice &&
    input.profile.typicalDevice !== input.device
  ) {
    deltas.push(`device ${input.device} (usually ${input.profile.typicalDevice})`);
  }
  if (
    input.features &&
    input.profile.typicalHour !== null &&
    input.features.loginHour !== input.profile.typicalHour
  ) {
    deltas.push(
      `hour ${input.features.loginHour}:00 (usually around ${input.profile.typicalHour}:00)`,
    );
  }
  if (
    input.features &&
    input.features.geoDistanceKm > 500 &&
    input.profile.typicalCountry &&
    input.profile.typicalCountry !== input.country
  ) {
    deltas.push(
      `travel of ${Math.round(input.features.geoDistanceKm).toLocaleString()} km from the previous login location`,
    );
  }
  if (deltas.length > 0) {
    parts.push(
      `Compared to ${input.username}'s profile, this login stands out on: ${deltas.join(', ')}.`,
    );
  }

  if (triggered.length === 0 && deltas.length === 0) {
    parts.push(
      `Although no individual rule fired, the combined anomaly signal exceeded the alert threshold.`,
    );
  }

  parts.push(
    `This login was ${input.success ? 'successful' : 'unsuccessful'} from ` +
      `${input.ip} (${input.city ? input.city + ', ' : ''}${input.country}) ` +
      `on a ${input.device} running ${input.browser}.`,
  );

  const action =
    RECOMMENDED_ACTIONS[input.label] ?? RECOMMENDED_ACTIONS.Medium;

  return {
    explanationText: parts.join(' '),
    recommendedAction: action,
  };
}
