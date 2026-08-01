export interface Login {
  id: string;
  userId: string;
  timestamp: string;
  ip: string;
  country: string;
  city: string;
  device: string;
  browser: string;
  success: boolean;
}

export interface RiskScore {
  loginId: string;
  ruleScore: number;
  mlScore: number;
  threatIntelScore: number;
  finalScore: number;
  label: 'Low' | 'Medium' | 'High' | 'Critical';
}

export interface RuleHit {
  loginId: string;
  ruleName: string;
  triggered: boolean;
  details?: string;
}

export interface UserProfile {
  userId: string;
  username: string;
  typicalHours: string;
  typicalCountry: string;
  typicalDevice: string;
  avgLoginsPerDay: number;
}

export interface AiExplanation {
  loginId: string;
  explanation: string;
  recommendedAction: string;
  generatedAt: string;
}

export interface LoginDetail extends Login {
  riskScore: RiskScore;
  ruleHits: RuleHit[];
  aiExplanation?: AiExplanation;
  userProfile?: UserProfile;
}
